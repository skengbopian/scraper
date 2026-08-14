import { Prisma, PrismaClient } from '@prisma/client';
import { ENRICHMENT_BROKER_ROUTES, SOURCE_HARDENING_ROUTES } from '@scraper/core';
import { CENSUS, controllerTypeOf } from '../census/census.js';
import { DEV_DEMO_PLAYBOOK_PAIRS, DEV_IDENTITY, DEV_MANDATE, DEV_USER_ID, devFixturesEnabled } from '../common/dev-fixtures.js';
import { AesGcmEnvelopeCrypto, DevKekResolver, EnvelopeSecretCipher, type UserKeyResolver } from '@scraper/core';
import { hashPassword, generateTotpSecret, totpProvisioningUri } from '../auth/crypto.js';

/**
 * Seed the database: census controllers + self-serve routes always; the dev fixture account
 * (user, VERIFIED identity, mandate, demo playbooks) ONLY under SCRAPER_DEV_FIXTURES=1.
 *
 * Idempotent (upserts) — safe to re-run. Run:
 *   SCRAPER_DEV_FIXTURES=1 DATABASE_URL=postgresql://scraper:scraper@localhost:5432/scraper3 \
 *     node apps/api/dist/db/seed.js
 *
 * The demo playbooks are DB rows with `document.demo=true` and slug `demo.*` — the database
 * equivalent of the in-memory demo markers. They are NOT the counsel-gated YAML corpus in
 * playbooks/ (all of which stays active:false). Since port wave 5 the WORKER dispatches for real,
 * so "nothing can leave" no longer rests on dispatch being simulated: it rests on the demo
 * document's own `active: false`, which renderRequest() refuses (see demoPlaybookDocument below).
 */

export async function seed(db: PrismaClient): Promise<void> {
  for (const c of CENSUS) {
    await db.controller.upsert({
      where: { slug: c.slug },
      create: { id: c.id, slug: c.slug, legalName: c.name, type: controllerTypeOf(c) ?? 'OTHER' },
      update: { legalName: c.name, type: controllerTypeOf(c) ?? 'OTHER' },
    });
  }

  for (const r of [...ENRICHMENT_BROKER_ROUTES, ...SOURCE_HARDENING_ROUTES]) {
    const row = r as unknown as {
      companySlug: string; routeType: string; url: string; steps: readonly string[];
      requiresLogin?: boolean; estMinutes?: number;
    };
    const existing = await db.selfServeRoute.findFirst({ where: { companySlug: row.companySlug, routeType: row.routeType as never } });
    const data = {
      companySlug: row.companySlug,
      routeType: row.routeType as never,
      url: row.url,
      steps: [...row.steps],
      requiresLogin: row.requiresLogin === true,
      estMinutes: row.estMinutes ?? null,
    };
    if (existing) await db.selfServeRoute.update({ where: { id: existing.id }, data });
    else await db.selfServeRoute.create({ data });
  }

  if (!devFixturesEnabled()) return;

  // The env allow-list gates WHEN the fixture may exist; this gates WHERE (audit L6). The fixture
  // account ships PUBLISHED credentials, a deterministic TOTP secret, a VERIFIED identity and a
  // live all-scope mandate — NODE_ENV=development pointed at a remote DSN would plant all of that
  // into whatever database the URL names.
  const dsn = process.env.DATABASE_URL ?? '';
  if (dsn !== '' && !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(dsn)) {
    throw new Error(
      'seed: refusing to plant the dev fixture into a non-localhost DATABASE_URL — the fixture ' +
        'account has published credentials (dev-fixtures.ts). Seed fixtures only against a local database.',
    );
  }

  // Envelope key material first: the 0004 trigger refuses a credential without it. Provisioning is
  // idempotent AND repairs a row that predates 0004 — an existing user whose key is still null would
  // otherwise fail at encrypt() with no way back (re-running the seed must fix it, not repeat it).
  const envelope = new AesGcmEnvelopeCrypto(new DevKekResolver());
  const { wrappedDek } = await envelope.generateWrappedDek('user');
  await db.user.upsert({
    where: { id: DEV_USER_ID },
    create: { id: DEV_USER_ID, email: 'erika@example.com', wrappedDek, kekRef: 'user' },
    update: {},
  });
  const devUser = await db.user.findUniqueOrThrow({ where: { id: DEV_USER_ID }, select: { wrappedDek: true, kekRef: true } });
  if (!devUser.wrappedDek || !devUser.kekRef) {
    // Rotating the DEK invalidates anything sealed under the previous (absent) one, so the
    // credential is rewritten below in the same run.
    await db.user.update({ where: { id: DEV_USER_ID }, data: { wrappedDek, kekRef: 'user' } });
  }
  await db.identity.upsert({
    where: { id: DEV_IDENTITY.id },
    create: {
      id: DEV_IDENTITY.id,
      userId: DEV_USER_ID,
      status: 'VERIFIED',
      method: 'EID',
      legalName: DEV_IDENTITY.legalName,
      dateOfBirth: DEV_IDENTITY.dateOfBirth,
      verifiedAt: DEV_IDENTITY.verifiedAt,
      providerRef: DEV_IDENTITY.providerRef,
    },
    update: { status: 'VERIFIED' },
  });
  const addr = DEV_IDENTITY.addresses[0];
  if (!addr) throw new Error('dev fixture identity has no address — deriveSubject would refuse it');
  const hasAddr = await db.identityAddress.findFirst({ where: { identityId: DEV_IDENTITY.id, current: true } });
  if (!hasAddr) {
    await db.identityAddress.create({
      data: {
        identityId: DEV_IDENTITY.id, street: addr.street, postalCode: addr.postalCode,
        city: addr.city, country: addr.country, current: true, verifiedAt: addr.verifiedAt,
      },
    });
  }
  await db.mandate.upsert({
    where: { id: DEV_MANDATE.id },
    create: {
      id: DEV_MANDATE.id, userId: DEV_USER_ID, scope: [...DEV_MANDATE.scope] as never,
      qesSignatureRef: 'dev-fixture', documentHash: 'dev-fixture', signedAt: DEV_MANDATE.signedAt,
    },
    update: { revokedAt: null },
  });
  // Dev login credential — fixture password, printed TOTP provisioning for authenticator apps.
  const totpSecret = generateTotpSecret('dev-fixture-stable');
  const keys: UserKeyResolver = {
    getUserKey: async (userId) => {
      const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { wrappedDek: true, kekRef: true } });
      if (!u.wrappedDek || !u.kekRef) throw new Error('dev fixture user has no envelope key');
      return { wrappedDek: Buffer.from(u.wrappedDek), kekRef: u.kekRef };
    },
  };
  const totpSecretEnc = await new EnvelopeSecretCipher(envelope, keys).encrypt(DEV_USER_ID, Buffer.from(totpSecret, 'utf8'));
  await db.authCredential.upsert({
    where: { userId: DEV_USER_ID },
    create: { userId: DEV_USER_ID, passwordHash: await hashPassword('erika-demo-2026'), totpSecretEnc },
    // Re-seal on every run: the secret is deterministic for the fixture, but the DEK may have just
    // been provisioned, and a secret sealed under an older key would be undecryptable.
    update: { totpSecretEnc },
  });
  // eslint-disable-next-line no-console
  console.log(`dev login: erika@example.com / erika-demo-2026 · TOTP: ${totpProvisioningUri('erika@example.com', totpSecret)}`);

  for (const pair of DEV_DEMO_PLAYBOOK_PAIRS) {
    const controller = await db.controller.findUnique({ where: { slug: pair.controllerSlug } });
    if (!controller) continue;
    const slug = `demo.${pair.controllerSlug}.${pair.requestType.toLowerCase()}`;
    // `playbook_one_active` (0005) allows exactly one active row per (controller, requestType), so
    // the predecessor is stood down before the new version is stood up.
    await db.playbook.updateMany({ where: { slug, version: { not: DEMO_PLAYBOOK_VERSION } }, data: { active: false } });
    await db.playbook.upsert({
      where: { slug_version: { slug, version: DEMO_PLAYBOOK_VERSION } },
      create: {
        controllerId: controller.id,
        slug,
        requestType: pair.requestType as never,
        version: DEMO_PLAYBOOK_VERSION,
        // The ROW is active so the router can find it and the LEGAL branch is reachable in the
        // alpha. The DOCUMENT is `active: false`, which is the counsel gate: `renderRequest()`
        // refuses it, so the worker's dispatch reaches the ops queue with that reason and no letter
        // is ever produced. Two different `active` flags, deliberately — one is routing, one is
        // sign-off, and conflating them is how a demo fixture would start sending real letters.
        active: true,
        document: demoPlaybookDocument(slug, pair.controllerSlug, pair.requestType),
      },
      // ONLY `active`. `playbook_freeze` (0005) refuses to rewrite a shipped version's document in
      // place, and it is right to: the counsel sign-off recorded against version N would stop
      // describing what version N sends. A changed fixture is a new version — hence the constant.
      update: { active: true },
    });
  }
}

/**
 * v2: port wave 5 turned the three-key stub into a complete Playbook document. v3: the audit pass —
 * the document now passes the SAME schema+lint gate the shipped corpus does (the `demo: true`
 * marker key violated `additionalProperties: false`, so the "valid" claim below was false and
 * nothing checked it — audit P1c); the bureau-erasure demo carries the BOUNDED shape (audit P2);
 * and `document.version` agrees with the row. `playbook_freeze` (0005) forbids editing a shipped
 * version in place — "bump the version instead (docs/04)" — and that applies to fixtures too.
 */
const DEMO_PLAYBOOK_VERSION = 3;
export { DEMO_PLAYBOOK_VERSION, demoPlaybookDocument };

/**
 * A COMPLETE Playbook document for the demo rows — schema-valid (spec-audit gates it) and
 * `active: false`.
 *
 * It used to be a three-key stub (`{demo, channel, validation}`), which meant the worker's dispatch
 * failed on "template undefined could not be read" before it ever reached the counsel gate. The
 * fixture was hiding the thing it should have been demonstrating. Now the worker plans a real
 * channel, resolves a real recipient, and is refused for the reason that actually applies.
 *
 * The ERASURE_ART17 demo pair targets a BUREAU (infoscore — dev-fixtures), so its document mirrors
 * the bounded chain shape (`loeschung-herkunft.*`): scope-bound template + `scopeSource:
 * PROVENANCE_ANSWER`. The generic `art17-loeschung.de` template says in its own header it is NOT
 * for credit bureaus; a fixture normalising that pairing is one copied starting point away from the
 * exact letter docs/07 forbids (audit P2).
 *
 * `template` names a file that exists in `templates/`, so a refusal cannot be an artefact of a
 * missing file either.
 */
/** docs/07 venue seed, fixture-only. The REAL venue per controller is counsel-owned (OQ per row). */
const DEMO_SEAT_DPA: Readonly<Record<string, string>> = {
  infoscore: 'LFDI_BW',
  crif: 'LFDI_BW',
  schufa: 'HBDI',
  regis24: 'BLNBDI',
};

function demoPlaybookDocument(slug: string, controllerSlug: string, requestType: string): Prisma.InputJsonValue {
  const bounded = requestType === 'ERASURE_ART17';
  const provenance = requestType === 'ACCESS_ART15_SOURCE';
  const template =
    requestType === 'OBJECTION_ART21'
      ? 'art21-werbewiderspruch.de'
      : provenance
        ? 'art15g-herkunft.de'
        : bounded
          ? 'art17-loeschung-herkunft.de'
          : 'art15-datenkopie.de';
  return {
    slug,
    kind: 'RIGHTS_REQUEST',
    controller: controllerSlug,
    requestType,
    version: DEMO_PLAYBOOK_VERSION,
    // THE COUNSEL GATE. Never flip this in a fixture: renderRequest() refuses an inactive playbook,
    // and that refusal is the only thing standing between the alpha and a real outbound letter.
    active: false,
    channel: { primary: 'email' },
    recipient: { email: `datenschutz@${controllerSlug}.invalid` },
    template,
    subjectFields: ['legalName', 'dateOfBirth', 'addresses'],
    deadlineDays: 30,
    // The scope binding makes the unbounded rendering structurally unreachable: renderRequest()
    // refuses a scoped playbook without a deriveErasureScope()-constructed PartialErasureScope.
    ...(bounded ? { scopeSource: 'PROVENANCE_ANSWER' } : {}),
    // The flagship shape requires its extraction contract + venue (schema: ACCESS_ART15_SOURCE ⇒
    // provenance + seatDpa). Fixture values mirror docs/07's seed rows.
    ...(provenance
      ? {
          provenance: { extractPerCategory: true, brokerWatchlist: ['az-direct'], flagIf: { incompleteSourceList: true } },
          seatDpa: DEMO_SEAT_DPA[controllerSlug] ?? 'BFDI',
        }
      : {}),
    validation: { compliedIf: { responseContains: ['gelöscht', 'widersprochen'] }, humanReviewIfConfidenceBelow: 0.75 },
    escalation: { onDeadlineExpiry: 'NONE', onRefusal: 'DRAFT_ART77' },
  };
}

const isMain = process.argv[1]?.endsWith('seed.js') || process.argv[1]?.endsWith('seed.ts');
if (isMain) {
  const db = new PrismaClient();
  seed(db)
    .then(() => {
      // eslint-disable-next-line no-console
      console.log('seed complete');
      return db.$disconnect();
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
      process.exit(1);
    });
}
