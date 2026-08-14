-- 0018 — re-point the identity freeze at the SEALED columns.
--
-- 0005's `scraper_identity_freeze()` names `legalName` and `dateOfBirth`, which 0017 dropped.
-- PL/pgSQL resolves column references at EXECUTION time, so Postgres allowed the drop without a
-- word and the function kept its stale body: every UPDATE on a VERIFIED "Identity" then failed with
-- an "unrecognised column" error instead of the freeze's own message. The test suite caught it,
-- which is the argument for `db-invariants.test.ts` asserting the MESSAGE and not merely that
-- something threw — a trigger that fails for the wrong reason still looks like a trigger that works.
--
-- The invariant is unchanged and is the one rule at the storage layer: the subject of every request
-- is DERIVED from this row (ADR-009/019), so editing it in place silently changes whose data every
-- future request is about. Re-verification is still modelled as leaving VERIFIED and coming back.
--
-- Comparing CIPHERTEXT rather than plaintext is not a weakening. AES-GCM uses a random IV per seal,
-- so re-sealing the SAME name produces different bytes and is caught — the check is "these bytes were
-- not rewritten", which is strictly tighter than "this name did not change". It cannot be fooled the
-- other way either: identical bytes cannot decrypt to a different name.

CREATE OR REPLACE FUNCTION scraper_identity_freeze() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'VERIFIED' AND NEW."status" = 'VERIFIED' THEN
    IF (NEW."legalNameEnc"   IS DISTINCT FROM OLD."legalNameEnc")
    OR (NEW."dateOfBirthEnc" IS DISTINCT FROM OLD."dateOfBirthEnc")
    OR (NEW."method"         IS DISTINCT FROM OLD."method")
    OR (NEW."providerRef"    IS DISTINCT FROM OLD."providerRef")
    OR (NEW."verifiedAt"     IS DISTINCT FROM OLD."verifiedAt")
    OR (NEW."userId"         IS DISTINCT FROM OLD."userId") THEN
      RAISE EXCEPTION 'Identity %: a VERIFIED identity is immutable — the subject of every request is derived from it. Re-verify (leave VERIFIED first) rather than editing in place.', OLD."id";
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
