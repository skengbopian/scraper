-- 0012_inbound_fk_action — the referential action on InboundDocument.assignedRequestId, stated.
--
-- Found by the drift gate, not by reading code: `0011_ops_queue` wrote the column as
--
--     "assignedRequestId" TEXT REFERENCES "RightsRequest"("id")
--
-- with no ON DELETE clause, so Postgres applied its default of NO ACTION, while `schema.prisma`
-- declared the relation OPTIONAL with no explicit action — which Prisma reads as SetNull. Two
-- different answers to the same question, and the database held the one nobody had read.
--
-- NO ACTION is the correct answer, and SetNull is not merely wrong here but IMPOSSIBLE. The
-- assignment is a three-column atomic group, and `inbound_assignment_is_attributed` (0011) enforces
-- that the three are null together or non-null together. A foreign-key action can only touch the
-- one column it references, so ON DELETE SET NULL produces exactly the half-state that CHECK
-- exists to forbid — verified against the live table: the constraint refuses it, so the delete
-- fails either way. SetNull would have bought nothing but a less legible error.
--
-- What this costs, stated plainly: deleting a RightsRequest FAILS while an inbound document still
-- points at it. That is the intended behaviour, not a limitation. Erasing a user must PURGE the raw
-- documents correlated to their cases (CLAUDE.md §4) — a document holds `storageRef`, `sha256` and
-- `senderRef`, so leaving one behind with a nulled pointer would convert an erasure into an orphaned
-- personal-data record. A loud failure forces the purge sweep to handle the document explicitly; a
-- silent null would have hidden the omission. `apps/api/test/ops.e2e.test.ts` deletes documents
-- before requests for this reason — that ordering is the correct sequence, not a workaround.
--
-- Applied from 0011's state this changes nothing in effect; it makes the choice explicit so the
-- schema and the database can no longer disagree about it.

ALTER TABLE "InboundDocument" DROP CONSTRAINT "InboundDocument_assignedRequestId_fkey";

ALTER TABLE "InboundDocument"
  ADD CONSTRAINT "InboundDocument_assignedRequestId_fkey"
  FOREIGN KEY ("assignedRequestId") REFERENCES "RightsRequest"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
