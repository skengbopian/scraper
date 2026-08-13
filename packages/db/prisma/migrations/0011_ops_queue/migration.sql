-- 0011_ops_queue — ADR-037 (port wave 5: the human-review surface wave 2c refused to fake).
--
-- Two things the ops surface needs before it can exist honestly: a stored notion of WHO is ops, and
-- a place for documents that arrive without knowing which request they answer.

-- ---------------------------------------------------------------------------------------------
-- 1. The ops role is a stored property of a principal, not a header.
-- ---------------------------------------------------------------------------------------------
-- The pre-audit line gated its ops routes on `x-ops-role: true` behind an env flag, and its own
-- comment records what that cost before the env flag was added: an unauthenticated caller sending a
-- header received every user's request ledger — a map of who is exercising rights against whom,
-- exactly the targeting signal CLAUDE.md's one rule exists to suppress — plus the ability to
-- permanently close a stranger's statutory request and file Art. 77 complaints in their name.
--
-- A claim a caller makes about itself is not authorisation for that. This is.
CREATE TYPE "UserRole" AS ENUM ('USER', 'HUMAN_OPS');

ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';

-- The default is the SAFE value, so every existing account and every future account created without
-- thinking about roles is an ordinary user. Granting ops is an explicit act.
CREATE INDEX "user_ops_role" ON "User" ("role") WHERE "role" = 'HUMAN_OPS';

-- ---------------------------------------------------------------------------------------------
-- 2. Inbound documents, correlated by a human (docs/04 Phase-0).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "InboundDocument" (
  "id"                TEXT PRIMARY KEY,
  "receivedAt"        TIMESTAMP(3) NOT NULL,
  "channel"           "ChannelMode" NOT NULL,
  "senderRef"         TEXT NOT NULL,
  "subjectLine"       TEXT,
  "storageRef"        TEXT NOT NULL,
  "sha256"            TEXT NOT NULL,
  "purgeRawAt"        TIMESTAMP(3) NOT NULL,
  "assignedRequestId" TEXT REFERENCES "RightsRequest"("id"),
  "assignedAt"        TIMESTAMP(3),
  "assignedByUserId"  TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "InboundDocument_assignedRequestId_idx" ON "InboundDocument" ("assignedRequestId");
CREATE INDEX "InboundDocument_receivedAt_idx" ON "InboundDocument" ("receivedAt");

-- An assignment with no human attached is an AUTOMATIC correlation, which Phase 0 does not do — and
-- which would let a hostile document's own content decide which request it closes. All three columns
-- move together or none do.
ALTER TABLE "InboundDocument"
  ADD CONSTRAINT "inbound_assignment_is_attributed"
  CHECK (
    ("assignedRequestId" IS NULL AND "assignedAt" IS NULL AND "assignedByUserId" IS NULL)
    OR ("assignedRequestId" IS NOT NULL AND "assignedAt" IS NOT NULL AND "assignedByUserId" IS NOT NULL)
  );

-- Re-pointing an assigned document at a different request rewrites which person a piece of evidence
-- concerns, after the fact. A correction is a new document row, exactly as a corrected RequestEvent
-- is a new event (0001).
CREATE OR REPLACE FUNCTION assert_inbound_assignment_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD."assignedRequestId" IS NOT NULL AND NEW."assignedRequestId" IS DISTINCT FROM OLD."assignedRequestId" THEN
    RAISE EXCEPTION 'inbound_assignment_freeze: document % is already correlated to request %; re-pointing it would change whose evidence this is',
      OLD."id", OLD."assignedRequestId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inbound_assignment_freeze"
  BEFORE UPDATE ON "InboundDocument"
  FOR EACH ROW EXECUTE FUNCTION assert_inbound_assignment_frozen();
