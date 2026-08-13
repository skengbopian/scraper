import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { base32Encode as base32EncodeCore } from '@scraper/core';
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

/**
 * TOTP lives in @scraper/core (packages/core/src/auth/totp.ts) as of port wave 3 — ONE implementation,
 * because the one here returned a bare boolean and therefore could not express replay defence. These
 * re-exports keep the existing call sites working; `verifyTotp` now returns a verdict with the
 * matching counter, and callers must persist it (see AuthService).
 */
export {
  base32Decode,
  base32Encode,
  hotp,
  totp,
  totpCounterAt,
  totpProvisioningUri,
  verifyTotp,
  type TotpVerdict,
} from '@scraper/core';

/** Random 20-byte secret; a stable `seed` derives deterministically (dev fixture only). */
export function generateTotpSecret(seed?: string): string {
  const raw = seed ? createHash('sha256').update(`scraper-totp:${seed}`).digest().subarray(0, 20) : randomBytes(20);
  return base32EncodeCore(raw);
}

// --- Session tokens: the raw token lives only in the client; the DB stores its sha256. ----------
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
