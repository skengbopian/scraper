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

describe.skipIf(!url)('0005 database invariants', () => {
  let db: PrismaClient;
  let controllerId: string;
  let userId: string;
  let identityId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SCRAPER_DEV_FIXTURES = '1';
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$executeRawUnsafe(
      `TRUNCATE TABLE "FileFinding","CreditFileEntry","CreditFileSnapshot","RequestEvent","ControllerResponse","EvidenceRecord","RightsRequest","Playbook","SelfServeRoute","LeverageAction","Session","AuthCredential","Mandate","IdentityAddress","Identity","User","Controller" CASCADE`,
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
});
