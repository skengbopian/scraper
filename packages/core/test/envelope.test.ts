import { describe, expect, it } from 'vitest';
import {
  AesGcmEnvelopeCrypto,
  DevKekResolver,
  EnvKekResolver,
  EnvelopeSecretCipher,
  type UserKeyResolver,
} from '../src/crypto/envelope.js';

/**
 * Per-user envelope encryption (CLAUDE.md §4). Ported with the implementation from the pre-audit
 * line in port wave 1; the tests below are extended beyond A's with the production-posture cases.
 */
const crypto = new AesGcmEnvelopeCrypto(new DevKekResolver());

describe('AesGcmEnvelopeCrypto', () => {
  it('round-trips a payload through a wrapped DEK', async () => {
    const { wrappedDek } = await crypto.generateWrappedDek('u1');
    const plaintext = Buffer.from('Erika Mustermann, 12.03.1979', 'utf8');
    const sealed = await crypto.encrypt(wrappedDek, 'u1', plaintext);
    expect(sealed.equals(plaintext)).toBe(false);
    expect(sealed.toString('utf8')).not.toContain('Mustermann');
    expect((await crypto.decrypt(wrappedDek, 'u1', sealed)).equals(plaintext)).toBe(true);
  });

  it('every generated DEK is unique — no two wraps share key material', async () => {
    const a = await crypto.generateWrappedDek('u1');
    const b = await crypto.generateWrappedDek('u1');
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
  });

  it('detects tampering rather than returning garbage (GCM auth)', async () => {
    const { wrappedDek } = await crypto.generateWrappedDek('u1');
    const sealed = await crypto.encrypt(wrappedDek, 'u1', Buffer.from('sensitive'));
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 0x01;
    await expect(crypto.decrypt(wrappedDek, 'u1', tampered)).rejects.toThrow();
  });

  it('refuses a DEK wrapped under a different KEK', async () => {
    const { wrappedDek } = await crypto.generateWrappedDek('u1');
    const sealed = await crypto.encrypt(wrappedDek, 'u1', Buffer.from('x'));
    await expect(crypto.decrypt(wrappedDek, 'u2', sealed)).rejects.toThrow();
  });

  it('rejects a truncated envelope instead of reading past the end', async () => {
    const { wrappedDek } = await crypto.generateWrappedDek('u1');
    await expect(crypto.decrypt(wrappedDek, 'u1', Buffer.alloc(8))).rejects.toThrow(/too short/);
  });
});

describe('KEK resolvers', () => {
  it('EnvKekResolver requires exactly 32 bytes of base64', () => {
    const ok = new EnvKekResolver({ SCRAPER_KEK_USER_1: Buffer.alloc(32, 7).toString('base64') } as NodeJS.ProcessEnv);
    expect(ok.getKek('user-1').length).toBe(32);
    expect(() => new EnvKekResolver({} as NodeJS.ProcessEnv).getKek('user-1')).toThrow(/not set/);
    const short = new EnvKekResolver({ SCRAPER_KEK_U: Buffer.alloc(16).toString('base64') } as NodeJS.ProcessEnv);
    expect(() => short.getKek('u')).toThrow(/32 bytes/);
  });

  it('DevKekResolver refuses to run in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new DevKekResolver().getKek('u1')).toThrow(/never run in production/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('EnvelopeSecretCipher (the TOTP secret at rest)', () => {
  it('seals and opens per user, and one user cannot open another’s secret', async () => {
    const keys = new Map<string, { wrappedDek: Buffer; kekRef: string }>();
    for (const u of ['u1', 'u2']) keys.set(u, { ...(await crypto.generateWrappedDek(u)), kekRef: u });
    const resolver: UserKeyResolver = {
      async getUserKey(userId) {
        const k = keys.get(userId);
        if (!k) throw new Error(`no key for ${userId}`);
        return k;
      },
    };
    const cipher = new EnvelopeSecretCipher(crypto, resolver);
    const secret = Buffer.from('JBSWY3DPEHPK3PXP', 'utf8');
    const sealed = await cipher.encrypt('u1', secret);
    expect(sealed.toString('utf8')).not.toContain('JBSWY3DPEHPK3PXP');
    expect((await cipher.decrypt('u1', sealed)).equals(secret)).toBe(true);
    await expect(cipher.decrypt('u2', sealed)).rejects.toThrow();
  });
});
