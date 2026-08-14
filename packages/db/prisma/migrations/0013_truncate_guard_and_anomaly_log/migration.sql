-- 0013 — close the TRUNCATE hole in the append-only ledgers, and give anomalies a table (audit W9/M3).
--
-- 1. TRUNCATE. 0001's append-only triggers are row-level BEFORE UPDATE/DELETE — and row-level
--    triggers do not fire on TRUNCATE, so one statement could erase the entire audit trail and
--    evidence chain while every per-row protection stayed green. Statement-level BEFORE TRUNCATE
--    triggers close it. Tests that legitimately reset a THROWAWAY database disable the triggers
--    around their cleanup (the ops.e2e pattern) — an explicit, visible act, which is the point.
CREATE TRIGGER "request_event_no_truncate"
  BEFORE TRUNCATE ON "RequestEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER "evidence_record_no_truncate"
  BEFORE TRUNCATE ON "EvidenceRecord"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- 2. The anomaly review log (CLAUDE.md C1: "flag anomalous targeting for human review"). A
--    SUBJECT_MISMATCH — an upload about a DIFFERENT person than the verified account holder — is
--    the highest-signal abuse event this product can observe, and it previously went to a log
--    line nobody queues on. Deliberately NO foreign keys: an abuse-audit row must survive the
--    erasure of the account it records; it holds opaque ids and a bounded detail string, never
--    subject data.
CREATE TABLE "AnomalyEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,

    CONSTRAINT "AnomalyEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnomalyEvent_createdAt_idx" ON "AnomalyEvent"("createdAt");
CREATE INDEX "AnomalyEvent_userId_idx" ON "AnomalyEvent"("userId");
