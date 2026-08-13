-- Port wave 3 (ADR-030 / ADR-035): the pre-audit line's AUTH POLICY, re-expressed against this
-- baseline. What crosses over is the policy — idle timeout, step-up, TOTP replay defence, recovery
-- codes, durable throttling — not its schema, which encodes a different session model.
--
-- NUMBERING: 0006 is deliberately unused and 0007 belongs to the leverage-ladder wave, developed on
-- a parallel branch. Migrations are applied in lexicographic order, so a fresh database gets
-- 0005 → 0007 → 0008 whatever order the branches land in; the gap is a coordination artefact, not a
-- missing migration.
--
-- Each block answers "what could a future code path silently get wrong?" — the database says no even
-- when the application forgets.

-- ---------------------------------------------------------------------------------------------
-- (1) Sessions gain the three timestamps the policy actually decides on.
--
-- `lastSeenAt` is what makes an idle timeout possible at all: absolute TTL alone cannot express "a
-- tab left open on a shared laptop stops being authenticated". `mfaCompletedAt` and `stepUpAt` are
-- timestamps rather than flags because both policies are about FRESHNESS — "did the second factor
-- happen in the last ten minutes" is unanswerable from a boolean.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "Session" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
UPDATE "Session" SET "lastSeenAt" = "createdAt" WHERE "lastSeenAt" IS NULL;
ALTER TABLE "Session" ALTER COLUMN "lastSeenAt" SET NOT NULL;
ALTER TABLE "Session" ALTER COLUMN "lastSeenAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Session" ADD COLUMN "mfaCompletedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "stepUpAt" TIMESTAMP(3);
-- Existing verified sessions predate the timestamp; their creation is the best evidence we have of
-- when the factor was presented, and it is conservative (never later than the truth).
UPDATE "Session" SET "mfaCompletedAt" = "createdAt" WHERE "mfaVerified" AND "mfaCompletedAt" IS NULL;

-- ---------------------------------------------------------------------------------------------
-- (2) The boolean and the timestamp may never disagree.
--
-- `mfaVerified` is kept because the middleware and the existing suites read it; `mfaCompletedAt` is
-- added because the policy needs the time. Two columns describing one fact is exactly the shape that
-- drifts, so the disagreement is made unrepresentable instead of being left to discipline.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "Session"
  ADD CONSTRAINT "session_mfa_flags_agree"
  CHECK ("mfaVerified" = ("mfaCompletedAt" IS NOT NULL));

-- ---------------------------------------------------------------------------------------------
-- (3) Step-up cannot exist without MFA.
--
-- Step-up is a RE-confirmation of the second factor. A row carrying `stepUpAt` with no
-- `mfaCompletedAt` would be a session that skipped the factor and then re-confirmed it — which is
-- how a half-authenticated session would reach the credit file (docs/06 C2).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "Session"
  ADD CONSTRAINT "session_stepup_requires_mfa"
  CHECK ("stepUpAt" IS NULL OR "mfaCompletedAt" IS NOT NULL);

-- ---------------------------------------------------------------------------------------------
-- (4) The expiry sweep gets an index that matches the query it runs.
--
-- Partial on `revokedAt IS NULL`: the sweep only ever looks for live sessions, and an index that
-- also carries the revoked ones grows without bound as the product ages.
-- ---------------------------------------------------------------------------------------------
CREATE INDEX "session_expiry_sweep" ON "Session" ("expiresAt") WHERE "revokedAt" IS NULL;

-- ---------------------------------------------------------------------------------------------
-- (5) TOTP replay defence + throttle counters on the user.
--
-- `totpLastCounter` is the whole of the replay defence: a code is refused when its counter is at or
-- below the last accepted one. It is BIGINT because the counter is unix-time/30 and will outlive
-- int4 in 2038.
--
-- The two throttle budgets are SEPARATE columns, and that is the security decision, not a modelling
-- convenience. A password lockout can be triggered by anyone who knows the email address. If the
-- second factor shared that budget, a stranger with only the victim's email could spray passwords
-- until the account stopped accepting the victim's OWN authenticator codes — locking them out of the
-- account that holds their credit file. The MFA counter can only be moved by someone who has already
-- passed the password step.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN "totpEnrolledAt"    TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "totpLastCounter"   BIGINT;
ALTER TABLE "User" ADD COLUMN "failedLoginCount"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastFailedLoginAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "failedMfaCount"    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastFailedMfaAt"   TIMESTAMP(3);

ALTER TABLE "User" ADD CONSTRAINT "user_failure_counts_non_negative"
  CHECK ("failedLoginCount" >= 0 AND "failedMfaCount" >= 0);

-- ---------------------------------------------------------------------------------------------
-- (6) The replay counter may never move BACKWARDS.
--
-- Rewinding it re-opens every code between the old value and the new one. That is not a hypothetical
-- ordering bug: two concurrent MFA submissions racing on the same session would do it, with the
-- loser's older counter landing last. The database refuses rather than trusting write order.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION scraper_totp_counter_monotonic() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."totpLastCounter" IS NOT NULL
     AND NEW."totpLastCounter" IS NOT NULL
     AND NEW."totpLastCounter" < OLD."totpLastCounter" THEN
    RAISE EXCEPTION 'User %: totpLastCounter may not move backwards (% -> %) — rewinding it re-opens every code in between to replay', OLD."id", OLD."totpLastCounter", NEW."totpLastCounter";
  END IF;
  IF OLD."totpLastCounter" IS NOT NULL AND NEW."totpLastCounter" IS NULL THEN
    RAISE EXCEPTION 'User %: totpLastCounter may not be cleared — that disables replay defence entirely', OLD."id";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "totp_counter_monotonic"
  BEFORE UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION scraper_totp_counter_monotonic();

-- ---------------------------------------------------------------------------------------------
-- (7) Recovery codes: single use, hashed, and never resurrected.
--
-- These matter more here than in an ordinary product: the TOTP secret is envelope-encrypted under
-- the user's own DEK (CLAUDE.md §4), so no operator can read it and reset it for them. A lost phone
-- with no recovery code is a permanently unreachable account — holding the evidence pack for legal
-- actions the user may be in the middle of.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "RecoveryCode" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  -- sha256 hex of the normalised code. The plaintext is shown once at enrolment and stored nowhere.
  "codeHash"  TEXT NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecoveryCode_codeHash_key" ON "RecoveryCode" ("codeHash");
CREATE INDEX "RecoveryCode_userId_idx" ON "RecoveryCode" ("userId");
ALTER TABLE "RecoveryCode"
  ADD CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Single use, enforced where it cannot be forgotten. An application-level "if (code.usedAt) reject"
-- is one early return away from being wrong; this makes a second redemption impossible, including
-- under a concurrent double-submit, and also refuses un-using a code (which would silently restore a
-- credential an attacker had already spent).
CREATE OR REPLACE FUNCTION scraper_recovery_code_single_use() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."usedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'RecoveryCode %: already used at % — recovery codes are single use', OLD."id", OLD."usedAt";
  END IF;
  IF NEW."codeHash" IS DISTINCT FROM OLD."codeHash" OR NEW."userId" IS DISTINCT FROM OLD."userId" THEN
    RAISE EXCEPTION 'RecoveryCode %: the code and its owner are immutable — issue a new set instead', OLD."id";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "recovery_code_single_use"
  BEFORE UPDATE ON "RecoveryCode"
  FOR EACH ROW EXECUTE FUNCTION scraper_recovery_code_single_use();
