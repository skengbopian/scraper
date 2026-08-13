import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Migration 0005 (port wave 1b): the pre-audit line's database invariants, re-expressed here.
 *
 * These are negative-case tests by design — an invariant that has never been seen to REJECT
 * something is an invariant nobody knows works. Each case does the wrong thing and expects the
 * database to refuse, plus the adjacent legitimate operation to confirm the rule is not too wide.
 *
 * Runs only with DATABASE_URL_TEST (skipped otherwise, like the other DB suites).
 */
const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)('database invariants (0005 + 0008)', () => {
  let db: PrismaClient;
  let controllerId: string;
  let userId: string;
  let identityId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SCRAPER_DEV_FIXTURES = '1';
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$executeRawUnsafe(
      `TRUNCATE TABLE "FileFinding","CreditFileEntry","CreditFileSnapshot","RequestEvent","ControllerResponse","EvidenceRecord","RightsRequest","Playbook","SelfServeRoute","LeverageAction","RecoveryCode","Session","AuthCredential","Mandate","IdentityAddress","Identity","User","Controller" CASCADE`,
    );
    const { seed } = await import('../dist/db/seed.js');
    await seed(db);
    controllerId = (await db.controller.findFirstOrThrow({ where: { slug: 'schufa' } })).id;
    const u = await db.user.findFirstOrThrow({ where: { email: 'erika@example.com' } });
    userId = u.id;
    identityId = (await db.identity.findFirstOrThrow({ where: { userId } })).id;
  });

  afterAll(async () => {
    await db?.$disconnect();
    delete process.env.SCRAPER_DEV_FIXTURES;
  });

  it('(1) refuses a second ACTIVE playbook for the same controller + requestType', async () => {
    // The seed already activated demo.schufa.access_art15 for this pair.
    await expect(
      db.playbook.create({
        data: {
          controllerId, slug: 'rival.schufa.access', requestType: 'ACCESS_ART15', version: 1,
          active: true, document: {},
        },
      }),
    ).rejects.toThrow();
    // An INACTIVE sibling is fine — that is how a new version waits for sign-off.
    const inactive = await db.playbook.create({
      data: { controllerId, slug: 'rival.schufa.access', requestType: 'ACCESS_ART15', version: 2, active: false, document: {} },
    });
    expect(inactive.active).toBe(false);
    await db.playbook.delete({ where: { id: inactive.id } });
  });

  it('(2) freezes a shipped playbook version, but still allows activation to flip', async () => {
    const pb = await db.playbook.findFirstOrThrow({ where: { slug: 'demo.schufa.access_art15' } });
    await expect(
      db.playbook.update({ where: { id: pb.id }, data: { document: { tampered: true } } }),
    ).rejects.toThrow(/immutable except/);
    const flipped = await db.playbook.update({ where: { id: pb.id }, data: { active: false } });
    expect(flipped.active).toBe(false);
    await db.playbook.update({ where: { id: pb.id }, data: { active: true } });
  });

  it('(3) freezes a VERIFIED identity’s subject fields, and allows re-verification via a status change', async () => {
    await expect(
      db.identity.update({ where: { id: identityId }, data: { legalName: 'Someone Else' } }),
    ).rejects.toThrow(/VERIFIED identity is immutable/);

    // The legitimate path: leave VERIFIED, then correct, then verify again.
    await db.identity.update({ where: { id: identityId }, data: { status: 'EXPIRED' } });
    const corrected = await db.identity.update({ where: { id: identityId }, data: { legalName: 'Erika Mustermann-Neu' } });
    expect(corrected.legalName).toBe('Erika Mustermann-Neu');
    await db.identity.update({ where: { id: identityId }, data: { status: 'VERIFIED', legalName: 'Erika Mustermann' } });
  });

  it('(4) freezes a request’s binding while allowing its state to advance', async () => {
    const playbook = await db.playbook.findFirstOrThrow({ where: { slug: 'demo.schufa.access_art15' } });
    const req = await db.rightsRequest.create({
      data: {
        userId, controllerId, playbookId: playbook.id, requestType: 'ACCESS_ART15',
        state: 'READY', channel: 'email', cycleOrdinal: 1, idempotencyKey: `inv-test-${Date.now()}`,
      },
    });
    const otherController = await db.controller.findFirstOrThrow({ where: { slug: 'infoscore' } });
    await expect(
      db.rightsRequest.update({ where: { id: req.id }, data: { controllerId: otherController.id } }),
    ).rejects.toThrow(/binding .* is fixed at creation/);
    await expect(
      db.rightsRequest.update({ where: { id: req.id }, data: { idempotencyKey: 'rewritten' } }),
    ).rejects.toThrow(/fixed at creation/);
    // State movement is the whole point of the row and stays permitted.
    const sent = await db.rightsRequest.update({ where: { id: req.id }, data: { state: 'SENT' } });
    expect(sent.state).toBe('SENT');
  });

  it('(5) refuses a login-gated self-serve route with no guided steps', async () => {
    await expect(
      db.selfServeRoute.create({
        data: { companySlug: 'example', routeType: 'DSR_ERASURE', url: 'https://example.test/x', steps: [], requiresLogin: true },
      }),
    ).rejects.toThrow();
    const ok = await db.selfServeRoute.create({
      data: {
        companySlug: 'example', routeType: 'DSR_ERASURE', url: 'https://example.test/x',
        steps: ['Melden Sie sich in Ihrem Konto an.'], requiresLogin: true,
      },
    });
    expect(ok.requiresLogin).toBe(true);
    await db.selfServeRoute.delete({ where: { id: ok.id } });
  });

  it('(6) refuses to retain a raw controller document without a scheduled purge', async () => {
    // A DIFFERENT controller on purpose: case (4) leaves a non-terminal request on schufa, and
    // 0001's one_open_request_per_triple correctly forbids a second open request for that triple.
    const playbook = await db.playbook.findFirstOrThrow({ where: { slug: 'demo.infoscore.access_art15_source' } });
    const infoscore = await db.controller.findFirstOrThrow({ where: { slug: 'infoscore' } });
    const req = await db.rightsRequest.create({
      data: {
        userId, controllerId: infoscore.id, playbookId: playbook.id, requestType: 'ACCESS_ART15_SOURCE',
        state: 'AWAITING_RESPONSE', channel: 'email', cycleOrdinal: 1, idempotencyKey: `purge-test-${Date.now()}`,
      },
    });
    await expect(
      db.controllerResponse.create({
        data: {
          requestId: req.id, receivedAt: new Date(), channel: 'email',
          rawDocumentRef: 's3://evidence/raw-letter.pdf', structured: {}, parseConfidence: 0.9,
        },
      }),
    ).rejects.toThrow();

    const withPurge = await db.controllerResponse.create({
      data: {
        requestId: req.id, receivedAt: new Date(), channel: 'email',
        rawDocumentRef: 's3://evidence/raw-letter.pdf', purgeRawAt: new Date(Date.now() + 30 * 86_400_000),
        structured: {}, parseConfidence: 0.9,
      },
    });
    expect(withPurge.purgeRawAt).not.toBeNull();

    // A normalised-only response (no raw reference retained) needs no purge date.
    const normalisedOnly = await db.controllerResponse.create({
      data: { requestId: req.id, receivedAt: new Date(), channel: 'email', structured: { ok: true }, parseConfidence: 0.9 },
    });
    expect(normalisedOnly.rawDocumentRef).toBeNull();
  });

  // -------------------------------------------------------------------------------------------
  // Migration 0008 (port wave 3, ADR-035): the auth policy's invariants.
  //
  // Same discipline: every rule is shown REJECTING, and then the adjacent legitimate operation is
  // shown succeeding, because a constraint that also blocks correct behaviour is its own outage.
  // -------------------------------------------------------------------------------------------

  const liveSession = (over: Record<string, unknown> = {}) => ({
    tokenHash: `t_${Math.random().toString(36).slice(2)}_${Date.now()}`,
    userId,
    expiresAt: new Date(Date.now() + 3_600_000),
    ...over,
  });

  it('(0008-1) refuses a session whose mfaVerified and mfaCompletedAt disagree', async () => {
    // Verified with no timestamp: the middleware would treat it as signed in while the policy sees
    // no second factor at all.
    await expect(db.session.create({ data: liveSession({ mfaVerified: true, mfaCompletedAt: null }) })).rejects.toThrow();
    // And the inverse — a timestamp with the flag off — is equally a disagreement.
    await expect(db.session.create({ data: liveSession({ mfaVerified: false, mfaCompletedAt: new Date() }) })).rejects.toThrow();

    const ok = await db.session.create({ data: liveSession({ mfaVerified: true, mfaCompletedAt: new Date() }) });
    expect(ok.mfaVerified).toBe(true);
    const halfAuthenticated = await db.session.create({ data: liveSession({ mfaVerified: false, mfaCompletedAt: null }) });
    expect(halfAuthenticated.mfaCompletedAt).toBeNull();
  });

  it('(0008-2) refuses step-up on a session that never completed MFA', async () => {
    await expect(
      db.session.create({ data: liveSession({ mfaVerified: false, mfaCompletedAt: null, stepUpAt: new Date() }) }),
    ).rejects.toThrow();

    // Nor can it be reached by updating afterwards — the CHECK is evaluated on the new row either way.
    const half = await db.session.create({ data: liveSession({ mfaVerified: false, mfaCompletedAt: null }) });
    await expect(db.session.update({ where: { id: half.id }, data: { stepUpAt: new Date() } })).rejects.toThrow();

    const verified = await db.session.create({ data: liveSession({ mfaVerified: true, mfaCompletedAt: new Date() }) });
    const stepped = await db.session.update({ where: { id: verified.id }, data: { stepUpAt: new Date() } });
    expect(stepped.stepUpAt).not.toBeNull();
  });

  it('(0008-3) refuses a TOTP replay counter that moves backwards or is cleared', async () => {
    await db.user.update({ where: { id: userId }, data: { totpLastCounter: BigInt(1000) } });

    // Rewinding re-opens every code in between — exactly what two racing MFA submissions would do.
    await expect(db.user.update({ where: { id: userId }, data: { totpLastCounter: BigInt(999) } })).rejects.toThrow();
    // Clearing it disables replay defence entirely.
    await expect(db.user.update({ where: { id: userId }, data: { totpLastCounter: null } })).rejects.toThrow();

    const forward = await db.user.update({ where: { id: userId }, data: { totpLastCounter: BigInt(1001) } });
    expect(forward.totpLastCounter).toBe(BigInt(1001));
    // Re-accepting the SAME counter is refused by the application (verifyTotp returns REPLAYED); the
    // trigger's job is only to stop the value going down, so an equal write stays legal here.
    const same = await db.user.update({ where: { id: userId }, data: { totpLastCounter: BigInt(1001) } });
    expect(same.totpLastCounter).toBe(BigInt(1001));
  });

  it('(0008-4) refuses redeeming a recovery code twice, un-using one, or re-pointing it', async () => {
    const code = await db.recoveryCode.create({ data: { userId, codeHash: `h_${Date.now()}` } });

    const used = await db.recoveryCode.update({ where: { id: code.id }, data: { usedAt: new Date() } });
    expect(used.usedAt).not.toBeNull();

    // The second redemption — the one a concurrent double-submit would attempt.
    await expect(db.recoveryCode.update({ where: { id: code.id }, data: { usedAt: new Date() } })).rejects.toThrow();
    // Un-using it would silently restore a credential an attacker may already have spent.
    await expect(db.recoveryCode.update({ where: { id: code.id }, data: { usedAt: null } })).rejects.toThrow();

    // The code and its owner are immutable: re-pointing a spent code at another user would hand them
    // a credential. (Checked on a FRESH code, since the used one is already frozen above.)
    const other = await db.recoveryCode.create({ data: { userId, codeHash: `h2_${Date.now()}` } });
    await expect(db.recoveryCode.update({ where: { id: other.id }, data: { codeHash: 'rewritten' } })).rejects.toThrow();
  });

  it('(0008-5) refuses negative failure counters, which would disable the lockout they drive', async () => {
    await expect(db.user.update({ where: { id: userId }, data: { failedLoginCount: -1 } })).rejects.toThrow();
    await expect(db.user.update({ where: { id: userId }, data: { failedMfaCount: -1 } })).rejects.toThrow();

    const ok = await db.user.update({ where: { id: userId }, data: { failedLoginCount: 3, failedMfaCount: 2 } });
    expect(ok.failedLoginCount).toBe(3);
    // The two budgets are independent columns — that separation IS the control (ADR-035).
    expect(ok.failedMfaCount).toBe(2);
    await db.user.update({ where: { id: userId }, data: { failedLoginCount: 0, failedMfaCount: 0 } });
  });

  it('(0008-6) keeps the partial expiry-sweep index the session cleanup depends on', async () => {
    const rows = await db.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'session_expiry_sweep'`,
    );
    expect(rows).toHaveLength(1);
    // Partial on live sessions: an index that also carries revoked rows grows without bound.
    expect(rows[0]!.indexdef).toMatch(/WHERE .*"?revokedAt"? IS NULL/i);
  });

  it('(0008-7) the atomic throttle SQL agrees with the pure policy it duplicates', async () => {
    // `AuthService.bumpThrottle` expresses nextThrottleState's FAILURE branch in SQL so the counter
    // can move under a row lock (a read-then-write loses N-1 of N concurrent failures). Two
    // expressions of one rule is exactly the shape that drifts, so compare them directly.
    const { nextThrottleState, LOGIN_THROTTLE } = await import('@scraper/core');
    const bump = async (count: number, at: Date | null, now: Date): Promise<{ n: number; at: Date | null }> => {
      await db.user.update({ where: { id: userId }, data: { failedLoginCount: count, lastFailedLoginAt: at } });
      await db.$executeRawUnsafe(
        `UPDATE "User"
            SET "failedLoginCount" = CASE
                  WHEN "lastFailedLoginAt" IS NOT NULL AND $2::timestamp - "lastFailedLoginAt" >= make_interval(mins => $3::int)
                  THEN 1 ELSE "failedLoginCount" + 1 END,
                "lastFailedLoginAt" = $2::timestamp
          WHERE "id" = $1`,
        userId, now, LOGIN_THROTTLE.lockoutMinutes,
      );
      const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
      return { n: u.failedLoginCount, at: u.lastFailedLoginAt };
    };

    const now = new Date('2026-08-13T12:00:00Z');
    const fresh = new Date(now.getTime() - 60_000);                                     // inside the window
    const stale = new Date(now.getTime() - (LOGIN_THROTTLE.lockoutMinutes + 1) * 60_000); // window expired

    for (const [count, at] of [[3, fresh], [3, stale], [0, null]] as [number, Date | null][]) {
      const sql = await bump(count, at, now);
      const policy = nextThrottleState({ failedCount: count, lastFailedAt: at }, 'FAILURE', LOGIN_THROTTLE, now);
      expect(sql.n, `count=${count} at=${String(at)}`).toBe(policy.failedCount);
      expect(sql.at?.toISOString()).toBe(policy.lastFailedAt?.toISOString());
    }
    await db.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lastFailedLoginAt: null } });
  });
});
