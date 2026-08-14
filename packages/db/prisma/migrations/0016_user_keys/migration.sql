-- 0016 — per-user keys by purpose, an erasure stamp, and the sealed identity columns (audit H2/W14).
--
-- ADDITIVE ONLY. The plaintext identity columns are still here and still authoritative after this
-- migration; 0017 drops them, and it REFUSES to run until a backfill has sealed every row. The split
-- is the point: there is no way to encrypt a column in SQL, so a single migration that added the
-- ciphertext columns and dropped the plaintext ones would have destroyed every existing identity
-- silently. Two migrations with a script between them make the destructive step something a human
-- has to reach for.
--
-- WHY A TABLE AND NOT MORE COLUMNS ON "User". The purposes have different LIFETIMES, and a lifetime
-- is a row-level fact:
--
--   DOSSIER   what we hold ABOUT the user because they asked us to act — identity, addresses, and
--             (pass 2) credit-file contents. Shredded IMMEDIATELY on Art. 17 erasure. Destroying
--             this key IS the erasure.
--   EVIDENCE  what proves WHAT WE DID on their behalf — the subject snapshot in the append-only
--             request ledger. Survives erasure to a limitation window (§ 195 BGB, 3 years, running
--             from year-end per § 199(1)), then a job shreds it too.
--
-- Art. 17(3)(e) is why the second one exists. This product sends legal letters in a user's name; if
-- a controller later disputes that a request was made, or made lawfully, these artefacts are the
-- only answer available. A single DEK shredded on erasure would have thrown that away — and
-- promising to destroy it would have been both unlawful and unwise.
--
-- The AUTH key ("User"."wrappedDek", sealing the TOTP secret) stays where it is. A second factor
-- sharing the DOSSIER key would be opened by any DOSSIER compromise and destroyed by a shred that
-- has nothing to do with authentication. Erasure nulls it too, as a separate act.

CREATE TYPE "UserKeyPurpose" AS ENUM ('DOSSIER', 'EVIDENCE');

CREATE TABLE "UserKey" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "purpose"    "UserKeyPurpose" NOT NULL,
    -- NULL means SHREDDED. The row survives its own key: "this user's dossier key was destroyed on
    -- 2026-08-14" is itself the evidence that the erasure happened, and a deleted row proves nothing.
    "wrappedDek" BYTEA,
    "kekRef"     TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shreddedAt" TIMESTAMP(3),
    CONSTRAINT "UserKey_pkey" PRIMARY KEY ("id")
);

-- One key per purpose per user. Two DOSSIER keys would mean half the dossier survives a shred.
CREATE UNIQUE INDEX "UserKey_userId_purpose_key" ON "UserKey"("userId", "purpose");

ALTER TABLE "UserKey"
  ADD CONSTRAINT "UserKey_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Key material and the shred stamp are the SAME FACT and must move together. Material with no stamp
-- is a corruption, and reading it as an erasure would quietly write off data nobody asked us to
-- erase; a stamp with material still present is an erasure that did not happen, which is worse — it
-- is a claim to a regulator that the bytes contradict.
ALTER TABLE "UserKey"
  ADD CONSTRAINT "user_key_shred_is_atomic"
  CHECK (("wrappedDek" IS NULL) = ("shreddedAt" IS NOT NULL));

-- The erasure stamp. `evaluateSession` already refuses a session whose user carries one (it has
-- read `userErasedAt` since port wave 3 and the API has been passing a hardcoded null) — this is the
-- column that makes that branch reachable.
ALTER TABLE "User" ADD COLUMN "userErasedAt" TIMESTAMP(3);

-- The sealed columns, NULLABLE for now. 0017 drops their plaintext siblings and, for the address
-- lines, makes these NOT NULL — an address line is not optional in a letter.
ALTER TABLE "Identity"
  ADD COLUMN "legalNameEnc"   BYTEA,
  ADD COLUMN "dateOfBirthEnc" BYTEA;

ALTER TABLE "IdentityAddress"
  ADD COLUMN "streetEnc"     BYTEA,
  ADD COLUMN "postalCodeEnc" BYTEA,
  ADD COLUMN "cityEnc"       BYTEA;
