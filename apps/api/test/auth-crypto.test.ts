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
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
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
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, code, now + 30_000)).toBe(true); // +1 window
    expect(verifyTotp(secret, code, now + 90_000)).toBe(false); // +3 windows
    expect(verifyTotp(secret, '000000', now)).toBe(totp(secret, now) === '000000');
  });
});
