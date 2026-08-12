import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
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
 * TODO(security): per-IP/per-account rate limiting is in-memory here (alpha); production needs a
 * shared limiter + lockout policy. TODO(security): envelope-encrypt totpSecret at rest (docs/03).
 */
@Injectable()
export class AuthService {
  private readonly attempts = new Map<string, { n: number; resetAt: number }>();

  constructor(private readonly db: PrismaClient) {}

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
    const user = await this.db.user.create({ data: { email: mail } });
    await this.db.$transaction([
      this.db.authCredential.create({ data: { userId: user.id, passwordHash: await hashPassword(password), totpSecret } }),
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
    if (!session.user.authCredential || !verifyTotp(session.user.authCredential.totpSecret, code)) {
      throw new UnauthorizedException({ error: 'BAD_TOTP', message: 'Der Code stimmt nicht. Bitte den aktuellen Code aus der Authenticator-App eingeben.' });
    }
    await this.db.session.update({ where: { id: session.id }, data: { mfaVerified: true } });
    return { mfaVerified: true };
  }

  async logout(token: string): Promise<void> {
    await this.db.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
