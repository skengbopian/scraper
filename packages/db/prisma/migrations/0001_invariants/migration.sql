-- Invariants that Prisma's DSL cannot express.
--
-- Every one of these is a case where application code alone would let a legally wrong row exist.
-- They are enforced in the database because the database is the last line: a worker retry, a raw
-- query, a future service, or a bug in a guard all route through here.
--
-- Run AFTER the generated schema migration.

-- ---------------------------------------------------------------------------------------------
-- 1. THE CLOCK (CLAUDE.md §6, audit C1).
-- deadlineAt is the Art. 12(3) statutory clock and may exist ONLY after a provable send.
-- Without this, a bug that set deadlineAt from an email accept would produce a request that
-- escalates to a DPA on a deadline that never legally started.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "RightsRequest"
  ADD CONSTRAINT "deadline_requires_provable_send"
  CHECK ("deadlineAt" IS NULL OR "provableSendConfirmedAt" IS NOT NULL);

-- A registered send is postal by definition — Einwurf-Einschreiben by email is not a thing (H2).
ALTER TABLE "RightsRequest"
  ADD CONSTRAINT "registered_is_postal_only"
  CHECK ("registered" = false OR "channel" = 'postal');

-- ---------------------------------------------------------------------------------------------
-- 2. IDENTITY (the anti-stalker keystone).
-- Exactly one current address per identity: zero renders an empty "Anschrift" line into a legal
-- letter, more than one makes the renderer pick arbitrarily.
-- ---------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX "one_current_address_per_identity"
  ON "IdentityAddress" ("identityId")
  WHERE "current" = true;

-- ---------------------------------------------------------------------------------------------
-- 3. IDEMPOTENCY (audit C3).
-- At most ONE non-terminal request per (user, controller, requestType). This is the "twice by
-- accident" guard. It deliberately does NOT forbid a second cycle after the first closed — that
-- would break the provenance follow-up chain, the resend path, and lawful annual Art. 15 re-access.
-- ---------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX "one_open_request_per_triple"
  ON "RightsRequest" ("userId", "controllerId", "requestType")
  WHERE "state" NOT IN ('COMPLIED', 'CLOSED_FAILED', 'WITHDRAWN');

-- ---------------------------------------------------------------------------------------------
-- 4. APPEND-ONLY LEDGERS.
-- RequestEvent and EvidenceRecord are the audit trail. A corrected record is a NEW row.
-- If these were mutable, the evidence chain would prove nothing.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'append-only table %: % is not permitted. Corrections are new rows (docs/03).',
    TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "request_event_append_only"
  BEFORE UPDATE OR DELETE ON "RequestEvent"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER "evidence_record_append_only"
  BEFORE UPDATE OR DELETE ON "EvidenceRecord"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------------------------------
-- 5. ESCALATION IS HUMAN-GATED (CLAUDE.md §5).
-- The state machine enforces this, but the database is where a raw UPDATE would bypass it.
-- Any arrival at ESCALATED must be accompanied by a HUMAN_OPS humanSend event.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_escalation_human_sent() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."state" = 'ESCALATED' AND (OLD."state" IS DISTINCT FROM 'ESCALATED') THEN
    IF NOT EXISTS (
      SELECT 1 FROM "RequestEvent"
      WHERE "requestId" = NEW."id" AND "toState" = 'ESCALATED'
        AND "actor" = 'HUMAN_OPS' AND "type" = 'humanSend'
    ) THEN
      RAISE EXCEPTION
        'request % cannot enter ESCALATED without a HUMAN_OPS humanSend event. An Art. 77 complaint '
        'is never auto-sent (CLAUDE.md §5, docs/06).', NEW."id";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Runs AFTER so the RequestEvent written in the same transaction is visible.
CREATE CONSTRAINT TRIGGER "escalation_requires_human_send"
  AFTER UPDATE ON "RightsRequest"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_escalation_human_sent();

-- ---------------------------------------------------------------------------------------------
-- 6. STATS INTEGRITY (docs/05 §7).
-- A convenience view so no reporting query has to remember the exclusion rule. NO_PROVABLE_CLOCK,
-- WITHDRAWN and ABANDONED are excluded: docs/05 §7 publishes these numbers as self-evidenced fact,
-- which makes an over-counted denominator a defamation exposure, not a reporting bug.
-- ---------------------------------------------------------------------------------------------
CREATE VIEW "ControllerComplianceStats" AS
SELECT
  "controllerId",
  COUNT(*) FILTER (WHERE "outcome" = 'COMPLIED')   AS complied,
  COUNT(*) FILTER (WHERE "outcome" = 'INCOMPLETE') AS incomplete,
  COUNT(*) FILTER (WHERE "outcome" = 'REFUSED')    AS refused,
  COUNT(*) FILTER (WHERE "outcome" = 'NO_RESPONSE') AS no_response,
  COUNT(*) AS countable_total
FROM "RightsRequest"
WHERE "outcome" IN ('COMPLIED', 'INCOMPLETE', 'REFUSED', 'NO_RESPONSE')
GROUP BY "controllerId";
