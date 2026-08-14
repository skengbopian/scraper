# Port plan — absorbing the pre-audit line (A) into this line (B)

Companion to **ADR-030** (why this direction) and `docs/decision-reconciliation-A.md` (the decision
audit trail). A is `~/Downloads/scraper` at **`cc9dcb4`**; B is this repo, tagged
**`port-baseline-2026-08-11`**. Derived from an eight-domain read-only assessment of both trees on
2026-08-11; every hazard below cites a file that was actually opened.

**Path convention — read this before following any path below.** A path written `A:apps/worker/src/channels/email.ts`
is a path in **A's tree**, not in this repo; an unprefixed path is this repo's and resolves here. The
prefix is not decoration: the two trees share basenames while the files behind them disagree about the
clock — this repo also has an `apps/worker/src/channels/email.ts`, and hazard 1 below is precisely that
opening the wrong one re-imports C1. It also keeps the reference-integrity gate honest.
`tools/spec-audit/audit.mjs` §4 resolves every backticked path against this repo and warns when it
finds nothing; before this convention it reported this document's citations of A as *our* missing
files — twenty warnings that were never defects, in the one channel that is supposed to tell a reader
a doc has gone stale. A path carrying the prefix is deliberately not a path here, so the gate stops
claiming it should be one.

**The one-line summary: nothing ports verbatim.** All eight domains came back `REFIT`. A is ~36.4k
LOC of TS/TSX against B's ~8.2k, but it is built on a 13-state machine in which an email send starts
the statutory clock, so a "just copy it and fix the build" port silently re-imports the exact
contradiction ADR-012 exists to remove.

## The five hazards that make this a refit, not a copy

1. **A starts the statutory clock from an email, in code, today.**
   `A:apps/worker/src/channels/email.ts:22` returns `{ providerRef: messageId, provable: true }` — its
   own comment at :18-21 admits `provable` is hardcoded. `A:workflows/dispatch.ts:100-122` then applies
   the provable transition, and `A:gateway/controller-gateway.ts:114-137` anchors `OUTBOUND_COPY` for
   both channels alike. **Three files reintroduce C1 if ported unchanged, and the first two suffice.**
2. **Fake proof becomes real proof under B's rules.** A's `StubPostalProvider` returns
   `proofRef: 'stub:einwurf-proof-N'` for any `registered:true` call. Inert in A. In B the presence
   of a `proof` object is precisely what authorises `provableSendConfirmed` — the stub would start a
   legal deadline. Same shape hazard in the `Mailer` refit, where the obvious defaults
   (`accepted:true, dkimAligned:true`) map an email onto the provable edge.
3. **The UI fails silently, not loudly.** A's wire type carries one clock
   (`A:apps/web/src/lib/types.ts:71 deadlineAt`); B emits `statutoryDeadlineAt` + `provisionalDeadlineAt`.
   A ported page reads a field B never sends, renders "—", and a reviewer clicking through sees
   "no deadline yet" rather than an error. `A:app/requests/[id]/page.tsx:48-53` additionally equates
   `AWAITING_RESPONSE` with the statutory clock, and `A:lib/dashboard-insights.ts:122` recommends
   "gesetzliche Frist überschritten" straight off that state.
4. **Replies to emailed requests would be dropped.** `A:workflows/ingest-response.ts:109` gates ingest
   on `state === 'AWAITING_RESPONSE'`. In B an emailed send lands in `AWAITING_RESPONSE_PROVISIONAL`,
   so every controller reply to an emailed request would be silently ignored.
5. **0 of A's 45 playbooks pass B's validator.** Run against B's real gate. Failure groups: missing
   `kind` (45/45, mechanical — all are `RIGHTS_REQUEST`); `channel.registered` as a bare boolean
   (45/45, B requires the per-channel object); and **21 files assert a silence→Art. 77 escalation off
   a channel that can never produce a provable send** — those 21 are not a conversion, they are a
   legal-posture change that needs counsel.

## Wave order (revised against the assessment; supersedes the sketch in ADR-030)

| Wave | Contents | Class | Status |
|---|---|---|---|
| 1 | envelope crypto + sealed TOTP secret; DPIA, consumer-UX, pre-send checklist; convergence ADRs | REFIT (S–M) | **done** — `dc7dc9f`, `4535f23` |
| 1b | A's extra Prisma **invariants** as forward-only `0005` (6 of them) + the first DB gate in `tools/spec-audit` | REFIT (M) | **done** — `0005_harden_existing` |
| 2a | `packages/i18n`: 3-register dictionary (de / de-leicht overlay / en) + the inherited copy tests + a new two-clock copy test; wired into the API's user-facing messages | REFIT (M) | **done** — ADR-034 |
| 2b | the Next.js shell (`apps/web-next`): shell + start/firmen/firmen[slug]/vorgaenge/vorgaenge[id] on the two-clock contract; served-app axe gate | REFIT (XL) | **partly done** — core loop live |
| 2c | Akte (the BYO-Datenkopie flagship) + Wissen; structural tests widened from pages to all components | REFIT (L) | **done** |
| 2d | auth screens (register → secret → login → TOTP) + konto + the identity gate explained; session as an httpOnly cookie | REFIT (M) | **done** — wave 2 complete |
| 3 | auth policy: step-up guard, idle timeout, TOTP replay defence, recovery codes, durable throttling, revoke-everywhere | REFIT (L) | **done** — ADR-035, migration `0008_auth_policy` |
| 4 | leverage: A's ladder-ordered `chooseRung` (better than B's scalar `preferRoute`) minus its cost model; playbooks in tranches, starting with the `loeschung-herkunft` family | REFIT (L) | **done** — ADR-036 |
| 5 | ops, worker, dispatch — **re-derived** against B's transition table, plus A's engine factory (ADR-031) | REBUILD (XL) | **done** — ADR-037, migrations `0010_anchor_qualification` + `0011_ops_queue`. **The port is closed.** |

### Wave-1b detail — why invariants and not the schema
A's schema is a different foundation (uuid ids, `multiSchema`, the 13-state clock, a triple-blocking
idempotency index). Porting its `rights_request_idempotency` index would permanently block a lawful
second cycle after `COMPLIED`, breaking ADR-013 and the provenance follow-up chain. Take A's
*invariants* re-expressed against B's baseline; leave its request tables behind.

### Wave-2 detail — the single most valuable thing A has for the UI
**2a is done** (ADR-034): `packages/i18n` carries the three registers with the pre-audit line's copy
tests inherited (key parity, non-empty, forbidden-phrase/UWG) plus a two-clock copy test this line
needs. The API's user-facing messages now resolve through it, so `Accept-Language` and
`X-Scraper-Reading-Level: leicht` are proven on the wire (`apps/api/test/api.e2e.test.ts`).

**2b status.** The shell and the core product loop are live in `apps/web-next` against the real API:
company list → the three engine outcomes → a tracked Vorgang → the chase step → the statutory clock.
Hazard 3 is answered structurally rather than by review: `apps/web-next/src/lib/clock.ts` exposes a **discriminated
union** (`none | provisional | statutory`), `resolveDeadline()` **throws** if the API ever sends a
statutory deadline without `clockIsProvable`, and `DeadlineCard` is the only component permitted to
turn a deadline into words. A test forbids any page from calling `clockCopy` or touching
`statutoryDeadlineAt` itself.

Two further rules landed as tests after the served-app gate caught the mistakes: no page may render a
raw state or requestType (docs/09 §3 — the plain-language labels in `@scraper/i18n` exist for this),
and the register switches are plain `<form>` posts rather than click handlers, so they work before
hydration and with JS disabled.

**2c status.** Two screens landed, chosen by what the API can actually serve rather than by what A
had: **/akte**, the BYO-Datenkopie surface (docs/10 §3.1) — the same-day-utility flagship that had a
working backend and no UI at all — and **/wissen**, the jargon list (docs/09 §4). Verified against the
real fixture: five CoC findings render with severity, computed deadlines, and the score-negative
warning.

Two honesty rules are structural on the Akte screen: findings carry the **preliminary** badge and the
"not legal advice" note for as long as `ruleSet.counselSignedOff` is false (OQ-13), and a finding
whose action helps privacy but hurts the score warns before the user acts (docs/10 §2.1) — never a
promised number in either direction.

**Deliberately NOT built: the ops queue.** A has one; this API has no ops endpoints, so the screen
would have been a mock-up of a capability that does not exist. It waits for wave 5, which is where
the ops/worker side gets re-derived. — **Built in wave 5** (ADR-037): the endpoints landed first
(`apps/api/src/ops`, behind a role stored on the User row rather than asserted by a header), and
`/ops` followed them.

**2d status — wave 2 is complete.** Register → the shared secret shown once → sign in → TOTP → an
MFA-verified session, verified end to end in the browser against the real API. The token lives in an
**httpOnly cookie** and the bearer header is assembled server-side, so page scripts can never read
it. The API's own rule does the rest: its dev fixture fills only a true vacuum, so the moment a real
session exists the fixture stops applying — proven by signing in as a fresh account and seeing an
EMPTY case list rather than the fixture user's.

That test also exposed a defect worth recording: every page had rendered `errors.offline` for ANY
failure, so a signed-in but identity-unverified user — a 403, and an entirely expected state — was
told the network was down. `app/api-error.tsx` now decides from the status and gives 403 its one
resolving action; a test forbids any component from rendering the offline string directly.

**Remaining screens from A, deliberately not ported:** herkunft, schutz, schufa and report are
product surfaces whose backing endpoints this API does not have. They belong with the features, not
with the shell — the ops queue likewise (wave 5). A's copy for its own screens (dashboard, bundle, report, ops) was NOT
transplanted: it describes pages this line does not have, and its clock strings are written against
the single-`deadlineAt` model (hazard 3). Port a screen's copy WITH the screen, and when doing so,
map A's one deadline onto this line's two — never alias `statutoryDeadlineAt` into a `deadlineAt`
field to make a ported page compile. That is the specific move that turns a silent "—" into a
mislabelled legal deadline.

### Wave-4 detail — start where B currently dead-ends
`packages/core/src/provenance/ledger.ts:107-145` already proposes an Art. 17(1)(d) partial erasure at
the bureau, and B has neither the playbook nor the template to execute it — the flagship provenance
chain stops there. `A:templates/art17-loeschung-herkunft.de.md` plus the four
`loeschung-herkunft.{boniversum,crif,infoscore,schufa}.yaml` close it. Highest value per file in the
whole port.

### Wave-3 outcome — the substrate had to come first
The wave landed as ADR-035. Two corrections to what this plan implied:

1. **A's step-up guard is not the port; it is the last 23 lines of it.** The guard reads
   `request.stepUp` and nothing in this line set that flag, so porting the file alone would have
   produced a guard that cannot fire — and, because the flag would be `undefined`, one whose failure
   mode depends on whether the check is truthiness or strict equality. The session columns, the
   `/auth/step-up` route, the middleware that resolves the flag and a strict `!== true` all had to
   land first.
2. **The TOTP duplicate was the real hazard, not the missing replay defence.** This line already had
   a working TOTP implementation in `apps/api/src/auth/crypto.ts` returning a bare boolean. Adding
   A's replay-defended one beside it would have left two implementations disagreeing about whether a
   spent code is still valid — so that file now re-exports the core one and the boolean signature
   is gone. That is a breaking change to an internal API, made deliberately: a boolean cannot carry
   the counter, and without the counter there is no replay defence.
### Wave-4 outcome — three corrections to the plan above
The wave landed as ADR-036. Three things this plan got wrong, recorded so the next wave does not
inherit them:

1. **The playbook/template pair was not enough to close the dead-end.** `art17-loeschung-herkunft.de`
   renders `{{categories}}` and `{{sourceNames}}`, which are not identity fields and which
   `subjectFields` is closed against by design. The engine had no seam for them, and `render()` treated
   an `{{#each}}` over an unsupplied list as EMPTY — so the ported template would have produced a letter
   announcing a bounded erasure demand at a credit bureau and listing no categories, silently. Closing
   the dead-end therefore also meant a `scopeSource` binding, a branded `PartialErasureScope`, and
   making the renderer fail on an unbound `#each` like it already failed on an unbound `{{var}}`.
2. **"21 files assert a silence escalation off a channel that can never produce a provable send" is not
   what the corpus says.** Measured against this line's gate: all 45 declare
   `onDeadlineExpiry: DRAFT_ART77`; **12** have no postal channel at all (web-form-only: 11880,
   dasoertliche, dastelefonbuch, google-eu-delisting × 3 request types) and are the true "can never"
   set; **17** declare a postal channel with the bare boolean `registered: false`, of which only 3 carry
   a real postal address — the other **14** carry a `TODO(counsel): verify` placeholder, which this
   line's schema ACCEPTED as an address. So the honest split is 12 impossible + 14 blocked on a verified
   address, not 21 of one kind. Deferred as OQ-26 (`docs/counsel-review-packet.md` §8b).
3. **Only three of the four `loeschung-herkunft` files were portable.**
   `loeschung-herkunft.boniversum` contradicts `docs/07`, which keeps `boniversum` as a slug alias after
   the Sep-2025 merger into infoscore and says "do not write a playbook against it". `provenance.crif`
   was pulled forward into the tranche instead: without it `loeschung-herkunft.crif` could never derive
   its scope, which the new corpus-level `SCOPE-UNREACHABLE` check would have failed.

## Refuse list — do not port these

- **`A:scripts/generate-playbooks.mjs`.** Running it in B regenerates the corpus in A's shape (no
  `kind`, scalar `registered`, `onDeadlineExpiry: DRAFT_ART77` on email-primary playbooks). It would
  undo the validator's work in one command.
- **`A:packages/core/src/subject/verified-subject.ts`.** Its `deriveSubjectSnapshot()` returns an
  unbranded plain object — importing it creates a second subject constructor and defeats ADR-019's
  unforgeable brand. This line's one constructor is `packages/core/src/identity/subject.ts`.
- **`A:schema.prisma` and its migration chain** (see wave 1b).
- **`A:docs/AUDIT-2026-08-07-spec.md`** — this line already resolved that audit into spec edits
  (ADR-011) and keeps the resolution as `AUDIT-2026-08-07.md`; A's file stays in A's history.
- **A's cost-model and request-accounting modules** under `A:packages/core/src/leverage/` (ADR-036). The first prices a legal request partly
  on "it permanently consumes the ONE (user, controller, requestType) idempotency slot" — the
  pre-ADR-013 model in a constant; the second books on `provableSendConfirmed` and imports the 13-state
  clock vocabulary. Note the trap the plan did not name: A's expected-cost walk cannot simply be ported
  with the costs stubbed to zero — `cost(i) < p(i)·E[i+1]` becomes `0 < p·0`, false for every rung, so
  the router returns the artillery every time with a plausible-looking audit trail.
- **A's three `boniversum` playbooks** — `docs/07` keeps the slug as an alias only. Now gated by
  `CENSUS-ALIAS` in `tools/spec-audit/audit.mjs` rather than by prose.
- **`VerifiedContactIdentifier` (A's D19.13)** until **OQ-19** is decided — it is a partial answer to
  an open safety question and touches ADR-009's closed `subjectFields` enum (ADR-033).

## Port with a fix, never as-is

- **`A:scripts/readiness.mjs`** — its `filesUnder()` swallows a missing-directory throw and returns
  `[]`, so a grep-based check reports **PASS on a directory that does not exist**. Fix that before
  trusting it, and add gates for B's invariants (the three-way C1 clock agreement, "no silence
  escalation without a provable channel") which A's version has no concept of.
  **Outcome (2026-08-13 audit): it was not ported at all.** This line's `scripts/readiness.mjs` is
  written from scratch against B's gates — it shells the four spec-audit gates by exit code instead
  of grepping directories, so the failure mode above cannot occur, and it adds the env/posture and
  counsel tracks A had no concept of. Recorded here because "port with a fix" and "re-derive" look
  the same from the outside and only one of them leaves A's defect behind.
- **A's `docs/11-dpia.md`** (imported in wave 1) is scoped to "the leverage ladder only". B already
  processes credit files and parses hostile documents, so the DPIA **understates B's actual
  processing today** — it needs the amendment its own scope note anticipates before it goes to
  counsel, covering ACCESS_ART15_SOURCE, the BYO-Datenkopie ingest, and the provable-clock risk
  ("we assert a deadline that was never legally established") that a ladder-scoped DPIA never faced.

### Wave-5 outcome — the rebuild, and two defects only running it exposed
The wave landed as **ADR-037** in two commits (dispatch core, then the ops queue). What the plan got
right: every one of the four cited lines in A's dispatch layer was a defect, and none of them could be
fixed by porting-then-patching. What it did not anticipate:

1. **Deleting the boolean was the fix; the rest followed from the type.** The plan framed hazard 1 as
   "`provable` is hardcoded true — correct it". Correcting it keeps a boolean that some later change
   sets from a DKIM check. What landed instead is a branded `ProvableSendEvidenceId` with one
   constructor and channel adapters whose return types cannot express a provable send. The brand
   announced its own scope: the compiler immediately rejected `apps/api`'s simulate surface (which
   passed the string `ev_sim_<id>`) and `apps/worker`'s LetterXpress and QTSP adapters, which had been
   silently asserting exactly the two facts that authorise a legal deadline.
2. **The consequence is that this repo cannot start a statutory clock at all,** and that is correct
   rather than a gap: with no QTSP account and no hybrid-mail account there is nothing to evidence a
   deadline with. The alpha's "registered send" therefore fails closed to the ops queue with
   `SIMULATED_ANCHOR` instead of demonstrating a clock it could never defend.
3. **Two defects surfaced only by running it end to end**, after the whole suite was green — recorded
   in ADR-037 because the lesson generalises: the durable queue is a JSON boundary that silently
   destroyed a controller's reply, and `ctx.reason` stopped at `apply()` so the ops queue showed
   tickets with an empty explanation. Neither is visible in a unit test that constructs its own inputs.

## What was deliberately never brought across from A

The port is closed. This section exists so nobody re-opens a question that was already answered — if
something below looks like an oversight, it is not, and the reason is here.

**Refused on the merits** (the refuse list above, unchanged and still binding):
`A:scripts/generate-playbooks.mjs`, `A:packages/core/src/subject/verified-subject.ts`, `A:schema.prisma`
and its migration chain, `A:docs/AUDIT-2026-08-07-spec.md`, the `A:packages/core/src/leverage/` cost-model and
request-accounting modules, the three `boniversum` playbooks, and `VerifiedContactIdentifier`. Wave 5
adds one more: **`A:packages/db/src/repositories/rights-request.repo.ts`**, whose
`OPEN_OR_COMPLETE_EXCLUDED` semantics contradict ADR-013 and would permanently block a lawful second
cycle after `COMPLIED`. (There is no `packages/db/src` here at all — `packages/db` is the Prisma
schema and migration chain, and the repositories live with their consumers:
`apps/api/src/requests/prisma-requests.repository.ts` and `apps/worker/src/repo/prisma-worker.repo.ts`.)

**Superseded by a re-derivation** — A's file exists, this line has its own, and they are not
interchangeable. All of these were rewritten against the 16-state machine (ADR-037); A's versions are
written against a 13-state machine in which an email starts the statutory clock, so copying any one of
them back re-imports C1. Two of the pairs also differ in name, which is exactly where a careless
"the file is already there" reading goes wrong:

| A's file | this line's file |
|---|---|
| `A:channels/email.ts` | `apps/worker/src/channels/email.ts` |
| `A:channels/postal.ts` | `apps/worker/src/channels/postal.ts` |
| `A:workflows/dispatch.ts` | `apps/worker/src/workflows/dispatch.ts` |
| `A:workflows/deadline-sweep.ts` | `apps/worker/src/workflows/deadline.ts` |
| `A:workflows/ingest-response.ts` | `apps/worker/src/workflows/ingest.ts` |
| `A:gateway/controller-gateway.ts` | `apps/worker/src/gateway/controller-gateway.ts` |

`A:engine/factory.ts` and `A:bullmq-engine.ts` are the exception — adopted rather than re-derived, with
the default changed (ADR-031); they live here as `apps/worker/src/engine/factory.ts` and
`apps/worker/src/engine/bullmq-engine.ts`. `apps/worker/src/engine/temporal-engine.ts` exists beside
them but is a typed placeholder that **throws** on `schedule()` — deliberately, because a scheduler
that accepts a Frist timer and drops it produces a request whose deadline never expires and which
looks healthy in every view. Do not read its presence as "Temporal is wired".

**Not ported because the backing capability does not exist here**, and a screen or worker for a
capability the product lacks is a mock-up (the wave-2c rule):
- A's `herkunft`, `schutz`, `schufa` and `report` screens — product surfaces whose endpoints this API
  does not have. They belong with the features, not with the shell.
- `A:workflows/alias-relay.ts`, `A:suppression-renewal.ts`, `A:route-staleness.ts` and `A:anomaly-sweep.ts`
  — Tier-1 ladder machinery. The rungs exist here (ADR-036) but nothing yet produces the entities
  these sweeps maintain, so porting them would ship four cron jobs over empty tables.
- `A:workflows/purge-raw-docs.ts` — the retention window is enforced as a DB constraint here
  (`raw_document_requires_purge_date`, 0005). When this plan was written the sweep that acts on
  `purgeRawAt` was **not built**, and this bullet named it the one genuine gap in the list rather than
  a decision. **Closed by the 2026-08-13 audit (M1)**, after the port: `apps/worker/src/workflows/purge.ts` is the executor
  (delete-then-tombstone, blob first — a tombstone without a delete would only *look* purged), wired
  into the 15s sweep in `apps/worker/src/main.ts` beside dispatch and the deadline sweep. It was
  re-derived, not ported. One qualification, kept visible because it is the part that still fails
  silently: `deleteObject` is a logged no-op until the EU object-store adapter exists, so today the
  tombstone is the whole of the work — carried as a `TODO(safety)` at the wiring site in
  `apps/worker/src/main.ts`, not here.
- `A:workflows/art77-draft.ts` — this line records that a complaint is DUE (`ESCALATION_DRAFTED`)
  and evidences the human's filing, but does not render the complaint text. That is counsel-owned
  prose (`CLAUDE.md`), and A's generator writes it in code.

**Not ported because it is a legal question, not a mechanical one:** the 12 web-form-only playbooks
asserting a silence → Art. 77 escalation, and the 14 whose postal address is a `TODO(counsel)`
placeholder — **OQ-26**, `docs/counsel-review-packet.md` §8b.

**Carried as a lesson rather than as code:** A's fixture-environment allow-list (its D29), which this
line re-expressed in `devFixturesEnabled()` in wave 1; and A's `assertStartupSafe` positive-check
insight (an unset provider selector also defaults to a stub), re-expressed in
`apps/worker/src/config.ts` in wave 5.
