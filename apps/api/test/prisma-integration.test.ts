import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * DB-layer integration tests against a REAL Postgres (packages/db migrations deployed).
 * Runs only when DATABASE_URL_TEST is set (CI/dev with the scraper3_test database); skipped
 * otherwise so the suite stays runnable without infrastructure.
 *
 * What must hold here and nowhere else:
 *  - the 0003 trigger makes a third-party credit-file snapshot UNREPRESENTABLE (the one rule),
 *  - the UNIQUE idempotencyKey closes the concurrent double-insert race,
 *  - the Prisma adapter honours the port contract the in-memory adapter defines.
 */
const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)('prisma adapter + safety triggers (integration)', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    process.env.SCRAPER_DEV_FIXTURES = '1';
    db = new PrismaClient({ datasources: { db: { url } } });
    // 0013 blocks TRUNCATE on the ledgers; the throwaway test DB disables the guard explicitly.
    await db.$executeRawUnsafe('ALTER TABLE "RequestEvent" DISABLE TRIGGER "request_event_no_truncate"');
    await db.$executeRawUnsafe('ALTER TABLE "EvidenceRecord" DISABLE TRIGGER "evidence_record_no_truncate"');
    try {
      await db.$executeRawUnsafe(`TRUNCATE TABLE "FileFinding","CreditFileEntry","CreditFileSnapshot","RequestEvent","ControllerResponse","EvidenceRecord","ProvenanceEntry","ProvenanceLedger","RightsRequest","Playbook","SelfServeRoute","LeverageAction","Session","AuthCredential","Mandate","IdentityAddress","IdentityPacket","Identity","SuppressionEnrolment","FraudMarkerFiling","User","Controller" CASCADE`);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "RequestEvent" ENABLE TRIGGER "request_event_no_truncate"');
      await db.$executeRawUnsafe('ALTER TABLE "EvidenceRecord" ENABLE TRIGGER "evidence_record_no_truncate"');
    }
    const { seed } = await import('../dist/db/seed.js');
    await seed(db);
  });

  afterAll(async () => {
    await db?.$disconnect();
    delete process.env.SCRAPER_DEV_FIXTURES;
  });

  it('seed is idempotent', async () => {
    const { seed } = await import('../dist/db/seed.js');
    await seed(db); // second run must not throw or duplicate
    expect(await db.controller.count()).toBe(15);
    // The demo pairs: the ERASURE_ART17 chain link (wave 4) and the az-direct Datenkopie (wave 5).
    // ACTIVE, not total: `playbook_freeze` forbids rewriting a shipped document, so a fixture change
    // ships as a new version and stands its predecessor down (seed.ts DEMO_PLAYBOOK_VERSION). The
    // superseded rows are meant to still be there — one active per pair is the invariant.
    expect(await db.playbook.count({ where: { active: true } })).toBe(6);
  });

  it('the adapter routes all three outcomes and persists CREATED with its audit event', async () => {
    const { PrismaRequestsRepository } = await import('../dist/requests/prisma-requests.repository.js');
    const { RequestsService } = await import('../dist/requests/requests.service.js');
    const { DEV_IDENTITY, DEV_USER_ID } = await import('../dist/common/dev-fixtures.js');
    const service = new RequestsService(new PrismaRequestsRepository(db));

    const selfServe = await service.create({ userId: DEV_USER_ID, identity: DEV_IDENTITY, controllerSlug: 'zoominfo', requestType: 'ERASURE_ART17', cause: 'USER_INITIATED' });
    expect(selfServe.routed).toBe('SELF_SERVE');

    const none = await service.create({ userId: DEV_USER_ID, identity: DEV_IDENTITY, controllerSlug: 'crif', requestType: 'ACCESS_ART15', cause: 'USER_INITIATED' });
    expect(none.routed).toBe('NONE');

    const created = await service.create({ userId: DEV_USER_ID, identity: DEV_IDENTITY, controllerSlug: 'infoscore', requestType: 'ACCESS_ART15_SOURCE', cause: 'USER_INITIATED' });
    expect(created.routed).toBe('LEGAL');
    const id = (created as { id: string }).id;

    // The audit event exists, carries the DERIVED subject snapshot, and the row is READY.
    const events = await db.requestEvent.findMany({ where: { requestId: id } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('guardsPass');
    // The subject snapshot is SEALED under the EVIDENCE key (audit W14): `RequestEvent` is
    // append-only by trigger, so a plaintext name here would outlive an Art. 17 erasure forever.
    // What the test asserts is therefore that the snapshot is present, opaque, and OPENS to the
    // right name — proving both halves, which a plaintext assertion could only ever prove one of.
    const payload = events[0]?.payload as { subjectSnapshotEnc: string; subjectIdentityId: string };
    expect(payload.subjectSnapshotEnc).toBeTypeOf('string');
    expect(payload.subjectSnapshotEnc).not.toContain('Erika');
    const { AesGcmEnvelopeCrypto, DevKekResolver } = await import('@scraper/core');
    const { createPurposeCipher } = await import('../dist/identity/user-key.store.js');
    const cipher = createPurposeCipher(db, new AesGcmEnvelopeCrypto(new DevKekResolver()));
    const opened = JSON.parse(
      await cipher.openText(DEV_USER_ID, 'EVIDENCE', Buffer.from(payload.subjectSnapshotEnc, 'base64')),
    ) as { legalName: string };
    expect(opened.legalName).toBe('Erika Mustermann');
    // The identity id stays in the clear: it names a ROW, not a person.
    expect(payload.subjectIdentityId).not.toBe('');

    // Idempotency: the duplicate is a guard failure, not a second row.
    await expect(
      service.create({ userId: DEV_USER_ID, identity: DEV_IDENTITY, controllerSlug: 'infoscore', requestType: 'ACCESS_ART15_SOURCE', cause: 'USER_INITIATED' }),
    ).rejects.toMatchObject({ response: { error: 'GUARD_IDEMPOTENCY' } });

    // Lifecycle: dispatch(email) → provisional clock persisted, statutory stays null.
    const after = await service.simulate(DEV_USER_ID, id, { kind: 'dispatch', channel: 'email' });
    expect(after.state).toBe('AWAITING_RESPONSE_PROVISIONAL');
    const row = await db.rightsRequest.findUnique({ where: { id } });
    expect(row?.provisionalDeadlineAt).not.toBeNull();
    expect(row?.deadlineAt).toBeNull();

    const list = await service.listForUser(DEV_USER_ID);
    expect(list.some((r) => r.id === id)).toBe(true);
  });

  it('trigger: a credit-file snapshot for someone else’s identity is unrepresentable', async () => {
    const { DEV_USER_ID } = await import('../dist/common/dev-fixtures.js');
    const other = await db.user.create({ data: { email: 'other@example.com' } });
    // A distinct, recognisable ciphertext rather than a sealed name: this fixture exists to be the
    // WRONG identity for a credit-file snapshot, and nothing decrypts it — the trigger under test
    // compares ids, not names.
    const otherIdentity = await db.identity.create({
      data: { userId: other.id, status: 'VERIFIED', legalNameEnc: Buffer.from('other-person-fixture'), verifiedAt: new Date() },
    });
    const controller = await db.controller.findUniqueOrThrow({ where: { slug: 'schufa' } });

    await expect(
      db.creditFileSnapshot.create({
        data: {
          userId: DEV_USER_ID, identityId: otherIdentity.id, controllerId: controller.id,
          sourceKind: 'UPLOAD', matchAssertedAt: new Date(), parseConfidence: 0.9, rawDocumentHash: 'x'.repeat(64),
        },
      }),
    ).rejects.toThrow(/belongs to another user/);
  });

  it('trigger: an UNVERIFIED identity cannot receive a snapshot', async () => {
    const u = await db.user.create({ data: { email: 'unverified@example.com' } });
    const ident = await db.identity.create({ data: { userId: u.id, status: 'UNVERIFIED' } });
    const controller = await db.controller.findUniqueOrThrow({ where: { slug: 'schufa' } });
    await expect(
      db.creditFileSnapshot.create({
        data: {
          userId: u.id, identityId: ident.id, controllerId: controller.id,
          sourceKind: 'UPLOAD', matchAssertedAt: new Date(), parseConfidence: 0.9, rawDocumentHash: 'y'.repeat(64),
        },
      }),
    ).rejects.toThrow(/not VERIFIED/);
  });

  it('trigger: rebinding an existing snapshot is forbidden', async () => {
    const { DEV_USER_ID, DEV_IDENTITY } = await import('../dist/common/dev-fixtures.js');
    const controller = await db.controller.findUniqueOrThrow({ where: { slug: 'schufa' } });
    const snap = await db.creditFileSnapshot.create({
      data: {
        userId: DEV_USER_ID, identityId: DEV_IDENTITY.id, controllerId: controller.id,
        sourceKind: 'UPLOAD', matchAssertedAt: new Date(), parseConfidence: 0.9, rawDocumentHash: 'z'.repeat(64),
      },
    });
    const other = await db.identity.findFirstOrThrow({ where: { legalNameEnc: Buffer.from('other-person-fixture') } });
    await expect(
      db.creditFileSnapshot.update({ where: { id: snap.id }, data: { identityId: other.id } }),
    ).rejects.toThrow(/rebinding|belongs to another user/);
  });
});
