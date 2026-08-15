# Pre-send checklist — humans only

**No real rights request leaves this system until every box below is checked.**

> **Rewritten 2026-08-15 against the tree.** The imported version (port wave 1, from the pre-audit
> line at `cc9dcb4`) had decayed into a document that could be worked through completely while
> verifying nothing. It directed a reviewer to a `Controller.active` column that does not exist, to a
> "migration 18f" trigger that was never written, and to a `pnpm dev:activate` script that has no
> definition anywhere. It counted "45 generated playbooks" where the corpus holds 19. It named seven
> environment variables no code has ever read. And it asked a reviewer to confirm that
> "provable-send confirmation (DKIM-aligned acceptance)" was implemented — which is the exact claim
> `CLAUDE.md` §6 exists to forbid.
>
> **The rule this file now keeps: every mechanical claim names its verifier — a `pnpm readiness` row
> or a test by path.** If a box cannot name one, it belongs under §5 (what nothing checks) or it is a
> human judgement and says so. A checklist item nobody can falsify is worse than a missing one,
> because it is ticked.

## 0. Run these two first

```bash
pnpm readiness
```

```bash
cd tools/spec-audit && npm run all
```

`readiness` (`scripts/readiness.mjs`) reports four tracks. `✗` is a failure and exits non-zero; `☐`
is a humans-only box no script can tick; `•` is a warning that becomes `✗` in DEPLOY posture
(`NODE_ENV` anything but `development`/`test`). It is not advisory — CI runs it in `--ci` posture, so
every repo-answerable row below is already green on any commit that landed.

Neither command can tell you whether a letter is legally right, whether an address is current, or
whether a vendor contract is signed. That is what the rest of this file is for.

---

## 1. Legal — counsel sign-off required

Work these from `docs/counsel-review-packet.md`, which carries the per-row detail and the sign-off
columns. This list is the gate; that file is the workspace.

- [ ] **Every template in `templates/` approved, and the approval recorded.** Sign-off is
      `status: "SIGNED"` with a named counsel and a date in `templates/.signoff.json`, plus deleting
      the `DRAFT` marker from the file's header — both edits in one commit.
      *Verified by:* readiness LEGAL `templates counsel-signed`; `tools/spec-audit/signoff-check.mjs`;
      `packages/core/test/signoff.test.ts`. The seal hashes the letter's prose after the doc-comment
      header is stripped, so an edit after signature fails the build rather than shipping quietly.
      Today: **0 of 8 signed.**
- [ ] **Art. 77 complaint prose written by counsel.** This product does not render the complaint at
      all: `apps/api/src/ops/ops.service.ts` records the send as chained evidence and leaves the
      document to counsel (`TODO(counsel)` in that file). A request can therefore reach
      `ESCALATION_DRAFTED` with no text to send.
      *Verified by:* nothing mechanical — the absence is the point, and it is a human's to close.
- [ ] **RDG structure decided** per deployment posture: posture A is self-representation (OQ-29),
      posture B is where Rechtsdienstleistung begins. `docs/05` §2 is written for operated nodes.
      *Verified by:* readiness COUNSEL row (☐, never auto-passable).
- [ ] **Mandate scope decided** — which request types one signed mandate may carry. `Mandate.scope`
      is a list of request types and `packages/core/src/state-machine/guards.ts` refuses a request no
      live mandate covers, re-checked at dispatch as well as at creation.
      *Verified by:* `packages/core/test/create-request.test.ts`; `apps/api/test/ops.e2e.test.ts`
      ("an ops re-send is blocked when the mandate was revoked mid-flight").
- [ ] **Every controller endpoint re-verified against that controller's CURRENT Datenschutz page.**
      Every census row ships a `TODO(counsel)`. *Verified by:* readiness COUNSEL row; the per-row
      "Counsel must verify" column in the counsel packet §4.
- [ ] **Art. 77 venue confirmed per controller.** Each playbook's declared venue is generated into
      counsel packet §4 — confirm the declaration, do not re-derive it from prose.
      *Verified by:* readiness COUNSEL row; `tools/spec-audit/counsel-packet.mjs` keeps the table
      honest about what is declared, never about whether it is right.
- [ ] **Marketing and product copy carries no outcome promise** (`docs/05` §3, UWG).
      *Verified by:* `packages/i18n` copy tests (forbidden-phrase and the two-clock check — a
      provisional deadline may not borrow statutory words).
- [ ] **Art. 12(5) re-exercise cooling decided** (`minReExerciseDays` per request type, OQ-9). The
      guard takes it as a parameter so the number never lives in code.
      *Verified by:* `mayOpenNewCycle` in `packages/core/src/state-machine/guards.ts` carries the
      `TODO(counsel)`; `packages/core/test/create-request.test.ts` exercises the cooling refusal.

### 1a. Provenance module — additional counsel gates

- [ ] **`templates/art15g-herkunft.de.md` approved**, including its verbatim citation of SCHUFA's
      Art. 14 §2.3 "Datenlieferanten" clause via the `isSchufa` flag — confirm against the CURRENT
      notice. *Verified by:* the seal above; the citation itself is human.
- [ ] **Art. 15(1)(g) intake route verified per bureau**, then `Controller.art15SourceRouteVerified`
      set. **Read §5.1 before ticking this** — the column exists and nothing enforces it.
- [ ] **Art. 17(1)(d) partial-erasure framing at a bureau confirmed** (OQ-23), including the
      Art. 12(5) "excessive" risk when chained after an access request. Blocks all three
      `loeschung-herkunft.*` playbooks. *Verified by:* counsel packet §8; `tools/spec-audit/oq-check.mjs` guarantees
      OQ-23 means exactly this one question.
- [ ] **Broker watchlists in `playbooks/provenance.*.yaml` reviewed.** The watchlist is the only
      thing that can mark a source as a broker, so an entry added there directly causes erasure
      demands to be drafted. *Verified by:* `packages/core/test/flagship-provenance.test.ts`
      (the chain is derived from stored evidence, never from a caller's assertion).
- [ ] **`infoscore` ships `namesSourcesInArt14: true`** — confirm their current Art. 14 notice still
      names AZ Direct before a denial is recorded as `CONTRADICTS_ART14` in any complaint (OQ-8).
- [ ] **The Art. 15 templates assert an enclosed redacted ID copy and nothing can attach one**
      (OQ-10). Fix the capability or the wording before either instrument is activated.
      *Verified by:* nothing — there is no attachment path in the send code to test.

---

## 2. Identity, mandate, evidence — safety

- [ ] **Ident provider contract signed, real adapter implemented, stub disabled.**
      *Verified by:* readiness IDENTITY `SCRAPER_IDENTITY names a real adapter` (✗ in DEPLOY posture
      while unset or `stub`); the worker refuses to boot on a stub seam
      (`apps/worker/src/config.ts`).
- [ ] **Mandate flow live end-to-end** — a `Mandate` row bound to the verified identity. Posture A
      uses a recorded in-app confirmation rather than QES (owner decision D7, `docs/14`).
- [ ] **QTSP account live and the anchor genuinely QUALIFIED.**
      *Verified by:* readiness IDENTITY `SCRAPER_TIMESTAMPER names a real adapter`;
      `apps/api/test/ops.e2e.test.ts` proves a SIMULATED anchor starts **no** clock and the request
      does not move, and that a QUALIFIED one dates the month from DELIVERY.
- [ ] **Postal provider live incl. Einwurf-Einschreiben, with the Auslieferungsbeleg retrieval
      working** (OQ-11). *Verified by:* readiness IDENTITY `SCRAPER_POSTAL` + the LetterXpress-mode
      row (live mode without the receipt fetch is a ☐, not a pass);
      `apps/worker/test/dispatch-flow.test.ts` ("a lodged registered send parks in
      AWAITING_DELIVERY_PROOF with NO clock").
- [ ] **Send domain SPF/DKIM/DMARC configured and verified.**
      **This does not make a send provable and must never be recorded as if it did.** A DKIM-aligned
      accept proves the message left our infrastructure with an intact signature; Art. 12(3) runs
      from the controller's *receipt*. Alignment decides `ACCEPTED_NON_PROVABLE` vs `FAILED` — never
      the clock. *Verified by:* `apps/worker/src/channels/email.ts`;
      `apps/worker/test/dispatch-hazards.test.ts`; the SQL `deadline_requires_provable_send` and
      `clock_critical_evidence_anchor_is_honest` constraints, exercised by
      `apps/api/test/db-invariants.test.ts`.
- [ ] **KMS-backed KEK resolver deployed**, dev scrypt resolver disabled, rotation documented.
      *Verified by:* readiness IDENTITY `SCRAPER_KEK_MODE=env`; `assertApiStartupSafe` refuses a
      non-dev boot otherwise (`apps/api/test/startup-safety.test.ts`);
      `packages/core/test/envelope.test.ts`. The resolver is still env-backed, not KMS —
      `TODO(safety)` in `packages/core/src/crypto/envelope.ts`.
- [ ] **MFA at login and step-up on dossier/credit reads.**
      *Verified by:* `apps/api/test/auth-policy.e2e.test.ts` (19 tests, including that the session
      token ROTATES at MFA and at step-up, and that password and second-factor lockout budgets are
      separate). These run in CI only because the database service exists — see §0.
- [ ] **Rate limits and the anomaly review queue live**, and someone holds `HUMAN_OPS`.
      *Verified by:* `apps/api/test/ops.e2e.test.ts`; grant the role with
      `DATABASE_URL=… pnpm --filter @scraper/api grant-ops <email>` (`apps/api/test/grant-ops.test.ts`).
      There is no HTTP route to the role, deliberately.

---

## 3. Compliance and infrastructure

- [ ] **DPIA signed, DPO question answered.** `docs/11` binds every posture-B/C operator; whether
      posture A is regulated processing at all is OQ-28. *Verified by:* readiness COUNSEL row.
- [ ] **EU-only hosting for database, object store and ALL model inference.**
      *Verified by:* readiness COMPLIANCE `MODEL_REGION=eu` — checked in **every** environment, not
      just deployments, because it is a residency control and not a preference; the worker refuses to
      start otherwise.
- [ ] **Persistence and durable time configured.** `SCRAPER_REPOSITORY=prisma`,
      `SCRAPER_SCHEDULER=pgboss`, `DATABASE_URL` set. Without the first the node forgets every
      request and evidence record on restart; without the second no Frist timer is ever armed and no
      deadline fires. *Verified by:* the three readiness COMPLIANCE rows;
      `apps/api/test/startup-safety.test.ts` asserts readiness and the boot gate agree.
- [ ] **Object store holding evidence, verified by a round trip.** *Verified by:* readiness
      COMPLIANCE `EU object store configured` — **which today only checks the env string is
      non-empty.** See §5.2.
- [ ] **Retention jobs verified:** raw response documents purge after the normalisation window;
      evidence and normalised records survive. *Verified by:* `apps/worker/test/purge.test.ts`; the
      SQL `raw_document_requires_purge_date` constraint (`apps/api/test/db-invariants.test.ts`).
- [ ] **Our own Art. 15 export and Art. 17 crypto-shred tested.**
      *Verified by:* `apps/api/test/auth-policy.e2e.test.ts` ("erases the dossier, keeps the ledger,
      and leaves the EVIDENCE key alive").
- [ ] **Backups encrypted, EU-region, restore tested, KEK held on separate media** (owner decision
      D8: 7-day window). *Verified by:* nothing mechanical — this is operator procedure.
- [ ] **`.env.example` describes this deployment.** *Verified by:* readiness COMPLIANCE
      `env surface` — every variable the code reads is documented and nothing is documented that
      nothing reads.

---

## 4. Final gate

- [ ] **A dry run against a controlled test controller** produced: correct rendering from a verified
      identity, a chained evidence record with a real QTSP anchor, the correct deadline computed from
      DELIVERY, and a **drafted, not sent**, Art. 77 complaint on simulated silence.
      *Verified by:* the state machine forbids the alternative — `ESCALATED` has exactly one inbound
      edge and it requires `HUMAN_OPS`, and no escalation may rest on a provisional clock
      (`packages/core/test/state-machine.test.ts`, `tools/spec-audit/statemachine.mjs` anti-journeys).
- [ ] **`pnpm readiness` in DEPLOY posture reports no `✗`.**
- [ ] **The operator flips exactly one playbook to `active: true`** as a deliberate, recorded act
      against the node's own database row — never in the YAML. Every shipped playbook is
      `active: false` and readiness fails if that ever stops being true.

---

## 5. What nothing checks — read before ticking anything above

This section exists because the previous version of this file asserted three enforcement mechanisms
that do not exist. A reviewer who believes a database will catch them stops looking.

### 5.1 Nothing enforces `art15SourceRouteVerified`

The column is real (`Controller.art15SourceRouteVerified`, migration `0000_init`). The trigger the
old checklist described — "a database trigger (migration 18f) refuses to activate a provenance
playbook until this is done" — **was never written, and there is no migration 18f.** Setting the flag
today records an intention and gates nothing. `TODO(safety)`: the check belongs in `corpus:activate`,
where activation actually happens.

### 5.2 The object-store readiness row does not probe the store

It tests that `OBJECT_STORE_ENDPOINT` is a non-empty string. Setting the variable to any value turns a
launch gate green while changing nothing, and there is no object-store adapter yet — the worker writes
`unconfigured://` evidence refs. Until that lands, treat this row as unverified regardless of colour.

### 5.3 There is no `Controller.active`

Only `Playbook.active` exists, so "activation" is per playbook, not per controller. The old final
gate — "flip the first `Controller.active` to `true`" — was an instruction that could not be carried
out. Nothing in the tree parses `playbooks/*.yaml` at runtime either, so on a real node the `Playbook`
table is empty and every request routes `NO_ROUTE`; the importer is the next stage of the operational
plan.

### 5.4 The reply half of the pipeline is not built

Ingest enqueues `bytes: []`, there is no inbound channel and no controller-response parser. A reply
that arrives and is not ingested lets the timer draft an Art. 77 complaint alleging silence against a
controller that answered. **Do not send a request whose reply window will close before that lands.**

### 5.5 Ops accounts are ordinary accounts with a flag

`OpsRoleGuard` reads `User.role`; a compromised ops password is a compromised ops surface, and the
evidence chain records the act without attributing it to a distinct actor (OQ-27).
