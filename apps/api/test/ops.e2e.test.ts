import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';

/**
 * THE OPS SURFACE, over HTTP and against real Postgres (port wave 5, ADR-037).
 *
 * Wave 2c refused to build the /ops screen because these endpoints did not exist and the screen
 * would have mocked a capability the product did not have. This suite is what makes the screen
 * honest, and it is written around the four things that must not break:
 *
 *   the role is a stored fact, not a header  ·  ESCALATED has ONE inbound edge, and it is human  ·
 *   invariant 3b (no complaint without proven receipt)  ·  invariant 1 (a re-send re-runs the guards)
 */
const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)('the ops review queue', () => {
  let app: INestApplication;
  let base: string;
  let db: PrismaClient;

  const OPS_EMAIL = 'wave5-ops@example.com';
  const USER_EMAIL = 'wave5-user@example.com';
  const PASSWORD = 'korrekt-pferd-batterie-heftklammer';

  let opsToken = '';
  let userToken = '';
  let opsUserId = '';
  let subjectUserId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SCRAPER_REPOSITORY = 'prisma';
    process.env.DATABASE_URL = url;
    delete process.env.SCRAPER_DEV_FIXTURES;

    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanUp();

    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('../dist/app.module.js');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');

    opsToken = await signUp(OPS_EMAIL);
    opsUserId = (await db.user.findUniqueOrThrow({ where: { email: OPS_EMAIL } })).id;
    userToken = await signUp(USER_EMAIL);
    subjectUserId = (await db.user.findUniqueOrThrow({ where: { email: USER_EMAIL } })).id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await cleanUp();
    await db?.$disconnect();
    delete process.env.SCRAPER_REPOSITORY;
  });

  /**
   * Remove only THIS suite's rows, in dependency order.
   *
   * Not a TRUNCATE: other DB suites in this package seed their own fixtures, and wiping the shared
   * tables would make whichever suite ran second fail for reasons that have nothing to do with it.
   * The trigger dance is unavoidable and is itself the invariant — `request_event_append_only` and
   * `evidence_record_append_only` (0001) forbid row deletes on the audit trail even in tests, which
   * is exactly what they are for. Disabling them for a scoped cleanup is fixture discipline; the
   * suites that PROVE the triggers reject are in `db-invariants.test.ts`.
   */
  async function cleanUp(): Promise<void> {
    if (!db) return;
    const emails = [OPS_EMAIL, USER_EMAIL];
    const ids = (await db.user.findMany({ where: { email: { in: emails } }, select: { id: true } })).map((u) => u.id);
    if (ids.length > 0) {
      await db.inboundDocument.deleteMany({ where: { assignedRequest: { userId: { in: ids } } } });
      await db.$executeRawUnsafe('ALTER TABLE "RequestEvent" DISABLE TRIGGER "request_event_append_only"');
      await db.$executeRawUnsafe('ALTER TABLE "EvidenceRecord" DISABLE TRIGGER "evidence_record_append_only"');
      try {
        await db.rightsRequest.deleteMany({ where: { userId: { in: ids } } });
      } finally {
        await db.$executeRawUnsafe('ALTER TABLE "RequestEvent" ENABLE TRIGGER "request_event_append_only"');
        await db.$executeRawUnsafe('ALTER TABLE "EvidenceRecord" ENABLE TRIGGER "evidence_record_append_only"');
      }
    }
    await db.inboundDocument.deleteMany({ where: { senderRef: { contains: 'az-direct.example' } } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
  }

  const req = (method: string) => (path: string, body?: unknown, token?: string) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const post = req('POST');
  const get = (path: string, token?: string) =>
    fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;

  /**
   * Register, sign in, and clear the second factor. Sign-in is two steps (ADR-035): `/auth/login`
   * issues a token that carries the password factor only, and `/auth/totp` upgrades that same token
   * to an MFA-verified session — which is the only kind SessionMiddleware attaches anything for.
   */
  async function signUp(email: string): Promise<string> {
    const { totp } = await import('@scraper/core');
    const registered = await json(await post('/auth/register', { email, password: PASSWORD }));
    const secret = String(registered.totpSecret);
    const { token } = (await json(await post('/auth/login', { email, password: PASSWORD }))) as { token: string };
    const upgraded = await post('/auth/totp', { code: totp(secret, Date.now()) }, token);
    if (upgraded.status !== 201) throw new Error(`TOTP step failed for ${email}: ${upgraded.status} ${await upgraded.text()}`);
    return token;
  }

  /**
   * Put a request into a given state directly. The transitions themselves are tested elsewhere;
   * what this suite tests is what OPS may do with one, so the fixture is set up, not walked.
   *
   * Each call takes a FRESH (controller, requestType) triple. That is not fixture convenience — it
   * is `one_open_request_per_triple` (ADR-013) refusing to let one user hold two non-terminal
   * requests against the same controller for the same right, which is the invariant working.
   */
  const TYPES = ['OBJECTION_ART21', 'ACCESS_ART15', 'ACCESS_ART15_SOURCE', 'ERASURE_ART17'] as const;
  let seedCounter = 0;

  async function seedRequest(state: string, over: Record<string, unknown> = {}): Promise<string> {
    const controllers = await db.controller.findMany({ orderBy: { slug: 'asc' }, select: { id: true, slug: true } });
    const n = seedCounter++;
    const requestType = TYPES[n % TYPES.length]!;
    const controller = controllers[Math.floor(n / TYPES.length) % controllers.length]!;

    let playbook = await db.playbook.findFirst({ where: { controllerId: controller.id, requestType } });
    playbook ??= await db.playbook.create({
      data: {
        controllerId: controller.id, slug: `ops-test.${controller.slug}.${requestType.toLowerCase()}`, requestType,
        // Inactive: a DEMO row would collide with `playbook_one_active`, and nothing in this suite
        // dispatches — every request here is seeded past the point where activation matters.
        version: 1, active: false, document: { demo: true, validation: { humanReviewIfConfidenceBelow: 0.75 } },
      },
    });
    const created = await db.rightsRequest.create({
      data: {
        userId: subjectUserId, controllerId: controller.id, playbookId: playbook.id,
        requestType, state: state as never, channel: 'email',
        cycleOrdinal: 1, idempotencyKey: `ops-test-${Math.random().toString(36).slice(2)}`,
        ...over,
      },
      select: { id: true },
    });
    return created.id;
  }

  // ----------------------------------------------------------------------------------------------

  describe('the gate', () => {
    it('an ordinary signed-in user is refused — the role is not something a caller can assert', async () => {
      const r = await get('/ops/queue', userToken);
      expect(r.status).toBe(403);
      expect((await json(r)).error).toBe('OPS_ROLE_REQUIRED');
    });

    it('a header cannot grant it (the pre-audit line\'s failure mode)', async () => {
      const r = await fetch(`${base}/ops/queue`, {
        headers: { authorization: `Bearer ${userToken}`, 'x-ops-role': 'true' },
      });
      expect(r.status).toBe(403);
    });

    it('no session at all is refused, not defaulted', async () => {
      expect((await get('/ops/queue')).status).toBe(403);
    });

    it('the role stored on the User row grants it', async () => {
      await db.user.update({ where: { id: opsUserId }, data: { role: 'HUMAN_OPS' } });
      const r = await get('/ops/queue', opsToken);
      expect(r.status).toBe(200);
      expect(Array.isArray(await r.json())).toBe(true);
    });
  });

  describe('the queue', () => {
    it('lists what is waiting on a person, WITHOUT the subject\'s identifiers', async () => {
      const id = await seedRequest('NEEDS_HUMAN');
      const rows = (await (await get('/ops/queue', opsToken)).json()) as Record<string, unknown>[];
      const item = rows.find((r) => r.id === id);
      expect(item).toBeDefined();
      // The controller is named — an ops reviewer needs to know WHO the counterparty is.
      expect(typeof item!.controllerSlug).toBe('string');
      expect(String(item!.controllerSlug).length).toBeGreaterThan(0);
      expect(item!.state).toBe('NEEDS_HUMAN');

      // A cross-user ledger keyed to real identities is the artefact CLAUDE.md's one rule describes.
      // The opaque user id is enough to correlate and not enough to locate anyone.
      const serialised = JSON.stringify(item);
      for (const field of ['legalName', 'dateOfBirth', 'street', 'postalCode']) {
        expect(serialised).not.toContain(field);
      }
    });
  });

  describe('invariant 3b: a complaint needs proven receipt', () => {
    it('refuses to draft one for a send that failed, where nothing proves the controller ever received it', async () => {
      const id = await seedRequest('NEEDS_HUMAN'); // no provable send, no response
      const r = await post(`/ops/requests/${id}/resolve`, { resolution: 'escalate' }, opsToken);
      expect(r.status).toBe(409);
      expect(String((await json(r)).message)).toMatch(/neither a provable send nor a controller response/);
    });

    it('allows it once a provable send is on the record', async () => {
      const id = await seedRequest('NEEDS_HUMAN', { provableSendConfirmedAt: new Date(), deadlineAt: new Date() });
      const r = await post(`/ops/requests/${id}/resolve`, { resolution: 'escalate' }, opsToken);
      expect(r.status).toBe(201);
      expect((await json(r)).state).toBe('ESCALATION_DRAFTED');
    });
  });

  describe('ADR-008: ESCALATED has one inbound edge, and it is human', () => {
    it('a HUMAN_OPS send moves the drafted complaint, and writes chained evidence for it', async () => {
      const id = await seedRequest('ESCALATION_DRAFTED', { provableSendConfirmedAt: new Date() });
      const r = await post(`/ops/requests/${id}/escalation/send`, undefined, opsToken);
      expect(r.status).toBe(201);
      expect((await json(r)).state).toBe('ESCALATED');

      const event = await db.requestEvent.findFirstOrThrow({ where: { requestId: id, type: 'humanSend' } });
      expect(event.actor).toBe('HUMAN_OPS');
      // Evidence is written BEFORE the transition, so an ESCALATED row cannot exist without it.
      expect(await db.evidenceRecord.count({ where: { requestId: id } })).toBeGreaterThan(0);
    });

    it('the user-facing API has no route that sends one', async () => {
      const id = await seedRequest('ESCALATION_DRAFTED', { provableSendConfirmedAt: new Date() });
      for (const path of [`/requests/${id}/escalation/send`, `/requests/${id}/escalate`, `/requests/${id}/send-complaint`]) {
        expect((await post(path, undefined, userToken)).status).toBe(404);
      }
    });

    it('the ops send route is still closed to a non-ops caller', async () => {
      const id = await seedRequest('ESCALATION_DRAFTED', { provableSendConfirmedAt: new Date() });
      expect((await post(`/ops/requests/${id}/escalation/send`, undefined, userToken)).status).toBe(403);
    });

    it('there is nothing to send when nothing was drafted', async () => {
      const id = await seedRequest('NEEDS_HUMAN');
      const r = await post(`/ops/requests/${id}/escalation/send`, undefined, opsToken);
      expect(r.status).toBe(409);
      expect((await json(r)).error).toBe('NO_DRAFT_TO_SEND');
    });
  });

  describe('invariant 1: a re-send re-runs the full guard set', () => {
    it('an ops re-send is blocked when the mandate was revoked mid-flight — ops is privileged, not exempt', async () => {
      const id = await seedRequest('NEEDS_HUMAN');
      // The subject has no live mandate at all, which is the strongest form of the same failure.
      const r = await post(`/ops/requests/${id}/resolve`, { resolution: 'resend' }, opsToken);
      expect(r.status).toBe(409);
      expect(String((await json(r)).error)).toMatch(/^GUARD_/);
    });
  });

  describe('inbound documents', () => {
    it('correlation is a human act, attributed — and cannot be re-pointed afterwards', async () => {
      const requestId = await seedRequest('AWAITING_RESPONSE_PROVISIONAL', { provisionalDeadlineAt: new Date() });
      const other = await seedRequest('AWAITING_RESPONSE_PROVISIONAL', { provisionalDeadlineAt: new Date() });

      const doc = await json(
        await post(
          '/ops/inbound-documents',
          { channel: 'email', senderRef: 'datenschutz@az-direct.example', subjectLine: 'Re: Datenschutzanfrage', storageRef: 's3://inbox/1.eml', sha256: 'a'.repeat(64) },
          opsToken,
        ),
      );
      const docId = String(doc.id);

      // Unassigned on arrival: nothing in the document decides which request it answers.
      const queue = (await (await get('/ops/inbound-documents', opsToken)).json()) as Record<string, unknown>[];
      expect(queue.find((d) => d.id === docId)?.assignedRequestId).toBeNull();

      expect((await post(`/ops/inbound-documents/${docId}/assign`, { requestId }, opsToken)).status).toBe(201);
      const stored = await db.inboundDocument.findUniqueOrThrow({ where: { id: docId } });
      expect(stored.assignedRequestId).toBe(requestId);
      expect(stored.assignedByUserId).toBe(opsUserId);
      expect(stored.assignedAt).not.toBeNull();
      // CLAUDE.md §4: a raw reference always carries the date it stops being stored.
      expect(stored.purgeRawAt.getTime()).toBeGreaterThan(stored.receivedAt.getTime());

      // Re-pointing would rewrite whose evidence this is. Refused at the API and at the database.
      const repoint = await post(`/ops/inbound-documents/${docId}/assign`, { requestId: other }, opsToken);
      expect(repoint.status).toBe(409);
      await expect(
        db.inboundDocument.update({ where: { id: docId }, data: { assignedRequestId: other } }),
      ).rejects.toThrow(/inbound_assignment_freeze/);
    });

    it('an assignment with no human attached is refused by the database', async () => {
      const requestId = await seedRequest('AWAITING_RESPONSE_PROVISIONAL', { provisionalDeadlineAt: new Date() });
      await expect(
        db.inboundDocument.create({
          data: {
            receivedAt: new Date(), channel: 'email', senderRef: 'x', storageRef: 's3://x', sha256: 'b'.repeat(64),
            purgeRawAt: new Date(Date.now() + 86_400_000),
            // Automatic correlation: a request named, but nobody who named it.
            assignedRequestId: requestId,
          },
        }),
      ).rejects.toThrow(/inbound_assignment_is_attributed/);
    });

    it('the ops inbox is closed to ordinary users', async () => {
      expect((await get('/ops/inbound-documents', userToken)).status).toBe(403);
    });

    it('(0012) a correlated document blocks the delete until the document itself is purged', async () => {
      // 0011 created this FK with no ON DELETE clause (Postgres default NO ACTION) while
      // schema.prisma read as SetNull — 0012 settles it as NO ACTION, because SetNull is not
      // merely undesirable here but impossible: it nulls `assignedRequestId` alone, and
      // `inbound_assignment_is_attributed` forbids that half-state.
      const requestId = await seedRequest('RESPONSE_RECEIVED');
      const doc = await db.inboundDocument.create({
        data: {
          receivedAt: new Date(), channel: 'email', senderRef: 'fk@example.test',
          storageRef: 's3://fk', sha256: 'c'.repeat(64),
          purgeRawAt: new Date(Date.now() + 86_400_000),
          assignedRequestId: requestId, assignedAt: new Date(), assignedByUserId: opsUserId,
        },
      });

      // Loud, not silent. An erasure that would have orphaned a stored raw document — storageRef,
      // sha256, senderRef — fails here instead of leaving one behind (CLAUDE.md §4).
      await expect(db.rightsRequest.delete({ where: { id: requestId } })).rejects.toThrow();

      // And the half-state the FK would have produced is refused on its own terms, which is why
      // SetNull could never have been the answer.
      await expect(
        db.inboundDocument.update({ where: { id: doc.id }, data: { assignedRequestId: null } }),
      ).rejects.toThrow();

      // Purge the document, and the erasure proceeds. This ordering is the contract.
      await db.inboundDocument.delete({ where: { id: doc.id } });
      await expect(db.rightsRequest.delete({ where: { id: requestId } })).resolves.toBeTruthy();
    });
  });

  describe('resolving a ticket', () => {
    it('a human outcome stands where the parser\'s could not (invariant 5)', async () => {
      const id = await seedRequest('NEEDS_HUMAN');
      const r = await post(`/ops/requests/${id}/resolve`, { resolution: 'complied' }, opsToken);
      expect(r.status).toBe(201);
      const body = await json(r);
      expect(body.state).toBe('COMPLIED');
      expect(body.outcome).toBe('COMPLIED');
      const event = await db.requestEvent.findFirstOrThrow({ where: { requestId: id, type: 'humanResolve:complied' } });
      expect(event.actor).toBe('HUMAN_OPS');
    });

    it('an unknown resolution is rejected rather than guessed at', async () => {
      const id = await seedRequest('NEEDS_HUMAN');
      const r = await post(`/ops/requests/${id}/resolve`, { resolution: 'close_it_somehow' }, opsToken);
      expect(r.status).toBe(400);
      expect((await json(r)).error).toBe('INVALID_RESOLUTION');
    });

    it('an illegal transition is refused by the machine, not absorbed by the ops layer', async () => {
      const id = await seedRequest('READY');
      const r = await post(`/ops/requests/${id}/resolve`, { resolution: 'complied' }, opsToken);
      expect(r.status).toBe(409);
      expect((await json(r)).error).toBe('ILLEGAL_TRANSITION');
    });
  });
});
