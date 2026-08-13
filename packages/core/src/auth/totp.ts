/**
 * RFC 6238 TOTP (RFC 4226 HOTP underneath) — the second factor for sign-in AND for step-up.
 *
 * Implemented rather than depended on: it is ~60 lines of well-specified arithmetic, and an auth
 * dependency is a supply-chain path straight into the account that holds a user's credit file
 * (docs/06 C2). The trade is deliberate and narrow — everything below is the RFC with no invention.
 *
 * Port wave 3 (ADR-035) moved this out of `apps/api/src/auth/crypto.ts` for one reason: REPLAY
 * DEFENCE. The previous implementation returned a bare boolean, so a code read over someone's
 * shoulder — or captured from a phishing proxy — stayed valid for the rest of its ±30s window and
 * could be presented again. `verifyTotp` now returns the counter that matched so the caller can
 * persist it and refuse anything at or below it. A boolean cannot express that, which is why the
 * signature changed rather than the internals.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;

/**
 * Periods accepted either side of "now".
 *
 * 1 means ±30s, tolerating ordinary clock skew and a user who starts typing as the code rolls.
 * Wider windows are a real weakening — each extra step is another simultaneously-valid code for a
 * brute-forcer — so this stays at 1 and the MFA throttle (session.ts) does the rest.
 */
export const TOTP_WINDOW_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export class TotpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TotpError';
  }
}

/** Base32 (RFC 4648, no padding) — the encoding authenticator apps expect. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(encoded: string): Uint8Array {
  const clean = encoded.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new TotpError(`invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** HOTP (RFC 4226) for one counter value. The secret is base32, as stored and as shown to the app. */
export function hotp(secretBase32: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', Buffer.from(base32Decode(secretBase32))).update(buf).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fff_ffff;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** The counter a moment falls in. Exported because replay defence is arithmetic on counters. */
export function totpCounterAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function totp(secretBase32: string, nowMs: number = Date.now()): string {
  return hotp(secretBase32, totpCounterAt(nowMs));
}

export type TotpFailure = 'MALFORMED' | 'MISMATCH' | 'REPLAYED';

export type TotpVerdict =
  | { readonly ok: true; readonly counter: number }
  | { readonly ok: false; readonly reason: TotpFailure };

/**
 * Verify a submitted code.
 *
 * Returns the matching counter so the caller can persist it as `totpLastCounter` and refuse a
 * replay. `lastUsedCounter` of `null` means "no code has ever been accepted for this user" — the
 * enrolment case — and is NOT the same as 0, which would reject the counter-0 code.
 *
 * The replay check sits INSIDE the match branch on purpose: a stale-but-correct code must report
 * REPLAYED, not MISMATCH. The two are different events — one is an attacker replaying a captured
 * code, the other is a wrong code — and a throttle that cannot tell them apart cannot alert on the
 * first. Comparison is constant-time.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number = Date.now(),
  lastUsedCounter: number | null = null,
): TotpVerdict {
  const trimmed = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(trimmed)) return { ok: false, reason: 'MALFORMED' };

  const current = totpCounterAt(nowMs);
  for (let drift = -TOTP_WINDOW_STEPS; drift <= TOTP_WINDOW_STEPS; drift += 1) {
    const counter = current + drift;
    const expected = Buffer.from(hotp(secretBase32, counter));
    const given = Buffer.from(trimmed);
    if (expected.length === given.length && timingSafeEqual(expected, given)) {
      if (lastUsedCounter !== null && counter <= lastUsedCounter) return { ok: false, reason: 'REPLAYED' };
      return { ok: true, counter };
    }
  }
  return { ok: false, reason: 'MISMATCH' };
}

/**
 * otpauth:// URI for the enrolment QR code. The account label is the user's own email and the issuer
 * is us — both are shown inside the user's authenticator app and go nowhere else.
 */
export function totpProvisioningUri(account: string, secretBase32: string, issuer = 'Scraper'): string {
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${params.toString()}`;
}
