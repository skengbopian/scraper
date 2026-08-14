import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Per-user envelope encryption (CLAUDE.md §4: "Envelope-encrypt each user's assembled data map under
 * keys gated by their auth"). Ported from the pre-audit line (`~/Downloads/scraper`
 * `packages/providers/src/crypto/envelope.ts` @ cc9dcb4) in port wave 1 per ADR-030 — that line had
 * the only working implementation of a guarantee this line had been asserting in prose with no code
 * behind it.
 *
 * Sealed layout, used for both wrapped DEKs and payloads:  [ iv(12) | gcmTag(16) | ciphertext ]
 *
 * The DEK never exists at rest: it is generated once per user, sealed under a KEK the application
 * does not store next to the data, and unwrapped only in memory for a single operation.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface EnvelopeCrypto {
  generateWrappedDek(kekRef: string): Promise<{ wrappedDek: Buffer }>;
  encrypt(wrappedDek: Buffer, kekRef: string, plaintext: Buffer): Promise<Buffer>;
  decrypt(wrappedDek: Buffer, kekRef: string, ciphertext: Buffer): Promise<Buffer>;
}

export interface KekResolver {
  getKek(kekRef: string): Buffer;
}

/** Per-user key material, as stored on the user row. */
export interface UserKey {
  readonly wrappedDek: Buffer;
  readonly kekRef: string;
}

export interface UserKeyResolver {
  getUserKey(userId: string): Promise<UserKey>;
}

/**
 * Resolves KEKs from environment: `SCRAPER_KEK_<REF>` holding base64 of exactly 32 bytes, where
 * `<REF>` is the kekRef uppercased with non-alphanumerics mapped to `_`.
 */
export class EnvKekResolver implements KekResolver {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  getKek(kekRef: string): Buffer {
    const envName = `SCRAPER_KEK_${kekRef.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    const b64 = this.env[envName];
    if (b64 === undefined || b64 === '') {
      throw new Error(`EnvKekResolver: env var ${envName} is not set for kekRef "${kekRef}"`);
    }
    const kek = Buffer.from(b64, 'base64');
    if (kek.length !== KEY_BYTES) {
      throw new Error(`EnvKekResolver: ${envName} must decode to ${KEY_BYTES} bytes, got ${kek.length}`);
    }
    return kek;
  }
}

/**
 * DEV ONLY: derives a static KEK from the kekRef itself, so every developer machine gets the same
 * key — which is the OPPOSITE of a secret. It runs only under an ALLOW-listed NODE_ENV (the
 * `devFixturesEnabled()` posture): refusing only the literal "production" left this resolver live
 * whenever NODE_ENV was unset, "staging", "prod", or misspelled — silently sealing real secrets
 * under a key anyone with the source can re-derive (audit H1). The API's boot gate
 * (`assertApiStartupSafe`) refuses such a deployment before this throw is ever reached.
 * TODO(safety): replace with a KMS-backed resolver before any real personal data is stored.
 */
export class DevKekResolver implements KekResolver {
  getKek(kekRef: string): Buffer {
    const env = process.env.NODE_ENV;
    if (env !== 'development' && env !== 'test') {
      throw new Error(
        `DevKekResolver must never run outside development/test (NODE_ENV=${env ?? 'unset'}) — ` +
          'every machine derives the same key. Set SCRAPER_KEK_MODE=env and provision SCRAPER_KEK_* secrets.',
      );
    }
    return scryptSync(`scraper-dev-kek:${kekRef}`, 'scraper-dev-only-salt', KEY_BYTES);
  }
}

function seal(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function open(key: Buffer, sealed: Buffer): Buffer {
  if (sealed.length < IV_BYTES + TAG_BYTES) {
    throw new Error(`envelope: sealed buffer too short (${sealed.length} bytes)`);
  }
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = sealed.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  // final() throws on GCM auth failure — tampering is detected, never ignored.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Real implementation (not a stub): AES-256-GCM envelope crypto over node:crypto. */
export class AesGcmEnvelopeCrypto implements EnvelopeCrypto {
  constructor(private readonly keks: KekResolver) {}

  async generateWrappedDek(kekRef: string): Promise<{ wrappedDek: Buffer }> {
    const dek = randomBytes(KEY_BYTES);
    return { wrappedDek: seal(this.keks.getKek(kekRef), dek) };
  }

  async encrypt(wrappedDek: Buffer, kekRef: string, plaintext: Buffer): Promise<Buffer> {
    return seal(this.unwrapDek(wrappedDek, kekRef), plaintext);
  }

  async decrypt(wrappedDek: Buffer, kekRef: string, ciphertext: Buffer): Promise<Buffer> {
    return open(this.unwrapDek(wrappedDek, kekRef), ciphertext);
  }

  private unwrapDek(wrappedDek: Buffer, kekRef: string): Buffer {
    const dek = open(this.keks.getKek(kekRef), wrappedDek);
    if (dek.length !== KEY_BYTES) {
      throw new Error(`envelope: unwrapped DEK has ${dek.length} bytes, expected ${KEY_BYTES}`);
    }
    return dek;
  }
}

/**
 * Envelope encryption for OPAQUE per-user secrets — today the TOTP shared secret.
 *
 * Kept deliberately separate from any schema-validating subject cipher: that one's validation is
 * itself a safety control (only a verified subject may reach the identity blob), and tunnelling
 * arbitrary bytes through it with a cast would defeat the control. Same DEK, same KEK, no schema.
 *
 * TODO(safety): a dedicated secret store is still preferable to reusing the user DEK — a DEK
 * compromise currently opens both the identity data and the second factor.
 */
export class EnvelopeSecretCipher {
  constructor(
    private readonly crypto: EnvelopeCrypto,
    private readonly keys: UserKeyResolver,
  ) {}

  async encrypt(userId: string, plaintext: Buffer): Promise<Buffer> {
    const { wrappedDek, kekRef } = await this.keys.getUserKey(userId);
    return this.crypto.encrypt(wrappedDek, kekRef, plaintext);
  }

  async decrypt(userId: string, ciphertext: Buffer): Promise<Buffer> {
    const { wrappedDek, kekRef } = await this.keys.getUserKey(userId);
    return this.crypto.decrypt(wrappedDek, kekRef, ciphertext);
  }
}
