import { Injectable, NestMiddleware } from '@nestjs/common';
// Value import on purpose: a type-only import degrades the DI metadata to Function.
import { PrismaClient } from '@prisma/client';
import { evaluateSession, shouldTouchLastSeen, type SessionRejection, type VerifiedIdentity } from '@scraper/core';
import { toSessionState } from './auth.service.js';
import { hashToken } from './crypto.js';

/**
 * Resolves `Authorization: Bearer <token>` to req.userId + req.identity + req.stepUp (DB mode only).
 *
 * Every request revalidates against the database rather than trusting a decoded token, because
 * revocation must take effect immediately — "sign out everywhere" is the control a user reaches for
 * when they believe someone else is in their account, and a token that stays valid until it expires
 * makes that control a lie.
 *
 * Only fully MFA-verified, unexpired, unrevoked, non-idle sessions attach anything. The identity
 * attached is the caller's OWN Identity row mapped to the core VerifiedIdentity shape — status
 * included, so an UNVERIFIED identity still 403s at IdentityVerifiedGuard. No request input can vary
 * whose identity is attached (the anti-stalker rule, same as the dev middleware).
 *
 * Port wave 3 (ADR-035): the decision moved out of an inline boolean chain into `evaluateSession`,
 * which is where the idle timeout and step-up freshness live. This middleware now also SETS
 * `req.stepUp` — the substrate StepUpGuard reads. A guard that reads a flag nobody sets is a guard
 * that never fires, so the flag comes first.
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly db: PrismaClient) {}

  async use(
    req: Record<string, unknown> & { headers: Record<string, string | undefined> },
    _res: unknown,
    next: () => void,
  ): Promise<void> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return next();
    const now = new Date();
    const session = await this.db.session.findUnique({ where: { tokenHash: hashToken(auth.slice(7)) } });

    const verdict = evaluateSession(session ? toSessionState(session) : null, now);
    if (!verdict.ok) {
      // The reason is attached even on failure so the guards can answer honestly ("your session went
      // idle") instead of the single "not signed in" that sends a user round the sign-in loop with no
      // idea why. Nothing else is attached: an unusable session confers nothing.
      req.sessionRejection = verdict.reason satisfies SessionRejection;
      return next();
    }

    // An idle timeout is only meaningful if activity is recorded, but writing on every request turns
    // every read into a write. Touch at most once a minute (SESSION_TOUCH_INTERVAL_SECONDS).
    if (shouldTouchLastSeen(session!.lastSeenAt, now)) {
      await this.db.session.update({ where: { id: session!.id }, data: { lastSeenAt: now } });
    }

    const identity = await this.db.identity.findUnique({ where: { userId: verdict.userId }, include: { addresses: true } });
    req.userId = verdict.userId;
    req.stepUp = verdict.stepUp;
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
