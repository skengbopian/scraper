-- 0007_routing_decision — ADR-036 (port wave 4: the leverage ladder).
--
-- The router now records WHY every rung it did not take was rejected: a self-serve page at a credit
-- bureau is rejected as HIGH_HARM_CONTROLLER_TYPE, an export claiming to discharge Art. 15 as
-- TIER_CANNOT_ACHIEVE_OUTCOME, and so on. Those reasons are the audit trail for a decision that
-- otherwise looks arbitrary in hindsight ("why did it send a letter when the company has a form?").
--
-- Nullable and additive: every existing LeverageAction predates the ladder, and back-filling a reason
-- we did not compute would be inventing an audit record.
ALTER TABLE "LeverageAction" ADD COLUMN "routingDecision" JSONB;

-- The payload is non-personal by construction (outcome, tiers, mechanisms, route refs). This is a
-- structural reminder rather than a proof: it rejects the shapes that could only be personal data.
ALTER TABLE "LeverageAction"
  ADD CONSTRAINT "leverage_routing_decision_is_object"
  CHECK ("routingDecision" IS NULL OR jsonb_typeof("routingDecision") = 'object');
