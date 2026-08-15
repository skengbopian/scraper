-- 0019 — the corpus activation ledger.
--
-- docs/14 §5.2: "Activation remains a deliberate act against the node's own DATABASE row, never the
-- YAML; on posture A the human taking responsibility is the user." That sentence describes a human
-- act, and the act left no trace. `Playbook.active` records the RESULT of a decision and nothing
-- about the decision: who made it, on what day, having been shown which letter, with the bound
-- template sealed or not. All of it was unrecoverable, on the one surface where "a human deliberately
-- authorised this" is the entire control.
--
-- It matters most in the case the product is built around. On posture A the person taking
-- responsibility is the data subject. If a controller or a supervisory authority later asks why a
-- particular letter went out in their name, the answer has to be "the operator activated this
-- playbook on this date, having read this exact letter, whose template carried this seal". A boolean
-- cannot say that.
--
-- NO FOREIGN KEY to "Playbook", deliberately — same reasoning as "AnomalyEvent" (0013): an audit row
-- must outlive whatever it describes, and a cascade that tidied away activation history would be
-- worse than an orphan. Slug and version are carried as opaque values.
--
-- The rendered letter is stored as a HASH, never as text. The preview renders against a DUMMY
-- subject, so the text is not personal data — but a table that accumulates letter bodies and is
-- purged by nothing is exactly the kind of second copy CLAUDE.md §4 exists to prevent, and the hash
-- answers the only question worth asking of it ("is this still the letter that was authorised?").

CREATE TYPE "CorpusActivationAction" AS ENUM ('ACTIVATED', 'DEACTIVATED');

CREATE TABLE "CorpusActivation" (
    "id" TEXT NOT NULL,
    "playbookSlug" TEXT NOT NULL,
    "playbookVersion" INTEGER NOT NULL,
    "action" "CorpusActivationAction" NOT NULL,
    "controllerSlug" TEXT NOT NULL,
    "requestType" "ActionType" NOT NULL,
    "templateName" TEXT NOT NULL,
    "templateStatus" TEXT NOT NULL,
    "templateSha256" TEXT NOT NULL,
    -- NULLABLE, and only for DEACTIVATED. The kill switch must never be blocked by a template that
    -- has gone missing or stopped rendering: turning a playbook OFF has to work in exactly the
    -- circumstances where turning it on would rightly fail.
    "letterSha256" TEXT,
    "actor" TEXT NOT NULL,
    "attestation" TEXT NOT NULL,
    "attestationSha256" TEXT NOT NULL,
    "posture" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorpusActivation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CorpusActivation_playbookSlug_createdAt_idx" ON "CorpusActivation"("playbookSlug", "createdAt");
CREATE INDEX "CorpusActivation_createdAt_idx" ON "CorpusActivation"("createdAt");

-- An ACTIVATED row must record the letter that was authorised. Only a DEACTIVATE may omit it.
ALTER TABLE "CorpusActivation" ADD CONSTRAINT "activation_records_the_letter"
  CHECK ("action" <> 'ACTIVATED' OR "letterSha256" IS NOT NULL);

-- Append-only, like the other ledgers (0001) — and TRUNCATE-guarded, because row-level triggers do
-- not fire on TRUNCATE (0013 learned that the hard way about the evidence chain).
CREATE TRIGGER "corpus_activation_append_only"
  BEFORE UPDATE OR DELETE ON "CorpusActivation"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER "corpus_activation_no_truncate"
  BEFORE TRUNCATE ON "CorpusActivation"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
