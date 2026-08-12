-- BYO-Datenkopie safety invariants (docs/10 §3.1 — "same class as IdentityPacket").
--
-- The one rule (CLAUDE.md): an uploaded document is ingested ONLY for the verified account holder.
-- The API layer enforces the parsed-name+DOB match gate; this trigger makes the binding structural at
-- the storage layer so no future code path can write a snapshot for someone else's identity, an
-- unverified identity, or another user's identity. Belt AND suspenders, like 0001's escalation trigger.

CREATE OR REPLACE FUNCTION assert_snapshot_identity_binding() RETURNS TRIGGER AS $$
DECLARE ident RECORD;
BEGIN
  SELECT "userId", "status" INTO ident FROM "Identity" WHERE "id" = NEW."identityId";
  IF ident IS NULL THEN
    RAISE EXCEPTION 'CreditFileSnapshot %: identity % does not exist', NEW."id", NEW."identityId";
  END IF;
  IF ident."userId" <> NEW."userId" THEN
    RAISE EXCEPTION 'CreditFileSnapshot %: identity % belongs to another user — a credit file about a third party is unrepresentable (docs/10 §3.1, CLAUDE.md one rule)', NEW."id", NEW."identityId";
  END IF;
  IF ident."status" <> 'VERIFIED' THEN
    RAISE EXCEPTION 'CreditFileSnapshot %: identity % is not VERIFIED — ingest requires a verified identity match', NEW."id", NEW."identityId";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "credit_file_snapshot_identity_binding"
  BEFORE INSERT OR UPDATE ON "CreditFileSnapshot"
  FOR EACH ROW EXECUTE FUNCTION assert_snapshot_identity_binding();

-- Findings are recomputable; entries are replaced per snapshot — no append-only trigger here. The
-- snapshot row itself, once written, must keep its identity binding: forbid changing the bound pair.
CREATE OR REPLACE FUNCTION reject_snapshot_rebinding() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."identityId" <> OLD."identityId" OR NEW."userId" <> OLD."userId" THEN
    RAISE EXCEPTION 'CreditFileSnapshot %: rebinding userId/identityId is forbidden', OLD."id";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "credit_file_snapshot_no_rebinding"
  BEFORE UPDATE ON "CreditFileSnapshot"
  FOR EACH ROW EXECUTE FUNCTION reject_snapshot_rebinding();
