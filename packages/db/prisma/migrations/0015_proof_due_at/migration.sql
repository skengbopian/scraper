-- 0015 — `proofDueAt`, and the database's own statement of "a lodgement starts no clock".
--
-- `proofDueAt` is when to stop waiting for the carrier's Auslieferungsbeleg and ask a human. It is
-- weaker than `provisionalDeadlineAt`, which is itself weaker than `deadlineAt`:
--
--   deadlineAt            the Art. 12(3) month. Legal. Only a provable send may set it.
--   provisionalDeadlineAt when to ask the user to escalate the CHANNEL. Operational.
--   proofDueAt            when to stop waiting on a VENDOR. Operational, and about us, not them.
--
-- Three columns rather than one nullable "deadline" with a kind flag, for the reason 0001 gives for
-- the first two: a query cannot confuse columns it has to name, and it can very easily confuse a
-- flag it forgot to filter on. An Art. 77 complaint founded on the wrong one is the failure mode.
--
-- The CHECK is the legal rule, restated where it cannot be bypassed by application code:
--   (a) proofDueAt exists ONLY in AWAITING_DELIVERY_PROOF — every exit from that state spends it,
--       so a stale hint can never sit beside a running statutory clock (the audit-F7 confusion);
--   (b) in AWAITING_DELIVERY_PROOF, NEITHER clock runs. Not the statutory one (nothing is proven
--       yet) and not the provisional one either (the provisional clock exists to trigger the chase,
--       and the chase asks for a registered send that has, by definition, already happened here).
--
-- Together with 0001's `deadline_requires_provable_send` this means the database now refuses both
-- halves of the C1/F3a failure: a clock without proof, and proof-waiting with a clock.

ALTER TABLE "RightsRequest" ADD COLUMN "proofDueAt" TIMESTAMP(3);

ALTER TABLE "RightsRequest"
  ADD CONSTRAINT "delivery_proof_carries_no_clock"
  CHECK (
    ("proofDueAt" IS NULL OR "state" = 'AWAITING_DELIVERY_PROOF')
    AND ("state" <> 'AWAITING_DELIVERY_PROOF' OR ("deadlineAt" IS NULL AND "provisionalDeadlineAt" IS NULL))
  );

-- The retrieval sweep queries (state, proofDueAt) exactly the way the deadline sweep queries
-- (state, deadlineAt) — 0000 indexed deadlineAt for that reason, so index this one too.
CREATE INDEX "RightsRequest_proofDueAt_idx" ON "RightsRequest"("proofDueAt");
