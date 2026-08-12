# Decision reconciliation — the pre-audit line (A) against this line (B)

Every decision in A's `ARCHITECTURE-DECISIONS.md` gets exactly one bucket here, so the port
(ADR-030) cannot silently drop one. A is `~/Downloads/scraper`, committed at **`cc9dcb4`**; B is this
repo, tagged **`port-baseline-2026-08-11`** — everything after that tag is the port. A's log is
"Architecture decisions — Phase 0 scaffold", 1,646 lines, D1–D39 plus one unnumbered post-review
block and an unnumbered open-questions block. B's log runs ADR-001…**ADR-032** (ADR-030/031/032
landed in `4535f23` while this file was being written; ADR-032 names this file).

**Buckets.** `COVERED` — B already decided the same thing. `SUPERSEDED` — B's foundation makes A's
version obsolete or wrong. `ADOPT` — a real decision B does not have and should inherit with the
ported code. `N/A` — repo mechanics only.

**Waves** are ADR-030's: 1 zero-coupling assets (`packages/providers`, Prisma models, DPIA,
readiness) · 2 the web app · 3 auth + identity · 4 leverage + playbooks · 5 ops, worker, dispatch.

**Rows** are one per A decision. Sub-decisions (D19.x, D30.x) get their own row **only** where their
bucket differs from the parent's or the decision is safety-relevant and would otherwise vanish into a
one-line note; all others travel with their parent. Ordered by A ref, with the two unnumbered blocks
at their file positions (post-review after D12, open questions last).

**Safety-relevant** marks any A decision touching the clock, the subject binding, escalation,
idempotency or credential handling. Those must not be ported without re-checking ADR-012 (provable
clock), ADR-013 (cycle idempotency), ADR-019 (branded `RequestSubject`) and the invariants in
`schema/request-state-machine.md`. 31 of 52 rows are flagged.

Buckets are stated against B at commit **`4535f23`**. Wave-1 work is in flight while this is written
(an uncommitted `packages/core/src/crypto/envelope.ts` + migration `0004_envelope_crypto`), so a row
marked ADOPT may already be landing.

## Summary

| Bucket | Count |
|---|---|
| COVERED | 13 |
| SUPERSEDED | 4 |
| ADOPT | 35 |
| N/A | 0 |
| **Total rows** | **52** |

N/A is empty by finding, not by omission: even A's workspace-layout and docs-numbering entries carry
a rule B either needs (`packages/providers`) or has already settled (ADR-032).

ADOPT by wave — **1:** D4, D6, D7, D8, D19.12, D21, D23, D30.2 · **2:** D15, D16, D25, D35, D36 ·
**3:** D26, D28, D29 · **4:** D9, D19, D19.5, D19.10, D19.13, D19.17, D30.6, D32, D33, D39 ·
**5:** post-review block, D13, D27, D38 · **no wave (record now, or deferred module):** D17, D18,
D22, D31, open questions.

## Mapping

| A ref | A decision (verbatim title) | Bucket | B ADR | Note / what B must adopt | Safety-relevant? |
|---|---|---|---|---|---|
| D1 | Monorepo layout | COVERED | ADR-010, ADR-021 | Same layout; `pnpm-workspace.yaml` is B's authoritative list and ADR-021 already encodes A's "doc-sandbox reaches no database" rule as a test — `packages/providers` is scheduled as ADR-030 wave 1. | No |
| D2 | Workflow engine: BullMQ first, Temporal target | SUPERSEDED | ADR-031 | ADR-031 keeps A's interface + factory but flips the default to pg-boss: a 30-day Frist in a Redis-protocol store is durability-sensitive, and A's BullMQ engine is written against the 13-state model. | Yes (clock) |
| D3 | State machine: explicit transition table in core | SUPERSEDED | ADR-012, ADR-014, ADR-015, ADR-022 | A's 13×22 table has no `AWAITING_RESPONSE_PROVISIONAL` / `AWAITING_REGISTERED_RESEND` / `INCOMPLETE`, so an email send starts the statutory clock — the contradiction ADR-012 exists to fix. | Yes (clock) |
| D4 | Identity binding is enforced in the database, not just the app | ADOPT | extends ADR-019 (layer 4), ADR-020 | Record A's composite ownership FKs `(identityId, userId) → Identity(id, userId)` and the VERIFIED-identity freeze triggers (wave 1); A's deadlineAt-by-state CHECK is already replaced by ADR-020's provable-send CHECK. | Yes (subject binding) |
| D5 | Idempotency: partial unique index (user-approved decision 2) | SUPERSEDED | ADR-013 | A blocks a `(user, controller, requestType)` triple forever after COMPLIED/REFUSED with no cycle dimension and no self-exclusion — which blocks lawful re-access, the registered re-send and the provenance follow-up. | Yes (idempotency) |
| D6 | Credit-file segregation (user-approved decision 4) | ADOPT | none (nearest ADR-029) | B's `CreditFileSnapshot`/`CreditFileEntry` sit in the main schema with plaintext `raw` JSON — record the separate `credit` schema, role grants, separate bucket and per-record DEK (wave 1). | No — but a CLAUDE.md §4 launch gate |
| D7 | Encryption model | ADOPT | none | B had **no** encryption at rest at `4535f23` (only a `TODO(security)` on `totpSecret`); ADR-030 wave 1 names `packages/providers` as this gap and an envelope module is in flight — record the model, KEK-resolver interface and crypto-shred erasure as an ADR when it lands (wave 1). | No — but a CLAUDE.md §4 launch gate |
| D8 | The audit log carries no personal data | ADOPT | extends ADR-020 | ADR-020 already makes `RequestEvent` append-only; B must add A's zod payload contract, since append-only + plaintext means unpurgeable (wave 1). | No |
| D9 | Playbooks: YAML is source of truth, DB rows are immutable snapshots | ADOPT | extends ADR-018 | ADR-018 covers validation + version monotonicity via the `.shipped.json` lockfile; add the DB-side freeze trigger and one-active-version-per-(controller, requestType) when playbooks land in Postgres (wave 4). | No |
| D10 | Phase-0 channel policy | COVERED | §2 provisional defaults, ADR-017 | B's §2 already declares `web_form` not automated in Phase 0 → human queue, and ADR-017 schema-rejects a `registered` channel on `email`/`web_form`. | No |
| D11 | Evidence | COVERED | ADR-020, ADR-012 | `packages/core/src/evidence/chain.ts` already chains per request and requires a QTSP anchor on clock-critical kinds; A's extra `COMPLAINT_COPY` kind arrives with escalation sends (wave 5). | Yes (clock / evidence) |
| D12 | Escalation drafts | COVERED | ADR-008, ADR-019 | Both make `humanSend` the only inbound edge to `ESCALATED` with a `HUMAN_OPS` actor; B adds a DB trigger, A adds the QES mandate-scope check that ports with the draft builder. | Yes (escalation) |
| (post-D12) | Post-review fixes (adversarial review of the implemented scaffold) | ADOPT | extends ADR-013, ADR-018 | Record at-most-once wire sends (outbound evidence captured **before** the channel call), fail-closed empty/vacuous playbook clauses, and the ephemeral-Postgres integration harness (wave 5; the clause rule wave 4). | Yes (idempotency at dispatch) |
| D13 | M2 return path: inbound correlation (implemented) | ADOPT | extends ADR-007, ADR-021 | B has the sandbox but no return path — record the `SCR-<8 hex>` reference code, the InboundDocument queue (metadata only, document to object store) and human correlation in Phase 0 (wave 5). | Yes (subject binding — a mis-correlation files another person's letter in a user's record) |
| D14 | Employment-data pipelines & plain-language UX (product direction) | COVERED | ADR-026, ADR-024 | B reached the same screening/enrichment targets and the same Art. 14 transparency lead independently; A's `employment-check` bundle must be re-checked against ADR-013 before it ports (wave 4). | Yes (idempotency — the bundle skips occupied slots) |
| D15 | Consumer legibility layer ("what does this mean for me") | ADOPT | extends ADR-027 | B has Leichte Sprache + jargon explainers but not A's impact framing, the machine-enforced no-promised-outcome copy test, or "Schufa content is educational only, no score simulator" (wave 2). | No |
| D16 | Risk report + category selection ("automate protection as far as law allows") | ADOPT | none | Record "the one button compiles, it does not send" and `legalStrength: 'unconditional' \| 'individualized'` — the encoding that keeps CLAUDE.md §5's no-bulk-sweep rule structural rather than cultural (wave 2). | Yes (idempotency + subject binding — the DTO carries categories only) |
| D17 | Anubis: rejected, with reasons (researched 2026-08-04) | ADOPT | none | Record the rejection so it is not re-proposed; its Thoth reputation service is Canada-hosted and conflicts with ADR-006 (record-only, no wave). | No |
| D18 | Chrome extension: scope decision pending, safe path identified | ADOPT | none | Record the four rejected scopes and the surviving `activeTab` controller deep-link, plus the Chrome "Limited Use" credit-worthiness clause (record-only; module deferred, no wave). | Yes (subject binding — sending from the extension bypasses server-derived subjects) |
| D19 | The leverage ladder (schema + routing; IN REVIEW) | ADOPT | extends ADR-024, ADR-025, ADR-026 | B has the doctrine and cheapest-rung routing but none of the ledger — `LeverageAction` cost entries, the skip rule, suppression programmes, aliases (D19.1–.4, .6, .8, .9, .11, .14–.16, .18) all land in wave 4. | Yes (idempotency — a LEGAL rung consumes a cycle slot) |
| D19.5 | Two substitutions the router must never make. | ADOPT | partly ADR-025 | ADR-025 already forces access/provenance down the legal path; B must add `HIGH_HARM_CONTROLLER_TYPE` — bureaus, screeners, insurers, financial services and government are never routed to a cheap rung (wave 4). | Yes (instrument choice / escalation) |
| D19.7 | No third-party credentials, enforced over the schema text. | COVERED | ADR-024, ADR-026 | Same guardrail from both sides: B's recursive `assertNoCredential`, the source-scanning field test and the `findSelfServeRoutes` boundary check; A adds the `CHECK (NOT (requiresLogin AND autofillable))` DB half. | Yes (credential handling) |
| D19.10 | The cheap rungs are made PROVABLE, not accepted as weak | ADOPT | extends ADR-020 | Re-anchor `EvidenceRecord` to exactly one of `requestId` or `leverageActionId`, plus `RungExecutionMode` and the login-gated-never-server-submitted CHECK (wave 4, evidence half wave 5). | Yes (evidence / credential handling) |
| D19.12 | Generated migrations must be hand-reviewed. | ADOPT | none | Prisma proposes DROPping hand-written ownership FKs it did not create (A hit this twice — D19.12 and D30.8); carry the rule plus an integration assertion that they survive `migrate deploy` (wave 1). | Yes (subject binding — those FKs are the anti-stalker guarantee) |
| D19.13 | Contact-identifier autofill requires PROVEN CONTROL | ADOPT | none; collides with OQ-19 | The branded `VerifiedContactIdentifier` (alias / account email / challenged address) is one answer to the question B's OQ-19 still has open — do not port before OQ-19 and ADR-009's closed `subjectFields` enum are re-checked (wave 4). | Yes (subject binding) |
| D19.17 | Aliases: we own the primitive, and burn is one-way. | ADOPT | none | Scraper-run alias domains (a vendor would see the membership dossier CLAUDE.md forbids); unknown/burned aliases DROP rather than bounce, because a bounce is an oracle telling a sender they found a live person (wave 4). | Yes (subject binding / anti-harassment) |
| D20 | Authentication (C2), replacing the Phase-0 stub | COVERED | ADR-029, ADR-030 (wave 3) | Both land scrypt + RFC-vectored TOTP + hashed server-side sessions; ADR-030 wave 3 already elects A's step-up guard, recovery codes and MFA throttle over ADR-029's simpler build. | Yes (step-up gates release of credit data) |
| D21 | Launch readiness is machine-checked | ADOPT | extends §4 human checklist | `scripts/readiness.mjs` is already named in ADR-030 wave 1; B must also record the **two-track split** (legal pipeline vs Tier 0/1a ladder) that lets the cheap rungs ship before QTSP/postal exist. | Yes (decides what may launch without a provable-send channel) |
| D22 | Infrastructure: Scaleway (operator decision, 2026-08-05) | ADOPT | replaces §2 rows (Hosting, Object storage) | Promote hosting/KMS/mail from provisional to decided — Scaleway fr-par + Scaleway KMS + TEM — and carry the crypto-shred backup trap (a nightly snapshot resurrects erased DEKs) into `docs/11` (no wave). | No |
| D23 | The DPIA is scoped to what actually launches | ADOPT | none (the doc itself landed in wave 1) | `docs/11-dpia.md` is imported, but the scoping decision — DPIA covers the leverage ladder, the legal pipeline is a later amendment — is not in B's log (wave 1). | No |
| D24 | Brand system: purple + white, trowel mark (operator decision, 2026-08-06) | COVERED | ADR-027 (addendum), ADR-028 | Same accent `#6D28D9` and the same trowel/Spachtel mark; A's WCAG-checked pairs and the `--line-strong` token ride in with wave 2. | No |
| D25 | The guided Schufa surface, and decision cards instead of a multi-select | ADOPT | extends ADR-027 | One DecisionCard per category, with the unconditional (Art. 21(2), one click) vs individualised (Art. 15/17, explicit own-name tick) friction split — the UI half of CLAUDE.md §5 (wave 2). | Yes (no-sweep / idempotency) |
| D26 | apps/api gets boot-time invariant checks (security audit, 2026-08-06) | ADOPT | extends ADR-006, ADR-028 | B checks only `SCRAPER_DEV_FIXTURES` against `NODE_ENV`; adopt `assertStartupSafe` for api **and** worker, including `MODEL_REGION !== 'eu'` in *every* environment and no dev KEK ref (wave 3). | Yes (identity — a stub ident webhook is a subject-forgery endpoint) |
| D27 | The ops surface is authenticated (security audit, 2026-08-06) | ADOPT | none | B has no ops surface yet; when it ports, the queue exposes who is exercising rights against whom, so session auth + a fail-closed env-gated role are required and real RBAC stays a launch blocker (wave 5). | Yes (escalation + targeting signal) |
| D28 | Three authentication controls that were decorative | ADOPT | extends ADR-029 | The C1 lookup rate limiter keyed on the *authenticated* user — CLAUDE.md's "rate-limit and log all lookups, flag anomalous targeting" — has no equivalent in B at all; raw-body HMAC and the MFA throttle come with wave 3. | Yes (anomalous-targeting detection) |
| D29 | What the review pass caught in D26–D28 (2026-08-06) | ADOPT | corrects ADR-028 | **Live finding:** A proved an opt-in production check is not a check; B's `apps/api/src/common/dev-fixtures.ts` gates on `NODE_ENV === 'production'`, so unset / `staging` / `prod` still serve the fixture VERIFIED identity — invert to fail-safe (anything not `development`/`test` is production). | Yes (subject binding) |
| D30 | The pivot lands: Provenance (Art. 15(1)(g)) as the flagship module | COVERED | ADR-023 | Both make `ACCESS_ART15_SOURCE` the flagship and reserve Fraud Shield / File Fixer; B's ADR-029 has since started File Fixer. | No |
| D30 (Doc merge) | Doc merge (2026-08-06) | COVERED | ADR-032 | A's renumbering is A-internal; ADR-032 freezes B's `docs/00`–`10`, imports A's DPIA as `docs/11` and A's chapter 10 as `docs/12-consumer-ux.md`. | No |
| D30.2 | The plaintext/ciphertext line in ProvenanceEntry | ADOPT | none | Every verbatim controller string in one encrypted blob, every plaintext column a closed vocabulary or census slug — the rule that keeps hostile document text out of queries, indexes, logs and rollups (wave 1 model / wave 5 ingest). | No — but it is the anti-injection storage rule |
| D30.3 | The parser may not decide `isBroker` | COVERED | ADR-007, ADR-021 | Same rule: the sandbox output schema has no field for a decision or an action; A's counsel-approved `brokerWatchlist` matcher is the concrete form and ports with the module. | No |
| D30.4 | INV-3 EXTENDED: a follow-up is a proposal, in three layers | COVERED | ADR-008, ADR-019 | A restates B's one-inbound-edge rule at a new entry point; `confirmFollowUp` refusing `COMPLAINT_ART77` outright is the same invariant, re-asserted in code, DB and API. | Yes (escalation) |
| D30.6 | ERASURE at a bureau, reconciled with docs/07 | ADOPT | none | Record that Art. 17(1)(d) at a bureau is a **partial** erasure scoped to the broker-sourced categories, never the credit file, with its `TODO(counsel)` on the framing and Art. 12(5) risk (wave 4). | No |
| D31 | The product is free for now (operator decision, 2026-08-06) | ADOPT | retires the §2 "Billing \| Stripe" default | B's §2 still defaults billing to Stripe; record free-for-now plus A's no-paywall sweep test, which makes it a property rather than an accident (no wave). | No |
| D32 | The LEGAL tier can finally report a cost per outcome (OQ-F closed) | ADOPT | none | Book cost at `guardsPass`, at `provableSendConfirmed` (never at enqueue) and on human touches; the terminal-state→outcome map must be **re-derived** for B's 16 states — `INCOMPLETE` and `NO_PROVABLE_CLOCK` have no entry in A's table (wave 4). | Yes (clock — cost books at provable send; `NO_PROVABLE_CLOCK` is excluded from compliance stats) |
| D33 | Instrument eligibility becomes data, and the playbook set is generated | ADOPT | partly ADR-017, ADR-026 | B independently fixed the compliedIf-needle class (ADR-026) and forbids escalation on enrolments (ADR-017); the instrument matrix and the 45 generated playbooks are the ADOPT half, and ADR-030 wave 4 already says the validator failures are the review list. | Yes (escalation on enrolments) |
| D34 | Reconciling the parallel spec audit (2026-08-07) | SUPERSEDED | ADR-030 | Its conclusion — "`~/Downloads/scraper 3` should be treated as an archived spec bundle, not a workspace" — is exactly inverted by ADR-030; the two holes it found are B's ADR-018 (confidence floor) and ADR-017 (`registered` on an email primary), and its open C6 is closed by ADR-016. | Yes (clock — `registered: true` on email asserts a provable send that does not exist) |
| D35 | Walking the app as a new user: the landing page, and bilingual as a property | ADOPT | extends ADR-027, ADR-028 | Signed-out 401/403 is a normal landing state, not an error; plus the locale-coverage property test and "the census is a sending address book, not consumer advice" (unverified endpoints must never render as links) (wave 2). | No |
| D36 | The dashboard was reporting numbers that were not true | ADOPT | extends ADR-028 | Counters must add up to the rows beneath them and `READY` is not "sent"; under ADR-012 the split must additionally separate a provisional from a statutory clock, which A's model could not express (wave 2). | Yes (clock display) |
| D37 | Playbook drift is repaired by a version bump, never an update | COVERED | ADR-018 | Same rule reached from both sides — a shipped version is never mutated; A's `--bump` + seed-refuses-on-drift is the DB-seeded counterpart of B's `.shipped.json` lockfile and lands with wave 4. | No |
| D38 | A stuck send is repaired by REPLACEMENT, and the user is told | ADOPT | extends ADR-013 | Withdraw + create a replacement bound to the wording approved now, re-running every creation guard; under ADR-013 the replacement takes a fresh `cycleOrdinal` and must not inherit the original's clock (wave 5). | Yes (idempotency + clock) |
| D39 | A scoped template cannot be creatable outside its scope | ADOPT | extends ADR-018 | Refuse a scoped Art. 17(1)(d) erasure at **create**, not at dispatch, pointing the user at the Art. 15(1)(g) request whose answer makes it specific enough to send (wave 4). | No |
| (unnumbered) | Open questions (OQ-A … OQ-J) | ADOPT | into §3 open decisions | Carry OQ-A (mandate per request type), OQ-C (per-record credit DEK), OQ-E (ident-cost tiering), OQ-G (`EINMELDUNG_FRAUD` under the RDG) and OQ-I (three template-prose defects); OQ-B, OQ-D, OQ-F and OQ-J are already closed by ADR-013 + OQ-9, ADR-031, A's own D32 and ADR-016 (no wave). | Yes (mandate scope / escalation) |
