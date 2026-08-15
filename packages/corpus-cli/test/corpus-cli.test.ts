import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * The corpus CLI against real Postgres (skipped without DATABASE_URL_TEST, like the other DB suites).
 *
 * These tests are written around REFUSALS. `corpus:activate` is the act that authorises this product
 * to send a legal letter in a person's name; the happy path is one boolean flip, and everything
 * expensive lives in what the command declines to do. Two of them are enforced by the database rather
 * than by this code (`playbook_freeze`, `playbook_one_active`), and both are exercised here against
 * the real triggers rather than trusted.
 */
const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)('corpus CLI', () => {
  let db: PrismaClient;
  const AZ = 'werbewiderspruch.az-direct';

  const load = () => Promise.all([import('../dist/import.js'), import('../dist/activate.js'), import('../dist/repo.js')]);

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url } } });
  }, 30_000);

  afterAll(async () => {
    await reset();
    await db?.$disconnect();
  });

  /**
   * Put this shared database into the state a FRESH NODE is in: an imported corpus is possible and
   * nothing is active.
   *
   * The demo playbooks are stood down rather than deleted. `apps/api`'s seed ships them
   * `active: true`, including `az-direct / OBJECTION_ART21` — the exact pair this suite activates —
   * and `playbook_one_active` (0005) permits one active row per (controller, requestType), so the CLI
   * correctly refused every activation here when the suite ran after `apps/api`'s. That is the
   * invariant working, and the fix belongs in the fixture: this suite's precondition is "nothing is
   * active", which is what `corpus:import` produces and what the refusal it tests is defined against.
   *
   * Standing them down does not break `apps/api` — every suite there re-seeds in its own `beforeAll`
   * (the dependency runs that way round on purpose, after `ops.e2e` was found borrowing another
   * suite's seed). `active` is also the one column `playbook_freeze` permits an UPDATE to touch.
   *
   * `CorpusActivation` is append-only AND truncate-guarded (0019) like the evidence ledgers, so a
   * throwaway test database disables the guard explicitly around the cleanup — the visible act those
   * triggers exist to force.
   */
  async function reset(): Promise<void> {
    if (!db) return;
    await db.$executeRawUnsafe('ALTER TABLE "CorpusActivation" DISABLE TRIGGER "corpus_activation_append_only"');
    try {
      await db.corpusActivation.deleteMany({});
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "CorpusActivation" ENABLE TRIGGER "corpus_activation_append_only"');
    }
    await db.playbook.deleteMany({ where: { slug: { not: { startsWith: 'demo.' } } } });
    await db.playbook.updateMany({ where: { active: true }, data: { active: false } });
  }

  beforeEach(reset);

  const confirmWith = (answer: string) => async () => answer;
  const silent = () => {};

  describe('import', () => {
    it('imports the corpus and everything arrives INACTIVE', async () => {
      const [{ importCorpus }] = await load();
      const r = await importCorpus(db);
      expect(r.written).toBe(true);
      expect(r.playbooksToCreate.length).toBeGreaterThan(10);
      expect(r.activeAfter).toBe(0);
      const rows = await db.playbook.findMany({ where: { slug: { not: { startsWith: 'demo.' } } }, select: { active: true } });
      expect(rows.every((p) => !p.active)).toBe(true);
    });

    it('writes active:false even though a YAML could say otherwise — import is not activation', async () => {
      const [{ importCorpus }, , { loadPlaybooks }] = await load();
      await importCorpus(db);
      // Nothing in the shipped corpus is active:true (readiness gates that), so the guarantee is
      // asserted where it is implemented: the create path never reads `document.active`.
      const yaml = loadPlaybooks();
      const az = yaml.find((p) => p.slug === AZ)!;
      expect((az.document as { active?: boolean }).active).toBe(false);
      const row = await db.playbook.findFirstOrThrow({ where: { slug: AZ }, select: { active: true, document: true } });
      expect(row.active).toBe(false);
      expect((row.document as { active?: boolean }).active).toBe(false);
    });

    it('is idempotent — a second run creates nothing and reports the rows as unchanged', async () => {
      const [{ importCorpus }] = await load();
      const first = await importCorpus(db);
      const second = await importCorpus(db);
      expect(second.playbooksToCreate).toEqual([]);
      expect(second.playbooksUnchanged.length).toBe(first.playbooksToCreate.length);
    });

    it('a re-import does NOT deactivate what an operator deliberately activated', async () => {
      const [{ importCorpus }] = await load();
      await importCorpus(db);
      await db.playbook.updateMany({ where: { slug: AZ }, data: { active: true } });
      await importCorpus(db);
      const row = await db.playbook.findFirstOrThrow({ where: { slug: AZ }, select: { active: true } });
      expect(row.active).toBe(true);
    });

    it('REFUSES a changed document at an existing version, and writes nothing at all', async () => {
      const [{ importCorpus, planImport }] = await load();
      await importCorpus(db);
      // Simulate the corpus having been edited without a version bump. The stored row is REPLACED
      // rather than updated: `playbook_freeze` (0005) rejects an UPDATE that touches anything but
      // `active`, so a fixture that mutated the document in place would be blocked by the very
      // trigger this test is about — the database refusing first, before the importer got a word in.
      const row = await db.playbook.findFirstOrThrow({ where: { slug: AZ } });
      await db.playbook.delete({ where: { id: row.id } });
      await db.playbook.create({
        data: {
          controllerId: row.controllerId, slug: row.slug, requestType: row.requestType,
          version: row.version, active: false, document: { ...(row.document as object), tampered: true } as never,
        },
      });
      await expect(planImport(db)).rejects.toThrow(/already exist at the same version with a DIFFERENT/);

      // …and because the refusal happens in the READ-ONLY pass, a playbook that would otherwise have
      // been created alongside it is not created either. That is what "atomic" has to mean here.
      await db.playbook.deleteMany({ where: { slug: 'provenance.schufa' } });
      await expect(importCorpus(db)).rejects.toThrow(/NOTHING was written/);
      expect(await db.playbook.count({ where: { slug: 'provenance.schufa' } })).toBe(0);
    });

    it('skips the stencils, and says why — a stencil can never be activated (ADR-018)', async () => {
      const [{ importCorpus }] = await load();
      const r = await importCorpus(db);
      const stencils = r.skipped.filter((s) => /stencil/.test(s.reason)).map((s) => s.slug);
      expect(stencils).toContain('loeschung.generic-adresshaendler');
      expect(stencils).toContain('loeschung.generic-datenhaendler');
      expect(await db.playbook.count({ where: { slug: { in: stencils } } })).toBe(0);
    });

    it('skips a playbook whose controller the census cannot resolve, rather than inventing an addressee', async () => {
      const [{ importCorpus }] = await load();
      const r = await importCorpus(db);
      const unresolved = r.skipped.filter((s) => /not in the census/.test(s.reason)).map((s) => s.slug);
      // Today: loeschung.hireright and explanation.retorio — both in docs/07, neither in the code
      // census. If this ever empties, the gap was closed and the assertion should become `toEqual([])`.
      expect(unresolved.length).toBeGreaterThan(0);
      for (const slug of unresolved) expect(await db.playbook.count({ where: { slug } })).toBe(0);
    });

    it('touches only the controllers the corpus references, not the whole census', async () => {
      const [{ importCorpus }] = await load();
      const { CENSUS } = await import('@scraper/api/dist/census/census.js');
      const r = await importCorpus(db);
      // Asserted on the import's own plan, not on `controller.count()`: this database is shared with
      // the apps/api suites, which seed the FULL census, so a row count would measure their fixtures
      // rather than this importer's restraint.
      const touched = [...r.controllersToCreate, ...r.controllersExisting];
      expect(touched.length).toBeGreaterThan(0);
      expect(touched.length).toBeLessThan(CENSUS.length);
      const referenced = new Set(touched);
      expect([...referenced].every((s) => CENSUS.some((c) => c.slug === s))).toBe(true);
      // A census controller with no playbook must not gain a row on a node that cannot act on it.
      expect(referenced.has('capaneo')).toBe(false);
    });

    it('--dry-run writes nothing', async () => {
      const [{ importCorpus }] = await load();
      const r = await importCorpus(db, { dryRun: true });
      expect(r.written).toBe(false);
      expect(r.playbooksToCreate.length).toBeGreaterThan(0);
      expect(await db.playbook.count({ where: { slug: { not: { startsWith: 'demo.' } } } })).toBe(0);
    });
  });

  describe('activate', () => {
    const DEV = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;
    const DEPLOY = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;

    beforeEach(async () => {
      const [{ importCorpus }] = await load();
      await importCorpus(db);
    });

    it('REFUSES a DRAFT template outside dev, and --allow-draft does not help', async () => {
      const [, { activate }] = await load();
      const opts = { actor: 'test', env: DEPLOY, confirm: confirmWith(AZ), write: silent };
      await expect(activate(db, AZ, opts)).rejects.toThrow(/not SIGNED/);
      await expect(activate(db, AZ, { ...opts, allowDraft: true })).rejects.toThrow(/refused here/);
      expect((await db.playbook.findFirstOrThrow({ where: { slug: AZ } })).active).toBe(false);
    });

    it('in dev, a DRAFT still needs --allow-draft said out loud', async () => {
      const [, { activate }] = await load();
      await expect(
        activate(db, AZ, { actor: 'test', env: DEV, confirm: confirmWith(AZ), write: silent }),
      ).rejects.toThrow(/--allow-draft/);
    });

    it('REFUSES when the slug is not retyped exactly, and changes nothing', async () => {
      const [, { activate }] = await load();
      await expect(
        activate(db, AZ, { actor: 'test', env: DEV, allowDraft: true, confirm: confirmWith('yes'), write: silent }),
      ).rejects.toThrow(/aborted/);
      expect((await db.playbook.findFirstOrThrow({ where: { slug: AZ } })).active).toBe(false);
      expect(await db.corpusActivation.count()).toBe(0);
    });

    it('activates exactly one row and records the act', async () => {
      const [, { activate }] = await load();
      const out = await activate(db, AZ, {
        actor: 'Erika Musterfrau', env: DEV, allowDraft: true, confirm: confirmWith(AZ), write: silent,
      });
      expect(out.action).toBe('ACTIVATED');
      expect(await db.playbook.count({ where: { active: true, slug: { not: { startsWith: 'demo.' } } } })).toBe(1);

      const rec = await db.corpusActivation.findUniqueOrThrow({ where: { id: out.activationId } });
      expect(rec.playbookSlug).toBe(AZ);
      expect(rec.action).toBe('ACTIVATED');
      expect(rec.actor).toBe('Erika Musterfrau');
      expect(rec.templateName).toBe('art21-werbewiderspruch.de.md');
      expect(rec.templateStatus).toBe('DRAFT');
      // The hash of the letter the operator was actually shown — what makes "the letter was edited
      // after this activation" a detectable fact rather than an assertion.
      expect(rec.letterSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(rec.posture).toMatch(/^dev/);
      expect(rec.attestation).toContain('Ich bin für diesen Versand verantwortlich');
    });

    it('shows the operator the real letter before asking — not a summary of it', async () => {
      const [, { activate }] = await load();
      const shown: string[] = [];
      await activate(db, AZ, {
        actor: 'test', env: DEV, allowDraft: true, confirm: confirmWith(AZ), write: (l) => shown.push(l),
      });
      const out = shown.join('\n');
      expect(out).toContain('Widerspruch gegen die Verarbeitung');   // the letter's own subject line
      expect(out).toContain('AZ Direct');                             // who it goes to
      expect(out).toContain('seatDpa: LDI_NRW');                      // where a complaint would be filed
      expect(out).toContain('DRAFT');                                 // that no lawyer has approved it
      expect(out).toContain('VORSCHAU');                              // rendered against a dummy subject
    });

    it('REFUSES a second playbook for the same (controller, requestType) — a swap is two decisions', async () => {
      const [, { activate }] = await load();
      await activate(db, AZ, { actor: 'test', env: DEV, allowDraft: true, confirm: confirmWith(AZ), write: silent });
      // A second version of the same slug, imported the way a corpus bump would arrive.
      const existing = await db.playbook.findFirstOrThrow({ where: { slug: AZ } });
      await db.playbook.create({
        data: {
          controllerId: existing.controllerId, slug: AZ, requestType: existing.requestType,
          version: existing.version + 1, active: false, document: existing.document as never,
        },
      });
      await expect(
        activate(db, AZ, { actor: 'test', env: DEV, allowDraft: true, confirm: confirmWith(AZ), write: silent }),
      ).rejects.toThrow(/Deactivate it first/);
    });

    it('REFUSES a slug this node has never imported', async () => {
      const [, { activate }] = await load();
      await expect(
        activate(db, 'nope.nothing', { actor: 'test', env: DEV, confirm: confirmWith('nope.nothing'), write: silent }),
      ).rejects.toThrow(/Run `corpus:import` first/);
    });
  });

  describe('deactivate — the kill switch', () => {
    const DEV = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;

    beforeEach(async () => {
      const [{ importCorpus }, { activate }] = await load();
      await importCorpus(db);
      await activate(db, AZ, { actor: 'test', env: DEV, allowDraft: true, confirm: confirmWith(AZ), write: silent });
    });

    it('turns it off and records the act', async () => {
      const [, { deactivate }] = await load();
      const out = await deactivate(db, AZ, { actor: 'test', env: DEV, reason: 'wrong venue', write: silent });
      expect((await db.playbook.findFirstOrThrow({ where: { slug: AZ } })).active).toBe(false);
      const rec = await db.corpusActivation.findUniqueOrThrow({ where: { id: out.activationId } });
      expect(rec.action).toBe('DEACTIVATED');
      expect(rec.attestation).toContain('wrong venue');
    });

    it('needs no confirmation, no seal and no preview — it must work when everything else is broken', async () => {
      const [, { deactivate }] = await load();
      // A row whose document cannot render at all: the letter preview will throw, and the kill
      // switch must not care. Turning something OFF has to succeed in exactly the circumstances
      // where turning it on would rightly fail — a missing template, a broken seal, a document that
      // stopped parsing. Replaced rather than updated, because `playbook_freeze` allows an UPDATE to
      // touch `active` and nothing else.
      const row = await db.playbook.findFirstOrThrow({ where: { slug: AZ } });
      await db.playbook.delete({ where: { id: row.id } });
      await db.playbook.create({
        data: {
          controllerId: row.controllerId, slug: row.slug, requestType: row.requestType,
          version: row.version, active: true, document: { template: 'does-not-exist' } as never,
        },
      });
      const out = await deactivate(db, AZ, { actor: 'test', env: DEV, write: silent });
      expect(out.action).toBe('DEACTIVATED');
      const rec = await db.corpusActivation.findUniqueOrThrow({ where: { id: out.activationId } });
      expect(rec.letterSha256).toBeNull();
    });

    it('says so when there is nothing to switch off', async () => {
      const [, { deactivate }] = await load();
      await deactivate(db, AZ, { actor: 'test', env: DEV, write: silent });
      await expect(deactivate(db, AZ, { actor: 'test', env: DEV, write: silent })).rejects.toThrow(/not active/);
    });
  });

  describe('the activation ledger is append-only (0019)', () => {
    it('refuses UPDATE and DELETE, like the evidence chain', async () => {
      const [{ importCorpus }, { activate }] = await load();
      await importCorpus(db);
      const out = await activate(db, AZ, {
        actor: 'test', env: { NODE_ENV: 'development' } as NodeJS.ProcessEnv,
        allowDraft: true, confirm: confirmWith(AZ), write: silent,
      });
      await expect(
        db.corpusActivation.update({ where: { id: out.activationId }, data: { actor: 'somebody else' } }),
      ).rejects.toThrow(/append-only/);
      await expect(db.corpusActivation.delete({ where: { id: out.activationId } })).rejects.toThrow(/append-only/);
    });

    it('refuses an ACTIVATED row with no letter recorded (CHECK activation_records_the_letter)', async () => {
      await expect(
        db.$executeRawUnsafe(
          `INSERT INTO "CorpusActivation" ("id","playbookSlug","playbookVersion","action","controllerSlug",` +
            `"requestType","templateName","templateStatus","templateSha256","letterSha256","actor",` +
            `"attestation","attestationSha256","posture") VALUES ` +
            `('t1','x',1,'ACTIVATED','c','OBJECTION_ART21','t.md','DRAFT','h',NULL,'a','att','h','dev')`,
        ),
      ).rejects.toThrow(/activation_records_the_letter/);
    });
  });
});
