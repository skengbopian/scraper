import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * The durable-timer loop against real Postgres + pg-boss (skipped without DATABASE_URL_TEST):
 * schedule → pg-boss delivers → handler applies the REAL transition → a duplicate/stale timer
 * no-ops via the state guard.
 */
const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)('pg-boss deadline runner (integration)', () => {
  let db: PrismaClient;
  let engine: import('@scraper/api/dist/scheduler/pg-boss-engine.js').PgBossEngine;
  let boss: import('pg-boss').default;

  beforeAll(async () => {
    process.env.SCRAPER_DEV_FIXTURES = '1';
    db = new PrismaClient({ datasources: { db: { url } } });
    const { seed } = await import('@scraper/api/dist/db/seed.js');
    // TRUNCATE, not deleteMany: RequestEvent is append-only by trigger (0001) — row deletes are
    // forbidden even in tests, which is exactly the point of the trigger. 0013 blocks TRUNCATE
    // too; the throwaway test DB disables that guard explicitly around the reset.
    await db.$executeRawUnsafe('ALTER TABLE "RequestEvent" DISABLE TRIGGER "request_event_no_truncate"');
    await db.$executeRawUnsafe('ALTER TABLE "EvidenceRecord" DISABLE TRIGGER "evidence_record_no_truncate"');
    try {
      await db.$executeRawUnsafe('TRUNCATE TABLE "RequestEvent","ControllerResponse","EvidenceRecord","RightsRequest" CASCADE');
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "RequestEvent" ENABLE TRIGGER "request_event_no_truncate"');
      await db.$executeRawUnsafe('ALTER TABLE "EvidenceRecord" ENABLE TRIGGER "evidence_record_no_truncate"');
    }
    await seed(db);
    const { PgBossEngine } = await import('@scraper/api/dist/scheduler/pg-boss-engine.js');
    engine = new PgBossEngine(url as string);
    const PgBoss = (await import('pg-boss')).default;
    boss = new PgBoss({ connectionString: url as string });
    await boss.start();
  }, 30_000);

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await (engine as { stop?: () => Promise<void> }).stop?.();
    await db?.$disconnect();
    delete process.env.SCRAPER_DEV_FIXTURES;
  });

  it('a provisional deadline timer fires and the machine reaches the chase step; a stale duplicate no-ops', async () => {
    const { PrismaRequestsRepository } = await import('@scraper/api/repository');
    const { RequestsService } = await import('@scraper/api/dist/requests/requests.service.js');
    const { DEV_IDENTITY, DEV_USER_ID } = await import('@scraper/api/dist/common/dev-fixtures.js');
    const { handleDeadlineExpiry } = await import('../dist/main.js');
    const repo = new PrismaRequestsRepository(db);
    const service = new RequestsService(repo);
    // The handler takes a deps object rather than the repository directly (port wave 5): the two
    // expiry paths live in workflows/deadline.ts and are unit-tested there against fakes, so the
    // durable-timer loop only has to prove that pg-boss delivers into the REAL transition.
    const deadlineDeps = {
      load: (id: string) => repo.load(id),
      applyTransition: (id: string, result: unknown) => repo.applyTransition(id, result),
      now: () => new Date(),
    };

    const created = (await service.create({
      userId: DEV_USER_ID, identity: DEV_IDENTITY, controllerSlug: 'az-direct',
      requestType: 'OBJECTION_ART21', cause: 'USER_INITIATED',
    })) as { id: string };
    await service.simulate(DEV_USER_ID, created.id, { kind: 'dispatch', channel: 'email' });

    // The handler refuses to fire EARLY (port wave 5). pg-boss `startAfter` is a floor, not a
    // guarantee, and a clock-critical transition must never run against a deadline that has not
    // passed — so a near timer on a 30-day clock is a no-op, and the test proves that first.
    expect(await handleDeadlineExpiry(deadlineDeps, { requestId: created.id, kind: 'provisional' })).toMatch(/not yet due/);

    // Back-date the provisional deadline so the timer below has something genuinely due. Only the
    // deadline moves: `request_binding_freeze` (0001) forbids re-pointing who or what the request is.
    await db.rightsRequest.update({
      where: { id: created.id },
      data: { provisionalDeadlineAt: new Date(Date.now() - 1000) },
    });

    // Register the real worker handler on this boss instance, then schedule a NEAR timer via the engine.
    await boss.createQueue('deadline-expiry').catch(() => undefined);
    const fired: string[] = [];
    await boss.work('deadline-expiry', { pollingIntervalSeconds: 1 }, async (jobs) => {
      for (const job of jobs) fired.push(await handleDeadlineExpiry(deadlineDeps, job.data as never));
    });
    await engine.schedule(`deadline:${created.id}:provisional`, new Date(Date.now() + 1000), {
      name: 'deadline-expiry',
      payload: { requestId: created.id, kind: 'provisional' },
    });

    // Wait for the timer to fire and the state to flip.
    const deadline = Date.now() + 20_000;
    let state = '';
    while (Date.now() < deadline) {
      const r = await repo.load(created.id);
      state = r?.state ?? '';
      if (state === 'AWAITING_REGISTERED_RESEND') break;
      await new Promise((res) => setTimeout(res, 500));
    }
    expect(state).toBe('AWAITING_REGISTERED_RESEND');
    expect(fired.some((f) => f.includes('provisional deadline expired'))).toBe(true);

    // A stale duplicate must be a logged no-op, never a second transition.
    const again = await handleDeadlineExpiry(deadlineDeps, { requestId: created.id, kind: 'provisional' });
    expect(again).toMatch(/stale/);
  }, 30_000);

  /**
   * The THIRD timer (audit F3a) — and the one whose expiry must not escalate anything.
   *
   * It is worth an integration test of its own rather than trusting the unit coverage, because the
   * bug it guards against is a wiring bug, not a logic bug: `deadline-expiry` carries the kind in
   * its payload, and before the DUE_FIELD table existed the handler read `deadlineAt` for every kind
   * that was not `provisional`. A proof timer would then have checked the STATUTORY clock, found it
   * null on a request that has none by definition, concluded nothing was pending, and fired
   * unconditionally. That is exactly the class of defect that survives unit tests written against
   * the same wrong assumption.
   */
  it('a proof-retrieval timer fires into NEEDS_HUMAN — a missing receipt never drafts a complaint', async () => {
    const { PrismaRequestsRepository } = await import('@scraper/api/repository');
    const { RequestsService } = await import('@scraper/api/dist/requests/requests.service.js');
    const { DEV_IDENTITY, DEV_USER_ID } = await import('@scraper/api/dist/common/dev-fixtures.js');
    const { handleDeadlineExpiry } = await import('../dist/main.js');
    const repo = new PrismaRequestsRepository(db);
    const service = new RequestsService(repo);
    const deadlineDeps = {
      load: (id: string) => repo.load(id),
      applyTransition: (id: string, result: unknown) => repo.applyTransition(id, result),
      now: () => new Date(),
    };

    // A different (controller, requestType) triple from the test above: one user may hold one
    // non-terminal request per triple (ADR-013), and that guard is not suspended for tests.
    const created = (await service.create({
      userId: DEV_USER_ID, identity: DEV_IDENTITY, controllerSlug: 'schufa',
      requestType: 'ACCESS_ART15', cause: 'USER_INITIATED',
    })) as { id: string };
    await service.simulate(DEV_USER_ID, created.id, { kind: 'dispatch', channel: 'email' });

    // Move it onto the lodged path as a fixture. `provisionalDeadlineAt` MUST be nulled in the same
    // statement — 0015's CHECK refuses a request sitting in AWAITING_DELIVERY_PROOF with any clock
    // set, which is the legal rule ("a lodgement starts nothing") expressed where application code
    // cannot route around it. A fixture that forgot it would be rejected by the database, which is
    // the constraint doing its job.
    await db.rightsRequest.update({
      where: { id: created.id },
      data: {
        state: 'AWAITING_DELIVERY_PROOF',
        provisionalDeadlineAt: null,
        deadlineAt: null,
        proofDueAt: new Date(Date.now() - 1000),
      },
    });

    await boss.createQueue('deadline-expiry').catch(() => undefined);
    const fired: string[] = [];
    await boss.work('deadline-expiry', { pollingIntervalSeconds: 1 }, async (jobs) => {
      for (const job of jobs) fired.push(await handleDeadlineExpiry(deadlineDeps, job.data as never));
    });
    await engine.schedule(`deadline:${created.id}:proof`, new Date(Date.now() + 1000), {
      name: 'deadline-expiry',
      payload: { requestId: created.id, kind: 'proof' },
    });

    const until = Date.now() + 20_000;
    let state = '';
    while (Date.now() < until) {
      const r = await repo.load(created.id);
      state = r?.state ?? '';
      if (state === 'NEEDS_HUMAN') break;
      await new Promise((res) => setTimeout(res, 500));
    }

    // A HUMAN, never an Art. 77 draft. Not knowing whether a letter arrived is the opposite of
    // evidence that it did, and a complaint founded on our own ignorance is worse than none.
    expect(state).toBe('NEEDS_HUMAN');
    expect(state).not.toBe('ESCALATION_DRAFTED');
    // Asserted from the append-only ledger rather than from this test's `fired` array: both tests in
    // this file register a worker on the same `deadline-expiry` queue, so pg-boss may hand the job
    // to either handler and the local array is not a reliable witness. The RequestEvent is — and it
    // is the record that would actually be produced as evidence.
    const event = await db.requestEvent.findFirstOrThrow({
      where: { requestId: created.id, type: 'proofRetrievalFailed' },
    });
    expect(event.toState).toBe('NEEDS_HUMAN');
    expect(event.actor).toBe('SYSTEM');

    // No clock was started on the way out, and the spent hint is cleared.
    const row = await db.rightsRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.deadlineAt).toBeNull();
    expect(row.provableSendConfirmedAt).toBeNull();
    expect(row.proofDueAt).toBeNull();

    // And that human cannot escalate it either — invariant 4b, nothing proves receipt.
    const { OpsService } = await import('@scraper/api/dist/ops/ops.service.js');
    const ops = new OpsService(db, null);
    await expect(ops.resolve(created.id, 'escalate')).rejects.toThrow();
  }, 40_000);
});
