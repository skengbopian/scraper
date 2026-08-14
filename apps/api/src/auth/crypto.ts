import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { base32Encode as base32EncodeCore } from '@scraper/core';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string | Buffer, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;

/**
 * Auth primitives (docs/01 P0: email + password + TOTP MFA), dependency-free on node:crypto.
 * scrypt for passwords, RFC 6238 TOTP (RFC 4226 HOTP under it — test-vectored).
 *
 * **The scrypt parameters below are BELOW the OWASP floor.** They are N=2^14 (16384), r=8, p=1, a
 * 32-byte key over a 32-byte random salt. This comment used to call them "OWASP params" and they have
 * never been that; the 2026-08-13 audit caught it. A wrong reassurance in the one place a reviewer
 * looks to decide whether this file needs attention is worse than no comment at all, so the numbers
 * and the gap are now stated plainly: OWASP's Password Storage Cheat Sheet puts the scrypt minimum at
 * N=2^17, r=8, p=1, and its lower-N fallbacks raise p to compensate (N=2^14 is paired with p=5). We
 * do neither — we are a factor of eight under on work, with no compensating parallelism.
 *
 * Why the numbers stay anyway, deliberately and not by oversight: N=2^17 is eight times the memory
 * and CPU of N=2^14 — on the order of 800ms per hash on the hardware this runs on, paid on every
 * sign-in AND on every FAILED sign-in, which makes the unauthenticated login endpoint an amplifier
 * against ourselves. Trading a login-availability regression for the margin is not a trade we take
 * blind, so the cost of NOT taking it is recorded here beside it: an attacker who steals the
 * `User.passwordHash` column gets roughly eight times the offline guesses per euro that a conforming
 * deployment would hand them. What stands between that and an account today is the password policy at
 * registration and the mandatory TOTP second factor — not this constant.
 *
 * TODO(safety): move to argon2id (OWASP interactive baseline m=19MiB, t=2, p=1), which reaches the
 * intended resistance at an interactive latency instead of making us choose between the two. The
 * stored string is self-describing — `scrypt$N$r$p$salt$hash`, algorithm label first — so a second
 * scheme needs no migration and no schema change: verify against whatever the row declares, and
 * rehash on the next successful login. No user is ever forced through a reset. Whatever lands,
 * `verifyPassword` must keep parsing the `scrypt$…` label for as long as one un-upgraded row exists.
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
