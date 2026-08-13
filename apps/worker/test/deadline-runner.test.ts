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
    // forbidden even in tests, which is exactly the point of the trigger.
    await db.$executeRawUnsafe('TRUNCATE TABLE "RequestEvent","ControllerResponse","EvidenceRecord","RightsRequest" CASCADE');
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
});
