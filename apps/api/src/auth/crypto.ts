import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string | Buffer, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;

/**
 * Auth primitives (docs/01 P0: email + password + TOTP MFA), dependency-free on node:crypto.
 * scrypt for passwords (OWASP params), RFC 6238 TOTP (RFC 4226 HOTP under it — test-vectored).
 */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(32);
  const hash = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  const saltB64 = parts[4] ?? '', hashB64 = parts[5] ?? '';
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p) || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: n, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// --- Base32 (RFC 4648, no padding) — the TOTP-secret encoding authenticator apps expect. ---------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Random 20-byte secret; a stable `seed` derives deterministically (dev fixture only). */
export function generateTotpSecret(seed?: string): string {
  const raw = seed ? createHash('sha256').update(`scraper-totp:${seed}`).digest().subarray(0, 20) : randomBytes(20);
  return base32Encode(raw);
}

/** RFC 4226 HOTP, 6 digits, HMAC-SHA1. */
export function hotp(secretB32: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const offset = (mac.at(-1) ?? 0) & 0x0f;
  const code = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(code % 1_000_000).padStart(6, '0');
}

/** RFC 6238 TOTP, 30s step. */
export function totp(secretB32: string, nowMs: number = Date.now()): string {
  return hotp(secretB32, Math.floor(nowMs / 1000 / 30));
}

/** Accepts the current step ±1 (clock skew). Constant-time compare per candidate. */
export function verifyTotp(secretB32: string, code: string, nowMs: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(nowMs / 1000 / 30);
  const given = Buffer.from(code);
  for (const c of [step - 1, step, step + 1]) {
    const expected = Buffer.from(hotp(secretB32, c));
    if (expected.length === given.length && timingSafeEqual(expected, given)) return true;
  }
  return false;
}

export function totpProvisioningUri(email: string, secretB32: string): string {
  return `otpauth://totp/Scraper:${encodeURIComponent(email)}?secret=${secretB32}&issuer=Scraper&algorithm=SHA1&digits=6&period=30`;
}

// --- Session tokens: the raw token lives only in the client; the DB stores its sha256. ----------
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
