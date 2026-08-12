import { Injectable, NestMiddleware } from '@nestjs/common';
// Value import on purpose: a type-only import degrades the DI metadata to Function.
import { PrismaClient } from '@prisma/client';
import type { VerifiedIdentity } from '@scraper/core';
import { hashToken } from './crypto.js';

/**
 * Resolves `Authorization: Bearer <token>` to req.userId + req.identity (DB mode only).
 *
 * Only fully MFA-verified, unexpired, unrevoked sessions attach anything. The identity attached is
 * the caller's OWN Identity row mapped to the core VerifiedIdentity shape — status included, so an
 * UNVERIFIED identity still 403s at IdentityVerifiedGuard. No request input can vary whose identity
 * is attached (the anti-stalker rule, same as the dev middleware).
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly db: PrismaClient) {}

  async use(req: Record<string, unknown> & { headers: Record<string, string | undefined> }, _res: unknown, next: () => void): Promise<void> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return next();
    const session = await this.db.session.findUnique({ where: { tokenHash: hashToken(auth.slice(7)) } });
    if (!session || !session.mfaVerified || session.revokedAt || session.expiresAt < new Date()) return next();

    const identity = await this.db.identity.findUnique({ where: { userId: session.userId }, include: { addresses: true } });
    req.userId = session.userId;
    if (identity) {
      const mapped: VerifiedIdentity = {
        id: identity.id,
        userId: identity.userId,
        status: identity.status as VerifiedIdentity['status'],
        method: (identity.method ?? 'EID') as VerifiedIdentity['method'],
        legalName: identity.legalName ?? '',
        dateOfBirth: identity.dateOfBirth ?? new Date(0),
        addresses: identity.addresses.map((a) => ({
          street: a.street, postalCode: a.postalCode, city: a.city, country: a.country,
          current: a.current, verifiedAt: a.verifiedAt ?? new Date(0),
        })),
        verifiedAt: identity.verifiedAt ?? new Date(0),
        providerRef: identity.providerRef ?? '',
      };
      req.identity = mapped;
    }
    next();
  }
}
