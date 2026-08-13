-- 0010_anchor_qualification — ADR-037 (port wave 5: ops, worker and dispatch, re-derived).
--
-- A hash chain proves INTEGRITY. Only a qualified eIDAS timestamp proves TIME. Until now the
-- EvidenceRecord row recorded a `qualifiedTimestampRef` and nothing else, so a reader could not tell
-- a QTSP anchor from a dev/sandbox one — the two are the same shape, and the column name asserts the
-- answer rather than storing it.
--
-- That mattered little while nothing keyed off it. Wave 5 makes a POSTAL_PROOF anchor one of the two
-- facts that authorise `provableSendConfirmed` and therefore the Art. 12(3) deadline, so "was this
-- anchor qualified?" became a question the audit trail must be able to answer months later, in front
-- of a DPA, from the row alone.

CREATE TYPE "AnchorKind" AS ENUM ('QUALIFIED', 'SIMULATED');

ALTER TABLE "EvidenceRecord" ADD COLUMN "anchorKind" "AnchorKind";

-- An anchor ref and its kind describe one fact; two columns that can disagree is the shape that
-- drifts. Either both are present or neither is.
ALTER TABLE "EvidenceRecord"
  ADD CONSTRAINT "evidence_anchor_kind_agrees"
  CHECK (("qualifiedTimestampRef" IS NULL) = ("anchorKind" IS NULL));

-- CLAUDE.md §6: a clock-critical artefact without an anchor cannot support any assertion about when
-- it existed. Recording one is not optional; recording an HONEST one is what the enum above is for.
-- Legacy rows predate the column and are exempted by the NULL check on qualifiedTimestampRef, which
-- 0005 does not require to be set — back-filling a qualification we never computed would be
-- inventing evidence.
ALTER TABLE "EvidenceRecord"
  ADD CONSTRAINT "clock_critical_evidence_anchor_is_honest"
  CHECK (
    "kind" NOT IN ('POSTAL_PROOF', 'OUTBOUND_COPY')
    OR "qualifiedTimestampRef" IS NULL
    OR "anchorKind" IS NOT NULL
  );
