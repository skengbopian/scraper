import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { AesGcmEnvelopeCrypto, DevKekResolver, EnvKekResolver, EnvelopeSecretCipher, type UserKeyResolver } from '@scraper/core';
import { generateTotpSecret, hashPassword, hashToken, newSessionToken, totpProvisioningUri, verifyPassword, verifyTotp } from './crypto.js';

const SESSION_TTL_MS = 12 * 3600_000;

/**
 * Real auth (docs/01 P0): email + password + TOTP MFA, sessions as hashed bearer tokens.
 * Prisma-backed — auth exists only in DB mode (SCRAPER_REPOSITORY=prisma); the in-memory alpha keeps
 * using the dev-fixture identity instead. Registration creates the account AND an UNVERIFIED
 * Identity row: authentication never touches the identity-verification gate — a fresh account can
 * log in and still cannot create a rights request until the ident provider marks it VERIFIED
 * (stubbed in the alpha via /identity/verify-stub, dev-only).
 *
 * The TOTP secret is envelope-encrypted at rest under the user's DEK (CLAUDE.md §4, port wave 1) —
 * a database dump does not hand over the second factor.
 * TODO(security): per-IP/per-account rate limiting is in-memory here (alpha); production needs a
 * shared limiter + lockout policy. TODO(security): adopt the pre-audit line's richer session policy
 * (step-up, idle timeout, TOTP replay defence, recovery codes, durable throttling) in port wave 3.
 */
@Injectable()
export class AuthService {
  private readonly attempts = new Map<string, { n: number; resetAt: number }>();
  private readonly secrets: EnvelopeSecretCipher;

  constructor(private readonly db: PrismaClient) {
    // KEKs come from the environment in any deployed setting; the dev resolver derives a shared,
    // deliberately non-secret key and refuses to run under NODE_ENV=production.
    const keks = process.env.SCRAPER_KEK_MODE === 'env' ? new EnvKekResolver() : new DevKekResolver();
    const keys: UserKeyResolver = {
      getUserKey: async (userId: string) => {
        const u = await this.db.user.findUnique({ where: { id: userId }, select: { wrappedDek: true, kekRef: true } });
        if (!u?.wrappedDek || !u.kekRef) throw new Error(`user ${userId} has no envelope key material`);
        return { wrappedDek: Buffer.from(u.wrappedDek), kekRef: u.kekRef };
      },
    };
    this.secrets = new EnvelopeSecretCipher(new AesGcmEnvelopeCrypto(keks), keys);
  }

  private throttle(key: string): void {
    const now = Date.now();
    const a = this.attempts.get(key);
    if (a && a.resetAt > now && a.n >= 10) {
      throw new ForbiddenException({ error: 'RATE_LIMITED', message: 'Zu viele Versuche. Bitte warten Sie 15 Minuten.' });
    }
    this.attempts.set(key, a && a.resetAt > now ? { n: a.n + 1, resetAt: a.resetAt } : { n: 1, resetAt: now + 15 * 60_000 });
  }

  async register(email: string, password: string): Promise<{ userId: string; totpSecret: string; totpProvisioningUri: string }> {
    const mail = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new BadRequestException({ error: 'INVALID_EMAIL', message: 'Bitte eine gültige E-Mail-Adresse angeben.' });
    if (password.length < 10) throw new BadRequestException({ error: 'WEAK_PASSWORD', message: 'Das Passwort braucht mindestens 10 Zeichen.' });
    const existing = await this.db.user.findUnique({ where: { email: mail } });
    if (existing) throw new BadRequestException({ error: 'EMAIL_TAKEN', message: 'Für diese E-Mail existiert bereits ein Konto.' });

    const totpSecret = generateTotpSecret();
    // The per-user DEK is provisioned WITH the user, before any credential exists — the 0004 trigger
    // refuses a credential row whose user has no key material, so the secret can never be unopenable.
    const crypto = new AesGcmEnvelopeCrypto(process.env.SCRAPER_KEK_MODE === 'env' ? new EnvKekResolver() : new DevKekResolver());
    const kekRef = 'user';
    const { wrappedDek } = await crypto.generateWrappedDek(kekRef);
    const user = await this.db.user.create({ data: { email: mail, wrappedDek, kekRef } });
    const totpSecretEnc = await this.secrets.encrypt(user.id, Buffer.from(totpSecret, 'utf8'));
    await this.db.$transaction([
      this.db.authCredential.create({ data: { userId: user.id, passwordHash: await hashPassword(password), totpSecretEnc } }),
      // The identity record exists from minute one — UNVERIFIED, so every request route 403s until
      // the ident provider verifies. Auth and identity verification are deliberately separate gates.
      this.db.identity.create({ data: { userId: user.id, status: 'UNVERIFIED' } }),
    ]);
    return { userId: user.id, totpSecret, totpProvisioningUri: totpProvisioningUri(mail, totpSecret) };
  }

  /** Step 1: password. Returns a session that is NOT yet MFA-verified — only /auth/totp upgrades it. */
  async login(email: string, password: string): Promise<{ token: string; mfaRequired: true }> {
    const mail = email.trim().toLowerCase();
    this.throttle(`login:${mail}`);
    const user = await this.db.user.findUnique({ where: { email: mail }, include: { authCredential: true } });
    if (!user?.authCredential || !(await verifyPassword(password, user.authCredential.passwordHash))) {
      throw new UnauthorizedException({ error: 'BAD_CREDENTIALS', message: 'E-Mail oder Passwort stimmt nicht.' });
    }
    const { token, tokenHash } = newSessionToken();
    await this.db.session.create({ data: { tokenHash, userId: user.id, mfaVerified: false, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
    return { token, mfaRequired: true };
  }

  /** Step 2: TOTP. Upgrades the session; guarded routes only accept mfaVerified sessions. */
  async verifyTotpStep(token: string, code: string): Promise<{ mfaVerified: true }> {
    const session = await this.db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { authCredential: true } } } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw new UnauthorizedException({ error: 'NO_SESSION', message: 'Bitte neu anmelden.' });
    this.throttle(`totp:${session.userId}`);
    const enc = session.user.authCredential?.totpSecretEnc;
    const secret = enc ? (await this.secrets.decrypt(session.userId, Buffer.from(enc))).toString('utf8') : null;
    if (!secret || !verifyTotp(secret, code)) {
      throw new UnauthorizedException({ error: 'BAD_TOTP', message: 'Der Code stimmt nicht. Bitte den aktuellen Code aus der Authenticator-App eingeben.' });
    }
    await this.db.session.update({ where: { id: session.id }, data: { mfaVerified: true } });
    return { mfaVerified: true };
  }

  async logout(token: string): Promise<void> {
    await this.db.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
