-- Per-user envelope encryption (CLAUDE.md §4), port wave 1 / ADR-030.
--
-- Closes a gap this line had asserted in prose and never implemented: the TOTP shared secret was
-- stored as plaintext base32, so a database dump handed over the second factor. The secret is now
-- sealed under the user's DEK (packages/core/src/crypto/envelope.ts).
--
-- NO DATA MIGRATION IS ATTEMPTED. Re-encrypting existing plaintext secrets in a migration would
-- require the KEK in the migration context, and any row written before this migration was written
-- under a posture we are deliberately abandoning. Pre-launch, the correct move is re-enrolment:
-- existing credentials are dropped and users enrol a fresh second factor. There is no production
-- deployment for this to disrupt.

ALTER TABLE "User" ADD COLUMN "wrappedDek" BYTEA;
ALTER TABLE "User" ADD COLUMN "kekRef" TEXT;

-- Drop credentials rather than carry a plaintext secret forward under a new name.
DELETE FROM "AuthCredential";
ALTER TABLE "AuthCredential" DROP COLUMN "totpSecret";
ALTER TABLE "AuthCredential" ADD COLUMN "totpSecretEnc" BYTEA NOT NULL;

-- A credential row without user key material cannot have a decryptable secret. The application
-- provisions the DEK at registration; this makes the coupling structural rather than remembered.
CREATE OR REPLACE FUNCTION assert_user_has_envelope_key() RETURNS TRIGGER AS $$
DECLARE has_key BOOLEAN;
BEGIN
  SELECT ("wrappedDek" IS NOT NULL AND "kekRef" IS NOT NULL) INTO has_key FROM "User" WHERE "id" = NEW."userId";
  IF NOT has_key THEN
    RAISE EXCEPTION 'AuthCredential for user %: no envelope key material on the user row — the TOTP secret would be unopenable (CLAUDE.md §4)', NEW."userId";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "auth_credential_requires_envelope_key"
  BEFORE INSERT OR UPDATE ON "AuthCredential"
  FOR EACH ROW EXECUTE FUNCTION assert_user_has_envelope_key();
