-- Port wave 1b (ADR-030, docs/port-plan-from-A.md): the pre-audit line's database INVARIANTS,
-- re-expressed against this baseline. Its schema and migration chain are deliberately NOT ported —
-- they encode a 13-state clock and a triple-blocking idempotency index that contradict ADR-012/013.
-- What crosses over is the hardening, adapted to this line's TEXT ids, enum names and column set.
--
-- Each invariant below answers "what could a future code path silently get wrong?" — the database
-- says no even when the application forgets.

-- ---------------------------------------------------------------------------------------------
-- (1) At most one ACTIVE playbook per (controller, requestType).
-- Two active playbooks for the same statutory ask means the engine picks arbitrarily — i.e. the
-- letter that goes out is chosen by row order. Counsel signs off a specific version (docs/04).
-- ---------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX "playbook_one_active" ON "Playbook" ("controllerId", "requestType") WHERE "active";

-- ---------------------------------------------------------------------------------------------
-- (2) Shipped playbook versions are immutable; only `active` may flip.
-- docs/04's authoring rule: a change is a NEW version, never an edit — otherwise the sign-off
-- recorded against version N no longer describes what version N sends.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION scraper_playbook_freeze() RETURNS TRIGGER AS $$
BEGIN
  IF (to_jsonb(NEW) - 'active') IS DISTINCT FROM (to_jsonb(OLD) - 'active') THEN
    RAISE EXCEPTION 'Playbook % v%: shipped versions are immutable except "active" — bump the version instead (docs/04)', OLD."slug", OLD."version";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "playbook_freeze"
  BEFORE UPDATE ON "Playbook"
  FOR EACH ROW EXECUTE FUNCTION scraper_playbook_freeze();

-- ---------------------------------------------------------------------------------------------
-- (3) A VERIFIED identity's subject fields are frozen while it stays VERIFIED.
-- The request subject is DERIVED from this row (ADR-009/019), so editing it in place silently
-- changes whose data every future request is about — the one rule, at the storage layer.
-- Adapted: the pre-audit line kept an identity HISTORY table and froze whole rows; this line keeps
-- one row per user, so re-verification is modelled as leaving VERIFIED (→ EXPIRED/PENDING) and
-- coming back. That keeps the audit meaning while remaining compatible with the ident-provider
-- callback, which re-verifies an existing user.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION scraper_identity_freeze() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'VERIFIED' AND NEW."status" = 'VERIFIED' THEN
    IF (NEW."legalName"   IS DISTINCT FROM OLD."legalName")
    OR (NEW."dateOfBirth" IS DISTINCT FROM OLD."dateOfBirth")
    OR (NEW."method"      IS DISTINCT FROM OLD."method")
    OR (NEW."providerRef" IS DISTINCT FROM OLD."providerRef")
    OR (NEW."verifiedAt"  IS DISTINCT FROM OLD."verifiedAt")
    OR (NEW."userId"      IS DISTINCT FROM OLD."userId") THEN
      RAISE EXCEPTION 'Identity %: a VERIFIED identity is immutable — the subject of every request is derived from it. Re-verify (leave VERIFIED first) rather than editing in place.', OLD."id";
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "identity_freeze"
  BEFORE UPDATE ON "Identity"
  FOR EACH ROW EXECUTE FUNCTION scraper_identity_freeze();

-- ---------------------------------------------------------------------------------------------
-- (4) A request's binding never moves.
-- Who it is for, which controller, under which playbook, which right, which cycle, and its
-- idempotency key are fixed at creation. Re-pointing any of them would let a request that passed
-- the guards for one (user, controller, type) be sent as another — the guards ran on the old values.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION scraper_request_binding_freeze() RETURNS TRIGGER AS $$
BEGIN
  IF (NEW."userId"         IS DISTINCT FROM OLD."userId")
  OR (NEW."controllerId"   IS DISTINCT FROM OLD."controllerId")
  OR (NEW."playbookId"     IS DISTINCT FROM OLD."playbookId")
  OR (NEW."requestType"    IS DISTINCT FROM OLD."requestType")
  OR (NEW."cycleOrdinal"   IS DISTINCT FROM OLD."cycleOrdinal")
  OR (NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey") THEN
    RAISE EXCEPTION 'RightsRequest %: the binding (user, controller, playbook, requestType, cycle, idempotency key) is fixed at creation — the guards ran against these values', OLD."id";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "request_binding_freeze"
  BEFORE UPDATE ON "RightsRequest"
  FOR EACH ROW EXECUTE FUNCTION scraper_request_binding_freeze();

-- ---------------------------------------------------------------------------------------------
-- (5) A login-gated self-serve route must carry its guided steps.
-- docs/08 guardrail 1: a route requiring the user's own account stays a GUIDED HANDOFF — we never
-- log in for them and never store a credential. The pre-audit line expressed this as
-- `executionMode = 'GUIDED_HANDOFF' OR NOT requiresLogin`; this line has no execution-mode column
-- because it has no automation path to constrain, so the equivalent obligation is that the route
-- must actually tell the user what to do. A login-gated route with no steps is a dead end.
-- ---------------------------------------------------------------------------------------------
-- NOTE the COALESCE: array_length('{}', 1) is NULL, not 0, and a CHECK that evaluates to NULL
-- PASSES. Without it this constraint silently permits exactly the row it exists to forbid.
ALTER TABLE "SelfServeRoute"
  ADD CONSTRAINT "self_serve_login_is_guided"
  CHECK (NOT "requiresLogin" OR COALESCE(array_length("steps", 1), 0) >= 1);

-- ---------------------------------------------------------------------------------------------
-- (6) Every retained raw controller document has a scheduled purge.
-- CLAUDE.md §4: keep the normalised record and the hashed evidence, not the raw dump. A stored
-- rawDocumentRef with no purge date is how "we'll clean it up later" becomes "we still have it".
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "ControllerResponse" ADD COLUMN "purgeRawAt" TIMESTAMP(3);

ALTER TABLE "ControllerResponse"
  ADD CONSTRAINT "raw_document_requires_purge_date"
  CHECK ("rawDocumentRef" IS NULL OR "purgeRawAt" IS NOT NULL);

-- The sweep's index: only rows that still hold a raw document.
CREATE INDEX "controller_response_purge_due"
  ON "ControllerResponse" ("purgeRawAt")
  WHERE "rawDocumentRef" IS NOT NULL;
