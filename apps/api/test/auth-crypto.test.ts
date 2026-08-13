import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hashPassword, hotp, totp, verifyPassword, verifyTotp } from '../src/auth/crypto.js';

describe('password hashing', () => {
  it('round-trips and rejects wrong passwords', async () => {
    const stored = await hashPassword('korrekt-pferd-batterie-heftklammer');
    expect(stored.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('korrekt-pferd-batterie-heftklammer', stored)).toBe(true);
    expect(await verifyPassword('falsches-passwort', stored)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('base32', () => {
  it('round-trips', () => {
    const buf = Buffer.from('12345678901234567890', 'ascii');
    // base32Decode returns a Uint8Array since port wave 3 moved TOTP into @scraper/core, where the
    // module stays free of Node Buffer in its public shape.
    expect(Buffer.from(base32Decode(base32Encode(buf))).equals(buf)).toBe(true);
  });
});

describe('HOTP/TOTP (RFC 4226 appendix D vectors, 6-digit)', () => {
  // Secret "12345678901234567890" (ascii) → counts 0..5.
  const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
  const vectors = ['755224', '287082', '359152', '969429', '338314', '254676'];
  it('matches the RFC vectors', () => {
    vectors.forEach((v, i) => expect(hotp(secret, i)).toBe(v));
  });
  it('TOTP accepts current and adjacent windows only', () => {
    const now = 1_700_000_000_000;
    const code = totp(secret, now);
    expect(verifyTotp(secret, code, now).ok).toBe(true);
    expect(verifyTotp(secret, code, now + 30_000).ok).toBe(true); // +1 window
    expect(verifyTotp(secret, code, now + 90_000).ok).toBe(false); // +3 windows
  });

  it('rejects a REPLAYED code distinctly from a wrong one (port wave 3)', () => {
    const now = 1_700_000_000_000;
    const code = totp(secret, now);
    const first = verifyTotp(secret, code, now);
    expect(first.ok).toBe(true);
    const counter = first.ok ? first.counter : -1;

    // The same code, presented again after the counter was recorded. Without this the code stayed
    // valid for the rest of its window — a code read over a shoulder was still a working credential.
    const replay = verifyTotp(secret, code, now, counter);
    expect(replay.ok).toBe(false);
    expect(replay.ok === false && replay.reason).toBe('REPLAYED');

    // A wrong code reports MISMATCH, not REPLAYED: the two are different events, and a throttle that
    // cannot tell them apart cannot alert on the one that means "somebody captured a code".
    const wrong = verifyTotp(secret, '000001', now, counter);
    expect(wrong.ok === false && wrong.reason).toBe('MISMATCH');
    expect(verifyTotp(secret, 'abc', now).ok === false && verifyTotp(secret, 'abc', now)).toMatchObject({ reason: 'MALFORMED' });

    // The NEXT window is still accepted — replay defence must not lock a user out of their own app.
    const next = verifyTotp(secret, totp(secret, now + 30_000), now + 30_000, counter);
    expect(next.ok).toBe(true);
  });
});
