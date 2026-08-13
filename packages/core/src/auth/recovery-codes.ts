/**
 * Recovery codes — the way back in when the phone is gone (docs/06 C2, ADR-035).
 *
 * This matters more here than in an ordinary product. The TOTP secret is envelope-encrypted under
 * the user's own DEK (CLAUDE.md §4), so there is no support path that recovers it: an operator
 * cannot read the secret and reset it for them. Without recovery codes, a lost phone means a
 * permanently unreachable account — and the account holds the evidence pack for legal actions the
 * user may be in the middle of.
 *
 * The codes are shown ONCE at enrolment and stored only as hashes.
 *
 * ENTROPY, stated exactly, because the number is set by the OFFLINE threat rather than the online one.
 * Each character is one uniformly random symbol from a 32-symbol alphabet (`byte % 32` is unbiased,
 * since 256 divides evenly by 32), so a 16-character code carries **80 bits**.
 *
 * Why not 10 characters / 50 bits, which the online throttle would easily cover: the codes are stored
 * as UNSALTED SHA-256 so they can be looked up by hash, which means one brute-force sweep tests each
 * candidate against every user's row simultaneously. At 50 bits that sweep is hours of GPU time and
 * yields a working second-factor bypass for the entire user base; at 80 bits it is out of reach. The
 * hash stays fast and unsalted deliberately — the defence is the keyspace, and a slow KDF over
 * system-generated randomness buys far less than the 30 extra bits do.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { RECOVERY_CODE_COUNT, RECOVERY_CODE_LENGTH } from './session.js';

/**
 * Crockford-ish base32 without I/L/O/U: no character pairs a user can misread off a printout.
 * Exactly 32 symbols, which is what makes `byte % length` unbiased — do not add or remove one
 * without re-deriving the entropy note above.
 */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeCode(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  // Grouped in fours for transcription; the groups are cosmetic and normalised away on verify.
  return (out.match(/.{1,4}/g) ?? [out]).join('-');
}

/**
 * Normalise before hashing or comparing: users retype these from paper, so case and the grouping
 * dash must not decide whether they get back into their account.
 */
export function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
}

export interface GeneratedRecoveryCodes {
  /** Plaintext — shown to the user exactly once and never persisted anywhere. */
  readonly codes: readonly string[];
  /** What the database stores, index-aligned with `codes`. */
  readonly hashes: readonly string[];
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): GeneratedRecoveryCodes {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) codes.push(encodeCode(randomBytes(RECOVERY_CODE_LENGTH)));
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/**
 * Constant-time membership test against the stored hashes.
 *
 * Compares every candidate rather than returning early: an attacker who can time the response must
 * not learn how far down the list a near-miss matched.
 */
export function findMatchingHash(code: string, storedHashes: readonly string[]): string | null {
  const candidate = Buffer.from(hashRecoveryCode(code));
  let found: string | null = null;
  for (const stored of storedHashes) {
    const other = Buffer.from(stored);
    if (candidate.length === other.length && timingSafeEqual(candidate, other)) found = stored;
  }
  return found;
}
