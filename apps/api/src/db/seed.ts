import { PrismaClient } from '@prisma/client';
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
 * playbooks/ (all of which stays active:false); nothing here can cause a real send because
 * dispatch in the alpha exists only as the dev-only simulate surface.
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
