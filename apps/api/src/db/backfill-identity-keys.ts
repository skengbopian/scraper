import { PrismaClient } from '@prisma/client';
import { AesGcmEnvelopeCrypto, sealAddressLines, sealIdentityFields } from '@scraper/core';
import { kekResolver } from '../auth/auth.service.js';
import { createPurposeCipher, provisionUserKeys } from '../identity/user-key.store.js';

/**
 * Seal every existing identity under a DOSSIER key. Run BETWEEN migrations 0016 and 0017.
 *
 *   0016  adds the key table and the ciphertext columns, additive, nothing destroyed
 *   THIS  provisions keys and encrypts what is already there
 *   0017  drops the plaintext columns — and REFUSES to run until this has done its job
 *
 * The three steps exist because SQL cannot encrypt: a single migration adding the ciphertext columns
 * and dropping the plaintext ones would have destroyed every identity in the database silently, and
 * been discovered by a user whose letter went out with an empty Anschrift line. 0017's guard checks
 * the ROWS rather than trusting an operator's word that this ran.
 *
 * Idempotent and re-runnable: rows that already carry ciphertext are skipped, and key provisioning
 * upserts. A row whose key was SHREDDED is skipped too and reported — re-sealing an erased user's
 * identity would hand back data they asked us to destroy, and there is no plaintext to seal anyway.
 *
 * Run with the SAME KEK the application will use. Sealing under a dev KEK and deploying with an env
 * KEK produces a database of undecryptable rows, which is why this reads `kekResolver()` rather than
 * taking a key as an argument.
 */
export async function backfillIdentityKeys(db: PrismaClient): Promise<{
  usersKeyed: number;
  identitiesSealed: number;
  addressesSealed: number;
  skippedShredded: number;
}> {
  const crypto = new AesGcmEnvelopeCrypto(kekResolver());
  const cipher = createPurposeCipher(db, crypto);
  let usersKeyed = 0;
  let identitiesSealed = 0;
  let addressesSealed = 0;
  let skippedShredded = 0;

  const users = await db.user.findMany({ select: { id: true, kekRef: true } });
  for (const user of users) {
    // `kekRef` on the user row names the KEK its AUTH key was sealed under; new purpose keys use the
    // same one so a deployment has one KEK to rotate rather than two to keep in step.
    await provisionUserKeys(db, crypto, user.id, user.kekRef ?? 'user');
    usersKeyed += 1;
  }

  // Raw SQL because the plaintext columns are, by design, no longer in the Prisma schema — the
  // schema describes the world after 0017, and this script is the bridge. Reading them any other way
  // would mean carrying a second generated client just for one migration step.
  const identities = await db.$queryRawUnsafe<
    { id: string; userId: string; legalName: string | null; dateOfBirth: Date | null }[]
  >(
    'SELECT i."id", i."userId", i."legalName", i."dateOfBirth" FROM "Identity" i ' +
      'WHERE (i."legalName" IS NOT NULL AND i."legalNameEnc" IS NULL) ' +
      'OR (i."dateOfBirth" IS NOT NULL AND i."dateOfBirthEnc" IS NULL)',
  );
  for (const row of identities) {
    try {
      const sealed = await sealIdentityFields(cipher, row.userId, {
        legalName: row.legalName ?? '',
        dateOfBirth: row.dateOfBirth ?? new Date(0),
      });
      await db.identity.update({
        where: { id: row.id },
        data: { legalNameEnc: sealed.legalNameEnc, dateOfBirthEnc: sealed.dateOfBirthEnc },
      });
      identitiesSealed += 1;
    } catch (e) {
      if (!isShredded(e)) throw e;
      skippedShredded += 1;
    }
  }

  const addresses = await db.$queryRawUnsafe<
    { id: string; userId: string; street: string; postalCode: string; city: string }[]
  >(
    'SELECT a."id", i."userId", a."street", a."postalCode", a."city" FROM "IdentityAddress" a ' +
      'JOIN "Identity" i ON i."id" = a."identityId" ' +
      'WHERE a."streetEnc" IS NULL OR a."postalCodeEnc" IS NULL OR a."cityEnc" IS NULL',
  );
  for (const row of addresses) {
    try {
      const sealed = await sealAddressLines(cipher, row.userId, {
        street: row.street,
        postalCode: row.postalCode,
        city: row.city,
      });
      await db.identityAddress.update({
        where: { id: row.id },
        data: { streetEnc: sealed.streetEnc, postalCodeEnc: sealed.postalCodeEnc, cityEnc: sealed.cityEnc },
      });
      addressesSealed += 1;
    } catch (e) {
      if (!isShredded(e)) throw e;
      skippedShredded += 1;
    }
  }

  return { usersKeyed, identitiesSealed, addressesSealed, skippedShredded };
}

function isShredded(e: unknown): boolean {
  return e instanceof Error && e.name === 'KeyShreddedError';
}

const isMain = process.argv[1]?.endsWith('backfill-identity-keys.js');
if (isMain) {
  const db = new PrismaClient();
  backfillIdentityKeys(db)
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log(
        `backfill: ${r.usersKeyed} user(s) keyed · ${r.identitiesSealed} identity row(s) sealed · ` +
          `${r.addressesSealed} address row(s) sealed · ${r.skippedShredded} skipped (key already shredded)`,
      );
      // A shredded skip is not a failure, but it MUST be visible: those rows still hold plaintext
      // that 0017 is about to drop, and dropping an erased user's leftover plaintext is the correct
      // outcome — it just should not happen silently.
      if (r.skippedShredded > 0) {
        // eslint-disable-next-line no-console
        console.log(
          '  note: skipped rows belong to users whose DOSSIER key was already shredded. Their ' +
            'remaining plaintext is dropped by 0017, which completes an erasure that predates this ' +
            'mechanism rather than undoing one.',
        );
      }
      return db.$disconnect();
    })
    .catch(async (e) => {
      // eslint-disable-next-line no-console
      console.error('backfill FAILED — do not deploy 0017:', e);
      await db.$disconnect();
      process.exitCode = 1;
    });
}
