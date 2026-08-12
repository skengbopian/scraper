# Architecture decisions

The running decision log for Scraper. `docs/02-architecture.md` states the *defaults*; this file records
what was actually decided, when, by whom, and why — plus the decisions that are still **open**.

Referenced by `docs/02-architecture.md` and by `PROMPT.md`, `PROMPT-FEATURES.md`, `PROMPT-PIVOT.md`
(each ends with "update ARCHITECTURE-DECISIONS.md"). This file was missing until 2026-08-07
(audit item H7); it is created here seeded with the decisions already embedded in the docs, so later
sessions have somewhere to append rather than re-deciding silently.

## How to use this file

- **One entry per decision**, newest last within each section. Never edit a decided entry's substance —
  supersede it with a new entry that references it (`Supersedes: ADR-00x`). Same rule as playbook
  versions: the audit trail is the point.
- A decision that changes a `docs/02` default **must** land here, not only in the code.
- **Open decisions** live in §3 with a named owner. Anything in §3 is a thing a coding agent must NOT
  resolve on its own — the whole reason for the pre-code spec pass is that a silent resolution costs a
  state-machine rewrite and a Prisma migration later.

**Status legend:** `ACCEPTED` · `PROVISIONAL` (default in force, not yet stress-tested) ·
`OPEN` (needs a human decision) · `SUPERSEDED`.

---

## 1. Accepted decisions

### ADR-001 · TypeScript everywhere, Node 20+
**Status:** ACCEPTED · **Source:** `docs/02` stack table, `CLAUDE.md` engineering conventions.
One language across api / worker / doc-sandbox (and a later browser extension), so the safety-critical
types — identity, request state, playbook — are shared rather than re-declared per service.

### ADR-002 · NestJS for the API
**Status:** ACCEPTED · **Source:** `docs/02`.
Chosen specifically because guards/interceptors map cleanly onto the non-negotiable safety gates
(verified identity, mandate scope, idempotency). The gates are framework primitives, not middleware we
remember to call.

### ADR-003 · PostgreSQL + Prisma
**Status:** ACCEPTED · **Source:** `docs/02`, `docs/03`.
Relational census + tickets + hash-chained evidence; migrations are part of the audit trail.

### ADR-004 · Durable workflows behind an interface; Temporal preferred, BullMQ acceptable for M0/M1
**Status:** ACCEPTED · **Source:** `docs/02`, `CLAUDE.md` engineering conventions.
The statutory clock, retries, and human-in-the-loop steps are the workflow engine's job. The engine is
wrapped so the first milestone is not blocked on operating Temporal.

### ADR-005 · Every external provider is an interface with an env-driven implementation
**Status:** ACCEPTED · **Source:** `docs/02` "provider interfaces", `CLAUDE.md` §3.
`IdentityProvider`, `PostalProvider`, `InboundMail`, `DocSandbox`, `Timestamper`, `ModelProvider`,
`Mailer`. Two reasons, both load-bearing: dev must run with zero vendor accounts, and **EU residency
must be a config choice that defaults to EU** rather than a property of a hardcoded vendor.

### ADR-006 · EU-only data residency for storage *and* inference
**Status:** ACCEPTED · **Source:** `CLAUDE.md` §3, `docs/02` NFRs, `docs/06`.
No US-region model API ever sees personal data. Enforced by config + review; the `ModelProvider`
interface carries an explicit region.

### ADR-007 · The document parser is an isolated, structured-output-only service
**Status:** ACCEPTED · **Source:** `CLAUDE.md` §2, `docs/06`.
`services/doc-sandbox`: no tool/function calling, one document per context, zero cross-user context.
**Parser output may never trigger an irreversible action** without deterministic validation or a human
step. This is the anti-prompt-injection boundary — controller documents are hostile input.

### ADR-008 · Escalation is human-gated in the graph, not in the UI
**Status:** ACCEPTED · **Source:** `schema/request-state-machine.md` invariant 3, `CLAUDE.md` §5.
`ESCALATED` has exactly one inbound edge (`humanSend`). An auto-sent Art. 77 complaint must be
*unrepresentable*, not merely discouraged. Verified by reachability analysis in
`tools/spec-audit/statemachine.mjs`.

### ADR-009 · The request subject is derived from the verified Identity — there is no subject field
**Status:** ACCEPTED · **Source:** `CLAUDE.md` "the one rule that outranks all others", `docs/03`, `docs/06`.
`subjectFields` is a closed enum (`legalName | dateOfBirth | addresses`) naming *which* verified fields a
template needs. It is not, and must never become, a place to type *whose* data to request. This is what
keeps the product from being a person-finder.

### ADR-010 · pnpm workspaces are defined in `pnpm-workspace.yaml`
**Status:** ACCEPTED · **Decided:** 2026-08-07 (audit B1) · **Mechanical, no trade-off.**
`package.json` declared workspaces in the npm-style `"workspaces"` array, which pnpm ignores; every root
script is `pnpm -r`, so `pnpm -r build` resolved zero packages. Added `pnpm-workspace.yaml`
(`apps/*`, `services/*`, `packages/*`) as the authoritative list; the npm array is retained as
documentation with a `//workspaces` note. `tools/spec-audit` is intentionally **outside** the workspace —
it must run before the monorepo toolchain exists, and is wired into CI on its own.

### ADR-011 · Spec contradictions are resolved before code is scaffolded
**Status:** ACCEPTED · **Decided:** 2026-08-07 · **Source:** `AUDIT-2026-08-07.md` §5.
Every C-item in the audit is a disagreement between two normative documents. A coding agent resolves
those silently and arbitrarily. Resolved as spec edits they cost editing time; resolved after the
scaffold they cost a state-machine rewrite, a Prisma migration, and a re-review of anything already sent.

### ADR-012 · The statutory clock starts only on a provable send; email sets a provisional deadline
**Status:** ACCEPTED · **Decided:** 2026-08-07 by the product owner · **Closes:** OQ-1 / audit C1.
**Supersedes** state-machine invariant 2's previous wording ("email accepted + DKIM-aligned, **or** postal
proof"), which contradicted `CLAUDE.md` §6 and `docs/05` §6.

Chosen over (a) *registered post for anything that can escalate* — legally cleanest but makes all five
current playbooks €3–5 actions and kills `docs/06` H7's cost model — and (c) *email starts the real clock*,
which required deleting the "email is not proof" line from two normative files and resting the first
deadline assertion on a DKIM accept.

- An email/web-form send sets `provisionalDeadlineAt`; `deadlineAt` stays NULL. New state
  `AWAITING_RESPONSE_PROVISIONAL`.
- On silence, the **user** authorises a registered re-send (new state `AWAITING_REGISTERED_RESEND`).
  It starts a **fresh** Art. 12(3) month; escalation on silence therefore lands ~day 60.
- Declining closes the request as `NO_PROVABLE_CLOCK`, **excluded from the controller's compliance stats**.
- **Escalating on silence requires a provable send; escalating on a refusal or an incomplete answer does
  not** — the controller's own reply proves receipt. This distinction is what keeps the cheap path cheap.
- Enforced **structurally**, not by a runtime check: `deadlineExpired` exists only on `AWAITING_RESPONSE`,
  which is only reachable via `provableSendConfirmed`. `tools/spec-audit/statemachine.mjs` asserts the
  forbidden path is absent, so re-introducing it fails CI.

Three sub-decisions, all taken deliberately: fresh month (not a shortened Nachfrist), user-confirmed
(not automatic), and the guardrail rewritten in all three files rather than quietly contradicted.
`TODO(counsel)` on the fresh-month posture is recorded in `docs/05` §6.

### ADR-013 · Idempotency = unique key with a cycle dimension + a self-excluding guard
**Status:** ACCEPTED · **Decided:** 2026-08-07 · **Closes:** OQ-2 / audit C3.
Three documents specified this three incompatible ways. One spec now, in all three:
`idempotencyKey = sha256(userId | controllerId | requestType | cycleOrdinal)`, DB-unique; the guard reads
*no **other** non-terminal request for that triple* and runs on every entry to `READY`.

The self-exclusion and the cycle dimension are not conveniences — without them the flagship breaks: the
provenance follow-up to a broker already contacted in M1 is blocked, the resend path blocks on its own
open row, and lawful annual Art. 15 re-access becomes impossible. Art. 12(5) "excessive" is handled by a
separate re-exercise cooling guard, not by the constraint. Send-level idempotency (stopping a retried
dispatch putting two letters in the post) is a **different** concern, checked at `dispatch`, in the
Controller Gateway — conflating the two is what produced the contradiction.

### ADR-014 · `INCOMPLETE` is a first-class outcome, and `NEEDS_HUMAN` can escalate directly
**Status:** ACCEPTED · **Decided:** 2026-08-07 · **Closes:** OQ-3 / audit C4.
Both provenance playbooks set `escalation.onIncompleteSourceList: DRAFT_ART77` on the BayLDA precedent
that an incomplete Art. 15 answer is itself a violation — and it was unreachable. The reviewing human
could only mislabel it `REFUSED` or resend and wait another 30 days.

Added state `INCOMPLETE` (from `validated:incomplete` and `humanResolve:incomplete`) plus a direct
`NEEDS_HUMAN --humanResolve:escalate--> ESCALATION_DRAFTED`. The point is statistical integrity as much as
routing: `docs/02` calls the per-controller stats the moat and `docs/05` §7 publishes them as fact, so
"answered badly" and "refused" must not collapse into one number.

### ADR-015 · `BLOCKED_IDENTITY` resolves via `identityVerified`, re-running every guard
**Status:** ACCEPTED · **Decided:** 2026-08-07 · **Closes:** OQ-4 / audit C5.
It was described as "terminal until identity resolves" but had no outbound edge — a user who verified
after being blocked was stuck forever, violating the usability gate's "no dead ends, every screen states
the next action". Guards re-run on **every** entry to `READY`, not just the one from `DRAFT`.

### ADR-016 · Build the identity packet rather than delete the claim from the letters
**Status:** ACCEPTED · **Decided:** 2026-08-07 · **Closes:** OQ-5 / audit C6.
Three templates promised a redacted ID enclosure that nothing could produce. Added `IdentityPacket` to
`docs/03` as the `docs/08` Tier-2 pre-verified identity packet, with derivation, minimisation, retention
and segregation invariants.

The rendering half matters as much as the entity: the enclosure sentence is wrapped in
`{{#if identityProofEnclosed}}`, and that flag is **engine-derived, never playbook-declared** — set true
only when a packet was actually attached. A statically declarable flag would reproduce the original defect.
`audit.mjs` now fails a playbook that tries to declare it. Open `TODO(safety)` items on the acquisition
route and the redaction profile, and a `TODO(counsel)` on §20 PAuswG, are recorded in `docs/03`.

### ADR-017 · `registered` is per-channel; `ROBINSON`/`EINMELDUNG_FRAUD` are not rights requests
**Status:** ACCEPTED · **Decided:** 2026-08-07 · **Closes:** OQ-6 / audit H2, H3, H6.
- `channel.registered` becomes `{primary, fallback}` and is schema-rejected on `email`/`web_form`.
  Einwurf-Einschreiben by email is not a thing; `loeschung.generic-adresshaendler` had declared exactly
  that.
- Playbooks gain `kind: RIGHTS_REQUEST | ENROLMENT`. `deadlineDays` and `escalation` are required on the
  first and **forbidden** on the second: you cannot file an Art. 77 complaint that an industry opt-out
  list was slow. `ROBINSON` and `EINMELDUNG_FRAUD` materialise as `SuppressionEnrolment` /
  `FraudMarkerFiling`, reconciling the schema with the model `docs/08` already had.
- One `ActionType` vocabulary of six values (closing the 4-vs-6 drift), with `RightsRequest.requestType`
  constrained to the four statutory ones. Syncing the count without splitting statutory from
  non-statutory would have re-encoded H3 as a "fix".
- Late replies are routine and a DPA complaint often prompts one: added
  `ESCALATION_DRAFTED`/`ESCALATED`/`REFUSED`/`INCOMPLETE` → `RESPONSE_RECEIVED`.

### ADR-018 · The validation gate is schema **plus** lints, and CI enforces both
**Status:** ACCEPTED · **Decided:** 2026-08-07 · **Closes:** audit C2 and the version-monotonicity item.
The schema accepted 23 of 25 playbooks that must never be sendable. It now rejects all 28 cases.

Three decisions worth their own line, because each was a fork:

- **The gate is `validatePlaybook()`, not Ajv.** Three defect classes are structurally beyond JSON
  Schema — cross-field comparison (`compliedIf` and `refusedIf` matching the same string), filesystem
  facts (does the bound template render a variable `subjectFields` omits), and history (was a shipped
  version mutated). Testing only what the schema *can* express would have meant either three permanent
  "unfixable holes" or, worse, deleting the cases. They live in `tools/spec-audit/playbook-lint.mjs`
  and run in the same CI job.
- **`__PARAM__` is gated by an explicit `parameterised: true`, not banned.** A blanket ban would have
  invalidated `loeschung.generic-adresshaendler`, which is legitimately a stencil. A parameterised
  playbook may never be `active: true`.
- **Version monotonicity uses a checked-in lockfile** (`playbooks/.shipped.json`) hashing the *parsed*
  document, so a comment edit is not a semantic change. `--seal` refuses to run over an integrity
  failure — sealing a mutation would launder it into the audit trail.

**A harness that reports green while testing nothing is worse than no harness.** Two live instances were
found and fixed while doing this, and both were silent:
1. `negative.mjs` reported `0 holes` immediately after ADR-017, because `kind`/`active` became required
   and every case was then rejected for *that* reason rather than its own. A **base self-check** now
   asserts the unmutated fixture is valid before any case is trusted.
2. `version-check.mjs`'s first seal wrote `{"slug": {}}` for every playbook — `JSON.stringify`'s second
   argument is a property allowlist, not a key sort — so the check compared against empty objects and
   passed a real mutation. A malformed lockfile entry is now a failure, never a silent pass.

Both are the same bug shape as the ones the audit found in the spec, and neither would have shown up in
a summary line. Assume the next one exists.

### ADR-019 · Safety invariants are enforced at three layers, not one
**Status:** ACCEPTED · **Decided:** 2026-08-07 (scaffold).
Each of the two rules that must never break is enforced in the type system, in the state machine, AND
in the database — because each layer has a bypass the others don't cover: types are erased at a queue
or HTTP boundary, application guards are bypassed by a raw SQL update, and a DB constraint cannot see
intent.

**"A request subject that is not the verified identity is unrepresentable":**
1. *Types* — `RequestSubject` is branded with a module-private `unique symbol`; `deriveSubject()` is the
   only constructor and takes a whole `VerifiedIdentity`.
2. *Runtime* — the brand is a real symbol, so `isRequestSubject()` catches a look-alike that crossed a
   JSON boundary. `assertSubjectBelongsTo()` re-checks at the send boundary.
3. *API surface* — the create DTO has **no person-describing field**, and
   `packages/core/test/api-surface.test.ts` reads the actual source and fails if one appears. An HTTP
   DTO is a hole in the type system; that test is the patch.
4. *Database* — the subject columns are snapshots written by the service, never from request input.

**"An Art. 77 complaint is never auto-sent":**
1. *Graph* — `ESCALATED` has exactly one inbound edge; a test asserts the count, so adding a second
   fails rather than passing quietly.
2. *Actor* — that edge requires `HUMAN_OPS`; `SYSTEM` and `USER` are both rejected.
3. *API* — there is no route that sends a complaint. A user-facing "send my complaint" button would be
   a second inbound edge in everything but name.
4. *Database* — a deferred constraint trigger rejects any row entering `ESCALATED` without a matching
   `HUMAN_OPS` `humanSend` event.

### ADR-020 · The C1 clock is a DB CHECK constraint, not just application logic
**Status:** ACCEPTED · **Decided:** 2026-08-07.
`CHECK ("deadlineAt" IS NULL OR "provableSendConfirmedAt" IS NOT NULL)`. Application code already
enforces it, but a worker retry, a backfill script, or a future service is exactly how a statutory
deadline gets written from an email accept. The same reasoning covers the append-only triggers on
`RequestEvent` and `EvidenceRecord`: a mutable evidence chain proves nothing.

### ADR-021 · `services/doc-sandbox` has no database dependency, and that absence is tested
**Status:** ACCEPTED · **Decided:** 2026-08-07 · **Source:** docs/06 C4.
The isolation boundary is structural: the package cannot write request state because it cannot reach
the database. A test asserts the dependency is absent, so re-introducing it is a deliberate act with a
failing build attached rather than an ordinary-looking import.

The sandbox also drives confidence to **zero** on detecting injection-shaped text rather than redacting
and continuing — silently stripping the payload would let the attacker choose which parts of their
document we act on. Zero confidence routes to `NEEDS_HUMAN`.

### ADR-022 · A spec-sync test binds the code's transition table to the normative document
**Status:** ACCEPTED · **Decided:** 2026-08-07.
`packages/core/test/spec-sync.test.ts` parses `schema/request-state-machine.md` and asserts the code's
table matches in both directions — no undocumented edges, no unimplemented ones. The entire point of
resolving the contradictions before writing code (ADR-011) is lost the first time someone edits one
file and not the other. A drift is resolved by deciding which file is right and changing the other,
never by relaxing the test.

### ADR-023 · The flagship is `ACCESS_ART15_SOURCE`; docs/01 is superseded on scope
**Status:** ACCEPTED · **Decided:** 2026-08-07 · **Closes:** audit H4.
`docs/01` had no milestone for the flagship and still targeted Boniversum (merged into infoscore Sep
2025). Its M1 is now the provenance loop; the Werbewiderspruch loop becomes M2. `docs/09` governs scope
and ordering, `docs/01` governs the safety spine and delivery mechanics, and the header of `docs/01`
now says so rather than leaving a reader to discover the conflict.

**Deliberately not built this session**, per the user's scope: the web UI (PROMPT.md's layout has no
frontend package; "plain UI is fine" is permission, not a requirement, and the flagship path is
API-level), Fraud Shield, File Fixer, and the docs/09 usability gate — which remains launch-blocking.

### ADR-024 · The recruitment / enrichment-broker layer: census + Tier-1 SelfServeRoute + counsel-pending Art. 17/21(1) fallback
**Status:** ACCEPTED · **Decided:** 2026-08-09 · **Source:** `docs/10` §7 (research rounds), `docs/08`.
Implements `docs/10` §7.7 target #1 (B2B people-data / contact-enrichment brokers). Decisions taken,
each with a green build/audit behind it:

- **New classifications.** `ControllerType` gains `DATA_ENRICHMENT_BROKER | HR_TECH | AI_SCREENER |
  SCREENING`; `ControllerRole` gains `ENRICHMENT_BROKER | EMPLOYER_PROCESSOR` (migration
  `0002_recruitment_layer`).
- **The docs/08 Tier-1 `SelfServeRoute` entity is now BUILT** (it was specced in `docs/08` §2 and never
  implemented). Prisma model + `packages/core` `chooseCheapestRung()` (cheapest-rung-first: prefer the
  broker's own removal form over a legal request) + a seed of the six verified broker removal forms.
  The self-serve form is the **primary** removal rung; the legal letter is the escalation.
- **The instrument is Art. 17 + Art. 21(1), NOT Art. 21(2) marketing.** Verified 2026-08-09: this is
  sales/recruiting intelligence, not direct marketing (`isDirectMarketing: false`), so a Werbewiderspruch
  is the wrong instrument. New template `art17-datenhaendler.de` (erasure led by Art. 17(1)(d)
  unlawful-collection on the CNIL **KASPR €240k** reasoning + the Art. 21(1) objection bridge to
  17(1)(c)); a parameterised stencil + six concrete playbooks, **all `active: false`**.
- **US/UK brokers escalate on refusal only.** There is no German Einwurf-Einschreiben path to a
  provable silence clock, so the playbooks set `onDeadlineExpiry: NONE` (structurally, no silence
  escalation) and `onRefusal: DRAFT_ART77` — a refusal reply proves receipt (invariant 3b). Art. 77
  venue is the user's habitual-residence Land DPA (no one-stop-shop for a non-EU-established broker).
- **The anti-stalker rule is untouched.** No new subject field; the removal is about the verified
  account holder, identified by name+address, with the email-keyed path handled by the self-serve route
  the user completes themselves. The `SelfServeRoute` entity carries **no credential** (guardrail 1),
  asserted by a source-scanning test.

**Review-driven refinements (adversarial pass, 2026-08-09 — 4 HIGH / 8 MEDIUM / 8 LOW, triaged):**
- **Art. 21(1) is not a "general objection".** The template now states grounds arising from the
  particular situation (class-generic: scraped/compiled without involvement, re-sold as sales/recruiting
  intelligence), or the objection — and the Art. 17(1)(c) ground bridged off it — would be formally
  deficient. The unlawfulness now leads on the **Art. 14 transparency breach** (survives public-vs-
  restricted data); the KASPR "no legal basis" leg is secondary and hedged.
- **The fallback letter no longer discloses the user's home address** (data-minimisation + the anti-harm
  rule: never hand a scraping broker a fresh identifier). It identifies by name; the email-keyed match
  is done by the user on the self-serve form. `subjectFields` reduced to `[legalName]`. Whether a
  locality or an email identifier is re-introduced is OQ-19.
- **The no-credential guardrail was hardened**: `assertNoCredential` is now case-insensitive, recursive
  (nested objects/arrays), and the denylist is wider; the source-scan test catches non-`readonly` fields
  and asserts every field is `readonly`; the seed is deep-frozen.
- **`ControllerType` values were reordered after `OTHER`** so the declared order matches the migration's
  `ADD VALUE` append order (no `prisma migrate` drift).
- **Pre-existing migration gap recorded** (not introduced here): the migrations directory has no
  `0000_init` baseline, so the chain is not deployable from an empty DB (0001 ALTERs tables nothing
  creates). Added `migration_lock.toml`; generating the baseline is roadmap P0.
- **Runtime dead-end made an explicit tested contract**: these playbooks have no provable channel
  (`registeredResendChannel == null`), so the worker must route silence to `NO_PROVABLE_CLOCK` rather
  than force a registered re-send (which throws). Locked by
  `packages/core/test/enrichment-broker-clock.test.ts`; the open design question is OQ-21.

**Deliberately NOT built here:** ATS/AI-screener/screening playbooks (their routes differ — employer
request; Art. 22(3)/15(1)(h)); the Self-Exposure Scan module (OQ-18); email as a subject-identifier
(OQ-19). Activation of any playbook remains a counsel-gated act (§4, OQ-17).

### ADR-025 · Cheapest-rung-first wired into the request pipeline; applicant-retention rule engine built
**Status:** ACCEPTED · **Decided:** 2026-08-10 · **Source:** `docs/08` guardrail 5, PROMPT-FEATURES step 6,
`docs/10` §7.7 targets.

- **Cheapest-rung-first routing (docs/08 guardrail 5).** A pure `planRequestCreation()` in
  `packages/core/src/leverage/routing.ts` maps `requestType → DesiredOutcome` (ERASURE_ART17 → ERASURE,
  OBJECTION_ART21 → MARKETING_STOP; access/provenance → none) and, for removal outcomes, prefers a
  matching Tier-1 self-serve route over a legal request, returning a plan that ALWAYS carries a
  `LeverageAction` (the decision is recorded either way). `RequestsService.create()` consults it BEFORE
  the legal flow: `PREFER_SELF_SERVE` short-circuits — no `RightsRequest` is created, a Tier-1
  `LeverageAction` is recorded, and a guided-handoff response is returned; otherwise the existing legal
  path runs unchanged and records a `LEGAL` action after insert. The outcome is derived from
  `requestType`, never from the DTO (which still has no outcome field), so the anti-stalker DTO discipline
  is intact. The wiring is source-scan-guarded: `packages/core/test/api-surface.test.ts` asserts the
  self-serve check precedes `repo.insert` — a legal request cannot be generated when a self-serve
  route exists.
- **Applicant-retention rule engine (docs/10 §7.7 target #2).** A pure, deterministic, VERSIONED
  `assessApplicantRetention()` in `packages/core/src/retention/applicant.ts` encodes the AGG ~6-month
  rejected-applicant ceiling with the two lawful extensions (a pending AGG claim; talent-pool consent),
  using calendar-month arithmetic (`addMonthsUTC`, month-end clamped). It states a FACT (a deletion
  deadline has/has not passed) and never promises an outcome (docs/05 §3). The `now` is injected, never
  read from the clock. `APPLICANT_RETENTION_MONTHS` carries a `TODO(counsel)` on the exact number
  (partly OQ-13). The bureau Code-of-Conduct schedule (docs/10 §2.1 S2) is a SEPARATE rule set for later.
- **Both are pure-core + exhaustively tested** (core suite 153 tests). Neither is wired to a running app
  (no boot yet, P0); the retention engine has no ingestion path until P1.5.

**Review-driven refinements (adversarial pass, 2026-08-10 — 2 HIGH / 9 MEDIUM / 14 LOW, triaged):**
- **Objections no longer route to a marketing self-serve form.** `OBJECTION_ART21` collapsed Art. 21(1)
  (the enrichment-broker case) and Art. 21(2) into `MARKETING_STOP`, which would have mis-routed a 21(1)
  objection to a marketing unsubscribe and falsely recorded it as handled. `outcomeForRequestType` now
  returns null for objections (always the legal path) until the sub-right is distinguished (TODO(counsel)).
- **The create orchestration was extracted to a pure, Nest-free core function** (`createRequest`), so the
  short-circuit guarantee is now BEHAVIOURAL — `packages/core/test/create-request.test.ts` asserts
  `insert` is never called on the self-serve / no-route arms, with a fake repository (the previous guard
  was a text/ordering scan
  only; `@nestjs/common` is not installed, so the service itself can't be run). The service is a thin
  result-mapping adapter.
- **`NO_ROUTE` is a first-class plan.** A (controller, requestType) with no self-serve route AND no
  counsel-approved playbook no longer materialises an un-templated legal request; `hasLegalPlaybook` is
  resolved from a real lookup, not hardcoded true.
- **Correctness/type hardening:** `outcomeForRequestType` is an exhaustive typed switch (unknown type
  throws, never a silent demotion to legal); the identity→user binding is asserted on the short-circuit
  paths too; slug matching is case-normalised; the retention deadline is floored to a whole UTC day so
  `overdue` can't flip mid-day; `LeverageTier` is a literal union.
- **Legal precision (retention):** the record's controller is the EMPLOYER (ATS is an Art. 28 processor);
  `aggClaimPending` documented to trigger on a written §15(4) assertion, not only a filed suit; consent
  longevity and the post-claim clock flagged TODO(counsel); the finding is documented as advisory-only
  (never auto-dispatch). Idempotency of the routing LeverageAction and the assertNoCredential ingestion
  seam are recorded as adapter TODOs for when the DB layer is built.

### ADR-026 · Remaining §7.7 targets (#3–#5) + the engine boots on an in-memory adapter
**Status:** ACCEPTED · **Decided:** 2026-08-10 · **Source:** `docs/10` §7.7/§7.8.

- **#3 AI screeners** — `templates/art15h-22-3.de` (Art. 15(1)(h) explanation + Art. 22(3) human review;
  C-203/22 "principles actually applied") wired to `explanation.hirevue` / `explanation.retorio`
  (requestType `ACCESS_ART15`, `active:false`). The usable levers are GDPR, not the AI-Act high-risk
  duties (deferred to 2 Dec 2027). Controller = usually the employer; the vendor may be a (joint)
  controller — TODO(counsel) per case.
- **#4 unlawful screening** — `templates/art15-17-screening.de` (access + Art. 17(1)(d) erasure of data
  collected beyond the German employment-law limits: Art. 10/§§51,53 BZRG criminal, Art. 9 health, private
  social-media, Schufa-in-hiring) wired to `loeschung.hireright` (`active:false`). Case-by-case.
- **#5 source hardening (SAFE part only)** — `SOURCE_HARDENING_ROUTES` (LinkedIn/Xing privacy settings)
  as login-gated **guided** `SelfServeRoute`s. The dual-use self-exposure **scanner** (§7.5) is NOT built
  — arbitrary-subject profiling is exactly the anti-stalker line; it stays gated behind OQ-18.
- **The engine boots and runs end to end.** `InMemoryRequestsRepository` (a dev/demo adapter implementing
  `CreateRequestPort` + `load`/`applyTransition`) lets the whole create wiring run without a DB. Proven by
  `packages/core/test/engine-e2e.test.ts` and the runnable `tools/demo/run-engine.mjs` (self-serve
  routing, legal creation, idempotency block, NO_ROUTE for the counsel-gated flagship, retention). A
  NestJS boot (`apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/src/requests/requests.module.ts`)
  is the production HTTP path — it typechecks and binds the in-memory repo as a dev provider; it runs once
  `@nestjs/*` is installed and a Prisma/Postgres adapter replaces the dev repo. `@nestjs/*` is not
  installed and the Prisma schema is Postgres-only in this sandbox, so the in-memory engine is the
  executable proof, not the HTTP server. All shipped playbooks remain `active:false`; the dev boot's
  `activePlaybooks` is empty, so real controllers route to a guided handoff or NO_ROUTE — never an
  un-approved legal send.

**Review-driven refinements (adversarial pass, 2026-08-10 — 4 HIGH / 6 MEDIUM / 10 LOW, triaged):**
- **Validation needles now encode the OUTCOME, not the topic.** The AI-screener playbooks matched topic
  words ("Logik", "menschliche Überprüfung") that fire on a refusal as readily as an affirmation, so a
  refusal of Art. 22(3) review could read as COMPLIED; and `loeschung.hireright`'s `refusedIf` used
  "erforderlich"/"berechtigtes Interesse" — the vocabulary of a LAWFUL Art. 15 answer — so a compliant
  reply could read as REFUSED (and auto-draft an Art. 77 complaint). Both redesigned to lean on the
  sandbox's structured booleans for compliance and refusal-specific phrasing for refusal.
- **Wrong statutory citation fixed.** §72 BZRG → §§32/51/53 BZRG (Führungszeugnis contents /
  Verwertungsverbot / right to remain silent) in all six places (template ×2, playbook ×2, docs/10, this
  ADR).
- **OQ-22 recorded** — Art. 22(3) is a distinct right carried on `ACCESS_ART15`; a dedicated request type
  would fix the partial-compliance and idempotency-collision limitations.
- **Controller/processor** — both new templates now ask a processor to forward to the controller (a
  22(3)/erasure demand sent to a mere Art. 28 processor is lawfully deflected).
- **Engine hardening** — the in-memory adapter runs `assertNoCredential` at the `findSelfServeRoutes`
  boundary (safe-by-default for the future Prisma adapter); `applyTransition` throws on an unknown id and
  merges only known snapshot fields; the re-exercise cooling (OQ-9) and the "guard failures are not
  ledgered" choice are documented; a new e2e case proves a fresh cycle is allowed after a terminal
  predecessor. Retorio's activation TODO notes the BAYLDA + registered-post upgrade.

### ADR-027 · Alpha consumer UI in `apps/web`; hand-rolled for the alpha, Next.js + shadcn/Radix for production
**Status:** ACCEPTED · **Decided:** 2026-08-10 · **Source:** docs/09 usability gate; user request (alpha).

- **Built the alpha UI** as `apps/web/index.html` — a single, zero-dependency, self-contained page (also
  the published Artifact preview). It covers the core loop and the docs/09 gate: the Ampel health gauge,
  the Datenfluss map, one-decision request screens, and the Vorgang pipeline with a live statutory-Frist
  countdown; Leichte-Sprache toggle + one-tap jargon explainers; light/dark; keyboard + focus + ≥52px
  targets. `axe-core` in CI is the remaining gate item, deferred to the framework build.
- **It runs the real engine decision** — a JS port of `planRequestCreation` (cheapest-rung-first): a
  company resolves to `SELF_SERVE` (guided handoff), `LEGAL` (letter → tracked Vorgang), or `NONE`
  (not-yet-freischaltet — matching the counsel-gated reality). Data + routing are client-side today; the
  production path is `POST /requests` → the real `createRequest`, whose three outcomes map 1:1 to the
  three screens.
- **Stack decision:** hand-rolled design system for the alpha (runs with no build, reads as original not
  templated, CSP-safe for the Artifact); **migrate to Next.js + shadcn/ui (Radix) + Tailwind + lucide**
  for production (component-level accessibility + team velocity), reusing the alpha's tokens. Reference:
  Mozilla Monitor (`blurts-server`, MPL-2.0) is the closest open privacy-dashboard prior art. See
  `apps/web/README.md` for the full OSS survey.
- **Not built (out of the alpha's scope / other gates):** onboarding + real identity binding (docs/06
  safety gate, not a UI concern), auth, and any wiring that would send a real request (counsel gate).
  "klar." is a placeholder wordmark; the name is a branding-phase decision (report §13).
- **Addendum (2026-08-10, branding pass):** the alpha now carries the **Scraper** wordmark + trowel
  ("Spachtel") mark and a custom filled-glyph icon language ("Amts-Pictogramme") with inline-SVG spot
  illustrations — replacing the "klar." placeholder, the lucide-style line icons, and the monogram
  company tiles (no real third-party logos: copyright/impersonation). Palette moved to white + violet
  (`#6D28D9` / dark `#A78BFA`) per product owner direction; Ampel semantics unchanged. The
  production-migration stack above stands, minus lucide (the custom SVG set ports as-is). See
  `apps/web/README.md` §Design system; the report-§13 name user-test still applies.

### ADR-028 · The testing alpha: API boots with dev fixtures, simulated lifecycle, CC0 census import, live web wiring
**Status:** ACCEPTED · **Decided:** 2026-08-11 · **Source:** product-owner directive (working alpha for
effective testing); repo audit + OSS research (12 structured passes, journals in the session archive).

- **The API serves HTTP for the first time.** The blocker was environmental (broken pnpm/corepack,
  ADR-026) plus one missing dependency (`@nestjs/platform-express`). Both fixed. Default port **3900**
  (`:3000` belongs to the main Next.js Scraper web app on dev machines — discovered running during this
  work; its `apps/web` is the brand source of truth: accent `#6D28D9`, trowel mark, both now mirrored
  in this repo's alpha page).
- **Dev fixtures behind `SCRAPER_DEV_FIXTURES=1`** (`apps/api/src/common/dev-fixtures.ts`): ONE fixture
  identity (VERIFIED, Erika Mustermann) attached by middleware — no header/body can vary the subject, so
  the anti-stalker rule holds in dev exactly as in production; a live fixture mandate; DEMO playbook
  markers for az-direct/schufa/infoscore/regis24 (the in-memory seed's documented demo mechanism —
  playbooks/ stay `active:false`). The flag **refuses to activate under NODE_ENV=production**. With
  fixtures off, every guarded route fail-closes 403 and the simulate surface 404s (asserted by tests).
- **Simulated lifecycle instead of real sends** (`POST /requests/:id/simulate`, DevOnlyGuard): drives
  the REAL `apply()` — email dispatch ⇒ provisional clock only; simulated registered dispatch ⇒
  statutory clock (evidence id is an unmistakable `ev_sim_*` artefact); respond/expire/escalate.
  Invariant 1 gap closed: the registered-resend endpoint now re-runs the full guard set before
  re-entering READY. Prior art for the simulated-counterparty shape: Consumer Reports' OSIRAA
  (Apache-2.0), pattern only.
- **Census import (docs/10 §3 P0 item)**: `tools/census-import` ingests **datenanfragen/data (CC0-1.0,
  verified)** for the 15-controller census → generated, committed snapshot with per-record
  quality/sources retained. Import ≠ activation; hand-curated fields always win; counsel re-verifies
  channels before any real send. `GET /controllers` exposes census + honest `expectedOutcome` +
  community contact data; `GET /requests` lists the user's Vorgänge.
- **Web alpha wired live with graceful fallback**: `apps/web/index.html` probes `/health`; in live mode
  census/requests/pipeline come from the engine (provisional clock amber + "E-Mail ist kein
  Zustellnachweis", statutory clock accent-calm — the docs/10 P4 "visually distinct clocks"
  requirement), with a Demo drawer for the simulate actions; offline it remains the self-contained
  demo (the published Artifact keeps working).
- **Quality gates added**: `apps/api/test` (11 HTTP e2e incl. fail-closed posture),
  `services/doc-sandbox/test` (6 envelope tests: injection ⇒ confidence 0), `tools/a11y` (axe/WCAG-2.2-AA
  scan over every view × theme × Leichte Sprache — the docs/09 CI gate item; honest scope note: axe
  covers ~⅓ of WCAG), CI workflow `.github/workflows/alpha-ci.yml`. Core suite unchanged at 164 + additive in-memory-repo
  methods (`listByUser`; `hasControllerResponse` set on the `responseIngested` edge).
- **OSS adoption decisions from the research pass** (licenses verified against the actual repos):
  ADOPTED now — datenanfragen/data (CC0-1.0), Playwright (Apache-2.0) + axe-core/@axe-core/playwright
  (MPL-2.0, dev-only), OSIRAA *pattern*. DECIDED for next phase, not yet wired — **pg-boss** (MIT,
  Postgres-native) as the interim WorkflowEngine over BullMQ (Redis ≥7.4 licensing noise + delayed-job
  durability risk for statutory timers; use Valkey if BullMQ is ever chosen), Temporal (MIT) stays the
  production target (OQ-12 input); **pdfjs-dist** (Apache-2.0) for born-digital PDFs + **OCRmyPDF**
  (MPL-2.0, Ghostscript-free build only — Artifex AGPL trap documented) for the P1.5 ingest;
  **wKovacs64/hibp** (MIT) SDK behind `BreachMonitor` (HIBP data CC-BY-4.0, Art. 44 gate OQ-16;
  XposedOrNot MIT fallback); Mozilla Monitor's removal-status model (pattern only, MPL — their
  OneRep-vendor exit validates our guided-self-serve approach); DRP v1.0 (Apache-2.0) as a future
  status-projection vocabulary, never the internal machine. REJECTED — BADBOOL (CC BY-NC-SA:
  non-commercial), your-digital-rights/data-brokers (GPL-on-data + stale), pa11y-ci (LGPL + non-axe
  engine), unstructured (open-core/US-cloud pull), SimpleLogin/addy.io for the alpha (AGPL isolation +
  mail-ops weight — post-alpha, self-hosted unmodified only).
- **Not changed:** playbook activation (counsel), real providers (postal/QTSP/ident/model), Prisma
  adapter + auth (P0 items still open), the three-normative-files clock rule.

### ADR-029 · P0/P1.5 build-out: real auth, Prisma persistence, BYO-Datenkopie ingest, durable Frist timers
**Status:** ACCEPTED · **Decided:** 2026-08-11 · **Source:** product-owner directive ("work on: real auth + Prisma adapter, BYO-Datenkopie ingest, real providers, pg-boss timer runner, counsel sign-offs, manual accessibility passes").

- **Persistence is real:** `0000_init` baseline generated (drift-check clean), 0002 defanged to a
  documented no-op, `0003_filefixer_invariants` added — a credit-file snapshot bound to another
  user's identity, an unverified identity, or rebound later is **unrepresentable at the storage
  layer** (trigger-enforced, integration-tested). Chain deploys from empty; `PrismaRequestsRepository`
  implements the port with DB-closed idempotency (UNIQUE key) and transactional insert+audit-event.
- **Auth is real and separate from the identity gate:** email+password (scrypt) + TOTP (RFC-vectored),
  hashed bearer sessions; registration creates an UNVERIFIED identity; `/identity/verify-stub`
  (dev-only) stands in for the ident-provider callback. A caller presenting ANY bearer never falls
  back to the dev fixture (fail-closed, tested).
- **BYO-Datenkopie ingest (P1.5 flagship) ships:** hardened pdfjs extraction + Datenkopie parser v1
  inside the unchanged sandbox envelope; conservative name+DOB match gate (OQ-15) rejects-and-purges
  third-party documents (403, nothing stored — the one rule, HTTP-tested); CoC rules engine v1
  (versioned, effective-dated, `counselSignedOff:false` → every consumer renders findings as
  VORLÄUFIG per OQ-13) with the 12-criteria score table as data and the IV.3a score-negative warning
  guardrail; raw uploads never persisted (sha256 only). Web "Akte" view renders findings live.
- **Durable timers (OQ-12 interim decision):** WorkflowEngine on **pg-boss**; state-guarded
  `deadline-expiry` handler (stale/duplicate ⇒ no-op) — provisional expiry → chase step, statutory
  expiry → ESCALATION_DRAFTED; schedule→fire→transition integration-tested. Temporal remains the
  production target.
- **Real providers:** the Datenkopie parser is the delivered real provider. LetterXpress / InfoCert-
  Openapi QTSP / POSTIDENT SCR ship as typed, credential-gated adapters (CREDENTIALS_MISSING without
  env keys), NOT live-verified and wired into nothing — contracts are §4 human checklist items;
  OQ-11 still governs what `provableSendConfirmed` keys on.
- **Human-gated workstreams packaged, not performed:** `docs/counsel-review-packet.md` (every
  TODO(counsel), OQ-7..22, template/playbook sign-off matrices, path to first send) and
  `docs/manual-a11y-protocol.md` (~90-min SR/keyboard/one-handed/LS/zoom protocol with severity
  rubric; includes concrete watch items found in the markup).
- Suites after this ADR: core 189 · api 23 · doc-sandbox 11 · worker 1 (integration) · spec-audit
  46 checks / 28 negatives · axe gate 13 scans — all green.

### ADR-030 · Convergence: this line is canonical; the pre-audit line's features port onto it in waves
**Status:** ACCEPTED · **Decided:** 2026-08-11 by the product owner · **Supersedes:** the open
repo-unification question raised in `AUDIT-2026-08-11-ALPHA.md` §4.7.

Two divergent lines of the same product existed: **A** = `~/Downloads/scraper` (feature-rich,
pre-audit) and **B** = `~/Downloads/scraper 3` (this repo — the upgraded line). B is canonical.

The deciding evidence is structural, not preference. A's `RequestState` enum has **13** values; B's has
**16**. A lacks `AWAITING_RESPONSE_PROVISIONAL`, `AWAITING_REGISTERED_RESEND` and `INCOMPLETE`, so in A
an email send goes `SENT → AWAITING_RESPONSE` and **email starts the statutory clock** — the C1
contradiction this line resolved in ADR-012 — and A cannot represent an incomplete source list, which
is the flagship provenance play (ADR-014). A also has no `tools/spec-audit` harness and no ADR series.
A's feature mass (~36.4k LOC vs B's ~8.2k, 45 playbooks vs 15, 70 test files vs 22) is real and worth
having; it is simply built on a foundation that cannot express the corrected clock.

- **Direction:** A's capabilities move onto B's foundation. The reverse (transplanting B's core into A)
  was rejected: A's schema, worker, dsr and ops all encode the 13-state model, so "replace only the
  wall" is load-bearing everywhere.
- **Method — staged port ordered by clock-coupling**, lowest first, so each wave lands
  invariant-clean and B's suites + spec-audit stay green throughout:
  1. zero-coupling assets — `packages/providers` (envelope + subject/secret ciphers: the CLAUDE.md §4
     encryption B lacks entirely), A's extra Prisma models, `docs/11-dpia.md` (a launch gate B has no
     version of), `PRE-SEND-CHECKLIST.md` + `scripts/readiness.mjs`, docker-compose + dev scripts;
  2. the web app — 72 real sources behind a single `@/lib/api` seam, plus its glossary/locale/strings
     layer, retargeted at B's API and folded together with what B's alpha proved (Leichte Sprache,
     the Ampel gauge, two visually-distinct clocks, the Akte findings view);
  3. auth + identity — adopt A's step-up guard, recovery codes and MFA throttle over ADR-029's
     simpler build; refit to B's branded `RequestSubject`;
  4. leverage + playbooks — A's 45 playbooks run through B's validator; **the failures are the review
     list**, since many will fail precisely because they assume the old clock;
  5. ops, worker, dispatch — highest coupling, largely **re-derived** against B's transition table
     rather than copied.
- **Provenance:** A is committed at `cc9dcb4` (a 166-file rescue commit of a week of uncommitted
  work); B is tagged `port-baseline-2026-08-11`. Everything after that tag is the port.
- **Non-goal:** feature parity as a milestone. A capability arrives when its wave arrives; nothing is
  ported merely because it exists.
- **Wave detail lives in `docs/port-plan-from-A.md`** — the evidence-based ordering, the five hazards
  that make every domain a refit rather than a copy, the refuse list, and the two files that must be
  ported only with a fix. That plan supersedes the sketch in this ADR where they differ.
- **Expected side effect:** `tools/spec-audit` now emits `[WARN DOC-REF]` for every file these ADRs
  name that has not landed yet (`docs/11-dpia.md`, `PRE-SEND-CHECKLIST.md`, `engine/factory.ts`, …).
  Those warnings are the port's own checklist and clear themselves wave by wave — do **not** silence
  them by deleting the references. Failures (not warnings) remain the CI gate.

### ADR-031 · Workflow engine: keep A's interface+factory, default to pg-boss, Temporal stays the target
**Status:** ACCEPTED · **Decided:** 2026-08-11 · **Supersedes:** A's `D2 — Workflow engine: BullMQ
first, Temporal target` (its default only, not its structure) · **Closes:** OQ-12.

The merge collides two answers: A ships `WorkflowEngine` with an engine **factory** and both a
`bullmq-engine.ts` and a `temporal-engine.ts`; B ships a single pg-boss implementation (ADR-029)
proven against the corrected 16-state machine with a state-guarded handler and an integration test.

- **Adopt A's shape:** the interface plus `engine/factory.ts` selecting an adapter from config is
  better than B's single hard-wired engine, and it is what makes the Temporal migration a config
  change. Port it in wave 5 with the worker.
- **Change A's default to pg-boss** for the interim. Reasons, in order: a statutory 30+ day timer
  living in a Redis-protocol store is durability-sensitive (a misconfigured eviction policy silently
  drops a Frist — unacceptable for a legal deadline); pg-boss is transactional with the request ledger
  in the same Postgres; and B's implementation is already guarded and tested against the corrected
  state model, whereas A's BullMQ engine is written against the 13-state model and must be re-fitted
  in wave 5 regardless — so the incumbency argument for BullMQ is weaker than it looks.
- **Retain the BullMQ adapter** once the factory exists (it costs nothing to keep and preserves A's
  work); **Temporal remains the production target** (ADR-004, A's D2 — both lines already agree).
- **What would flip this:** if wave 5 turns out to port A's worker largely verbatim rather than
  re-deriving it, BullMQ's incumbency wins and pg-boss becomes the second adapter instead.

### ADR-032 · Docs numbering across the merge: B's 00–10 are frozen; A's docs import at fresh numbers
**Status:** ACCEPTED · **Decided:** 2026-08-11.

A and B both have a `docs/10`, with different content: A's chapter 10 is its consumer-UX research, B's is the utility roadmap. B's ADRs 023–029 and `CLAUDE.md` reference B's numbering repeatedly.

- **B's `docs/00`–`docs/10` keep their numbers.** Renumbering them would rewrite cross-references in
  the ADR log, CLAUDE.md and the spec-audit's doc-reference check for no gain.
- **A's `docs/11-dpia.md` imports as `docs/11-dpia.md`** — no collision, and it is a launch-gate
  artefact (docs/06 "DPIA completed and signed off") that B has no version of.
- **A's chapter 10 (consumer UX) imports as `docs/12-consumer-ux.md`**, with a one-line header note
  recording its original number so A's own cross-references stay traceable.
- **A's spec-audit chapter from 2026-08-07 is not imported.** This line already resolved that audit into
  spec edits (ADR-011); the file remains in A's history at `cc9dcb4`.
- Un-numbered docs in this line (`docs/counsel-review-packet.md`, `docs/manual-a11y-protocol.md`,
  `docs/decision-reconciliation-A.md`) stay un-numbered — they are working artefacts, not spec chapters.

### ADR-033 · A's decision log is reconciled row-by-row, not merged; 35 decisions are inherited with their code
**Status:** ACCEPTED · **Decided:** 2026-08-11 · **Companion file:** `docs/decision-reconciliation-A.md`.

The two lines kept decision logs in different formats — A's is prose (`## D1`…`## D39` plus an
unnumbered post-review block, 1,646 lines), B's is this numbered ADR series. Merging the prose into
this file would have produced a document where two contradictory clock decisions sit side by side.

- **Method:** every A decision gets exactly one bucket in the companion file — `COVERED` (B already
  decided the same), `SUPERSEDED` (B's foundation makes A's version wrong), `ADOPT` (a real decision
  B lacks and inherits with the ported code). Nothing is summarised away; the table is the audit
  trail that the port did not drop a decision.
- **Result:** 52 rows — **13 COVERED, 4 SUPERSEDED, 35 ADOPT**, and **31 flagged safety-relevant**.
  The four superseded are the ones the C1 audit already resolved here: A's D2 (workflow engine) by
  ADR-031, D3 (state machine) by ADR-012/014/015/022, D5 (idempotency) by ADR-013, and D34 — whose
  conclusion that this line is a disposable archive is exactly inverted by ADR-030.
- **The ADOPT set is assigned to port waves**, so a decision arrives with the code it governs rather
  than as an orphan note. Wave 1 inherits D4 (composite ownership FKs), D6 (credit-file segregation),
  **D7 (envelope crypto — landed in this commit)**, D8 (the audit log carries no personal data),
  D21 (readiness + its two-track split), D23 (DPIA scoping); waves 2–5 carry the rest.
- **Two findings acted on immediately, before any further porting:**
  1. **A live defect in this line, found by the reconciliation and fixed here.**
     `devFixturesEnabled()` refused only `NODE_ENV=production`, so an **unset**, `staging` or `prod`
     environment still served the fixture VERIFIED identity — a deny-list where the failure mode is
     silence. It is now an **allow-list** (`development | test`; anything else throws), which is the
     lesson A's D29 had already paid for. Documented run commands now carry `NODE_ENV=development`.
  2. **A hold placed on one ADOPT item.** A's `VerifiedContactIdentifier` (D19.13) is a partial
     answer to this line's still-open **OQ-19** (email as a subject identifier) and touches ADR-009's
     deliberately closed `subjectFields` enum. It must not port until OQ-19 is decided by counsel +
     safety — porting it would resolve an open safety question as a side effect of a merge.

---

## 2. Provisional defaults (in force, revisit before first real send)

| Area | Default | Source | Revisit when |
|---|---|---|---|
| Object storage | S3-compatible, EU region (Scaleway / Hetzner / OVH / AWS `eu-central-1`) | `docs/02` | vendor selected |
| Doc-parsing model | small EU-hosted model (Mistral EU / Azure OpenAI EU / self-host) | `docs/02` | benchmark on real bureau letters |
| Identity provider | IDnow / Nect / POSTIDENT-eID behind `IdentityProvider` | `docs/02`, `CLAUDE.md` §1 | contract signed |
| Postal provider | LetterXpress / Pingen behind `PostalProvider` | `docs/02` | registered-mail pricing confirmed |
| Timestamping | eIDAS QTSP behind `Timestamper` | `docs/02`, `CLAUDE.md` §6 | clock-critical path finalised (see OQ-1) |
| Billing | Stripe (EU entity) | `docs/02` | — |
| Hosting | Hetzner / Scaleway / OVH or AWS `eu-central-1` | `docs/02` | — |
| `web_form` channel | **not automated** in Phase 0 — drops to the human queue | `docs/04` step 4 | L2 browser agents (deferred) |

---

## 3. Open decisions (do NOT resolve these in code)

Each entry names the audit item it comes from. Nothing here has been decided yet.

| # | Question | Audit ref | Owner | Status |
|---|---|---|---|---|
| ~~OQ-1~~ | When does the statutory clock start? | C1 | product owner | **CLOSED** → ADR-012 |
| ~~OQ-2~~ | Which idempotency spec governs? | C3 | engineering | **CLOSED** → ADR-013 |
| ~~OQ-3~~ | How does an incomplete source list reach escalation? | C4 | engineering | **CLOSED** → ADR-014 |
| ~~OQ-4~~ | `BLOCKED_IDENTITY` outbound edge | C5 | engineering | **CLOSED** → ADR-015 |
| ~~OQ-5~~ | Does the redacted ID copy exist? | C6 | safety + counsel | **CLOSED** → ADR-016 (build it) |
| ~~OQ-6~~ | `ROBINSON`/`EINMELDUNG_FRAUD` forced to declare a statutory clock | H3 | engineering | **CLOSED** → ADR-017 |
| OQ-7 | Whether the templates ship as sendable letters (sender/recipient block, place-and-date line, signature, `{{today}}` format) or whether the postal renderer supplies that envelope. | H5 | engineering + counsel | **OPEN** |
| OQ-8 | `provenance.infoscore` cites "infoscore's own Art. 14 notice (V7, Aug 2026)" as established fact and keys an Art. 77 trigger to it, with no `TODO(counsel)`. A legal escalation keyed to an unverified notice version is a liability. | Med | **counsel** | **OPEN** — blocks enabling that playbook |
| OQ-9 | `minReExerciseDays` per request type — the Art. 12(5) "excessive" cooling period between two lawful cycles of the same request. Introduced by ADR-013; a number is needed before the second cycle is ever reachable in production. | C3 | **counsel** | **OPEN** |
| OQ-10 | The `IdentityPacket` acquisition route (ident-provider document vs user upload) and the redaction profile, incl. §20 PAuswG. Introduced by ADR-016. | C6 | **safety + counsel** | **OPEN** |
| OQ-17 | Enrichment-broker instrument + template: confirm the Art. 17 + Art. 21(1) framing (not 21(2)) and whether to cite the CNIL KASPR decision and the Art. 14 notification breach explicitly. Draft `art17-datenhaendler.de` exists; sign-off pending. Introduced by ADR-024. | docs/10 §7 | **counsel** | **OPEN** — blocks enabling the 7 `loeschung.*datenhaendler`/broker playbooks |
| OQ-18 | Whether the Self-Exposure Scan module (`docs/10` §7.5 — "what would an AI background-checker find on you") is in scope at all given its dual-use profile, and if so its exact self-binding contract (input derived from the verified Identity; reject arbitrary-subject OSINT). | docs/10 §7.5 | **safety + product** | **OPEN** |
| OQ-19 | Email as a subject-identifier for email-keyed brokers: does the subject block gain an email field derived from the verified `User`/`Identity`, or does identification stay name+address with the email-keyed path handled only by the self-serve route? Touches the closed `subjectFields` enum (ADR-009). | docs/10 §7.3 | **safety + counsel** | **OPEN** |
| OQ-20 | Art. 77 venue for a non-EU-established broker = the user's habitual-residence Land DPA (Art. 77(1)); confirm, and resolve the one-stop-shop nuance for brokers WITH an EU establishment (Cognism GmbH/DE, KASPR SAS/FR). | docs/10 §7.4 | **counsel** | **OPEN** |
| OQ-21 | Clock/escalation model for controllers with no German postal channel (US/UK brokers): `onDeadlineExpiry: NONE` means no silence-escalation. Is that the intended posture, or should a standalone Art. 14/unlawful-processing complaint path (not tied to a sent letter's receipt) be modeled? | ADR-024 | **engineering + counsel** | **OPEN** |
| OQ-22 | Art. 22(3) (human intervention / contest an automated decision) is a DISTINCT right currently carried on `requestType: ACCESS_ART15` (the AI-screener explanation playbooks). Two consequences: partial compliance (15(1)(h) explanation given, 22(3) human review refused) can read as full via `compliedIf: anyOf`, and the idempotency key collides with a plain Art. 15 Datenkopie so both cannot be in flight at one controller. A dedicated `requestType` (e.g. `HUMAN_REVIEW_ART22`) in the schema + state machine + data model would fix both — a statutory-type addition, so counsel + engineering, not an in-code call. | ADR-026 | **counsel + engineering** | **OPEN** — blocks enabling `explanation.*` |

The six closed items (OQ-1..6) were resolved as spec edits before any code existed, per ADR-011. OQ-9,
OQ-10 and OQ-17..22 are new, and exist *because* the corresponding decisions were taken — all are
counsel/safety/engineering questions that block a real send, not the scaffold.

---

## 4. Before the first real letter is sent (human checklist)

Not architecture, but it belongs next to it — none of this is something an agent can complete.

- [ ] German data-protection **and RDG** counsel sign-off on every file in `templates/` (`docs/05`).
- [ ] Counsel verification of every `TODO(counsel)` recipient address / endpoint in `playbooks/` and
      `docs/07` against the controller's live Datenschutz page.
- [ ] Bank-ident / eID provider contract signed and the `IdentityProvider` stub replaced.
- [ ] Hybrid-mail account with **Einwurf-Einschreiben** capability (`PostalProvider`).
- [ ] eIDAS **QTSP** account for qualified timestamps (`Timestamper`).
- [ ] EU-region hosting and EU-region model inference confirmed, in writing, for personal data.
- [ ] **DPIA** completed and signed off (`docs/06`).
- [ ] OQ-1 and OQ-5 resolved — a letter that asserts an enclosure it does not contain, or a deadline that
      was never legally established, is worse than no letter.
- [ ] Every playbook flipped to `active: true` deliberately, one at a time, with the counsel sign-off
      recorded against its `version`.
