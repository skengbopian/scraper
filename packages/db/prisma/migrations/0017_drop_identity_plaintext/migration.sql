-- 0017 — drop the plaintext identity columns. THE DESTRUCTIVE HALF, and it refuses to guess.
--
-- Run `pnpm --filter @scraper/api backfill:identity-keys` first. It provisions the DOSSIER/EVIDENCE
-- keys for every existing user and seals the identity fields under the DOSSIER one. This migration
-- checks its work and RAISES if a single row would lose data — there is no way to encrypt a column
-- in SQL, so a row still holding plaintext with no ciphertext beside it cannot be rescued here, and
-- dropping it would be silent, permanent, and discovered by a user whose letter went out with an
-- empty Anschrift line.
--
-- The check is on the ROWS, not on a flag someone can set. A migration that trusted an operator's
-- assertion that the backfill had run would fail exactly when the assertion was wrong.

DO $$
DECLARE unsealed_identities int; unsealed_addresses int;
BEGIN
  SELECT count(*) INTO unsealed_identities
    FROM "Identity"
    WHERE ("legalName" IS NOT NULL AND "legalNameEnc" IS NULL)
       OR ("dateOfBirth" IS NOT NULL AND "dateOfBirthEnc" IS NULL);

  SELECT count(*) INTO unsealed_addresses
    FROM "IdentityAddress"
    WHERE "streetEnc" IS NULL OR "postalCodeEnc" IS NULL OR "cityEnc" IS NULL;

  IF unsealed_identities > 0 OR unsealed_addresses > 0 THEN
    RAISE EXCEPTION
      'refusing to drop plaintext identity columns: % Identity row(s) and % IdentityAddress row(s) '
      'still hold data that has not been sealed under a DOSSIER key. Run the identity-key backfill '
      '(pnpm --filter @scraper/api backfill:identity-keys) and deploy again. This migration cannot '
      'encrypt anything itself — SQL has no access to the KEK — so continuing would destroy those '
      'rows silently.',
      unsealed_identities, unsealed_addresses;
  END IF;
END $$;

ALTER TABLE "Identity" DROP COLUMN "legalName", DROP COLUMN "dateOfBirth";

-- An address line is not optional: a letter with an empty Anschrift is not a letter. These were
-- NOT NULL as plaintext and go back to NOT NULL as ciphertext, which also means the backfill cannot
-- have half-sealed a row and left it to be noticed later.
ALTER TABLE "IdentityAddress"
  DROP COLUMN "street",
  DROP COLUMN "postalCode",
  DROP COLUMN "city",
  ALTER COLUMN "streetEnc"     SET NOT NULL,
  ALTER COLUMN "postalCodeEnc" SET NOT NULL,
  ALTER COLUMN "cityEnc"       SET NOT NULL;
