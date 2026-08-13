import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
// Value import: a type-only import erases the constructor parameter and breaks Nest's DI metadata.
import { PrismaClient } from '@prisma/client';

/**
 * The ops gate (port wave 5, ADR-037).
 *
 * Ops routes are the most privileged surface in this product. They read across users' request
 * ledgers, they close statutory requests permanently, and one of them files an Art. 77 complaint in
 * a named person's name. Two properties follow, and both are structural rather than procedural:
 *
 * **1. The role is read from the database, never from the request.** The pre-audit line gated these
 * routes on an `x-ops-role: true` header behind an env flag, and its own comment records what that
 * cost before the flag existed: an unauthenticated caller who sent the header received the whole
 * ledger — a map of who is exercising rights against whom, which is precisely the targeting signal
 * `CLAUDE.md`'s one rule exists to suppress. Here the guard resolves `User.role` for the session
 * the middleware already authenticated. There is no header, body field or query parameter that
 * reaches this decision.
 *
 * **2. It fails closed on every uncertainty.** No session, no user row, a user row that has since
 * been deleted — all 403. `role !== 'HUMAN_OPS'` is a strict comparison against the enum, so a
 * future third role is denied by default rather than admitted by a truthy check.
 *
 * TODO(safety): dedicated ops identities with their own credentials, and per-actor attribution in
 * the evidence chain, are the next step (OQ-27). What is here already holds the line that matters —
 * an ordinary signed-in user cannot reach these routes — but an ops account is still an ordinary
 * account with a flag, so a compromised ops password is a compromised ops surface.
 */
@Injectable()
export class OpsRoleGuard implements CanActivate {
  constructor(private readonly db: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ userId?: string }>();
    const userId = req.userId;
    // `reason` mirrors `error` because the web client routes 403s on the machine-readable code, not
    // on the prose — the prose changes with the register on every page (ADR-034). Without it an ops
    // 403 would fall through to the generic 403 branch and tell the caller to verify their identity.
    if (!userId) {
      throw new ForbiddenException({
        error: 'OPS_ROLE_REQUIRED',
        reason: 'OPS_ROLE_REQUIRED',
        message: 'ops routes require an authenticated session',
        nextAction: 'SIGN_IN',
      });
    }
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role !== 'HUMAN_OPS') {
      throw new ForbiddenException({
        error: 'OPS_ROLE_REQUIRED',
        reason: 'OPS_ROLE_REQUIRED',
        message: 'this surface is restricted to the review team',
        nextAction: 'NONE',
      });
    }
    return true;
  }
}
