import { PrismaClient } from '@prisma/client';
import { ENRICHMENT_BROKER_ROUTES, SOURCE_HARDENING_ROUTES } from '@scraper/core';
import { CENSUS } from '../census/census.js';
import { DEV_DEMO_PLAYBOOK_PAIRS, DEV_IDENTITY, DEV_MANDATE, DEV_USER_ID, devFixturesEnabled } from '../common/dev-fixtures.js';
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
 * playbooks/ (all of which stays active:false); nothing here can cause a real send because
 * dispatch in the alpha exists only as the dev-only simulate surface.
 */
const TYPE_MAP: Record<string, 'DATA_ENRICHMENT_BROKER' | 'ADDRESS_TRADER' | 'CREDIT_BUREAU' | 'AI_SCREENER'> = {
  'Datenhändler': 'DATA_ENRICHMENT_BROKER',
  'Adress-Broker': 'ADDRESS_TRADER',
  'Auskunftei': 'CREDIT_BUREAU',
  'KI-Bewerbungstool': 'AI_SCREENER',
};

export async function seed(db: PrismaClient): Promise<void> {
  for (const c of CENSUS) {
    await db.controller.upsert({
      where: { slug: c.slug },
      create: { id: c.id, slug: c.slug, legalName: c.name, type: TYPE_MAP[c.type] ?? 'OTHER' },
      update: { legalName: c.name, type: TYPE_MAP[c.type] ?? 'OTHER' },
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

  await db.user.upsert({
    where: { id: DEV_USER_ID },
    create: { id: DEV_USER_ID, email: 'erika@example.com' },
    update: {},
  });
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
  await db.authCredential.upsert({
    where: { userId: DEV_USER_ID },
    create: { userId: DEV_USER_ID, passwordHash: await hashPassword('erika-demo-2026'), totpSecret },
    update: {},
  });
  // eslint-disable-next-line no-console
  console.log(`dev login: erika@example.com / erika-demo-2026 · TOTP: ${totpProvisioningUri('erika@example.com', totpSecret)}`);

  for (const pair of DEV_DEMO_PLAYBOOK_PAIRS) {
    const controller = await db.controller.findUnique({ where: { slug: pair.controllerSlug } });
    if (!controller) continue;
    await db.playbook.upsert({
      where: { slug_version: { slug: `demo.${pair.controllerSlug}.${pair.requestType.toLowerCase()}`, version: 1 } },
      create: {
        controllerId: controller.id,
        slug: `demo.${pair.controllerSlug}.${pair.requestType.toLowerCase()}`,
        requestType: pair.requestType as never,
        version: 1,
        active: true, // DEMO row (document.demo=true), not a counsel-gated YAML — see header note.
        document: { demo: true, channel: { primary: 'email', registered: { fallback: true } }, validation: { humanReviewIfConfidenceBelow: 0.75 } },
      },
      update: { active: true },
    });
  }
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
