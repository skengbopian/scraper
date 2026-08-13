# Port plan — absorbing the pre-audit line (A) into this line (B)

Companion to **ADR-030** (why this direction) and `docs/decision-reconciliation-A.md` (the decision
audit trail). A is `~/Downloads/scraper` at **`cc9dcb4`**; B is this repo, tagged
**`port-baseline-2026-08-11`**. Derived from an eight-domain read-only assessment of both trees on
2026-08-11; every hazard below cites a file that was actually opened.

**The one-line summary: nothing ports verbatim.** All eight domains came back `REFIT`. A is ~36.4k
LOC of TS/TSX against B's ~8.2k, but it is built on a 13-state machine in which an email send starts
the statutory clock, so a "just copy it and fix the build" port silently re-imports the exact
contradiction ADR-012 exists to remove.

## The five hazards that make this a refit, not a copy

1. **A starts the statutory clock from an email, in code, today.**
   `apps/worker/src/channels/email.ts:22` returns `{ providerRef: messageId, provable: true }` — its
   own comment at :18-21 admits `provable` is hardcoded. `workflows/dispatch.ts:100-122` then applies
   the provable transition, and `gateway/controller-gateway.ts:114-137` anchors `OUTBOUND_COPY` for
   both channels alike. **Three files reintroduce C1 if ported unchanged, and the first two suffice.**
2. **Fake proof becomes real proof under B's rules.** A's `StubPostalProvider` returns
   `proofRef: 'stub:einwurf-proof-N'` for any `registered:true` call. Inert in A. In B the presence
   of a `proof` object is precisely what authorises `provableSendConfirmed` — the stub would start a
   legal deadline. Same shape hazard in the `Mailer` refit, where the obvious defaults
   (`accepted:true, dkimAligned:true`) map an email onto the provable edge.
3. **The UI fails silently, not loudly.** A's wire type carries one clock
   (`apps/web/src/lib/types.ts:71 deadlineAt`); B emits `statutoryDeadlineAt` + `provisionalDeadlineAt`.
   A ported page reads a field B never sends, renders "—", and a reviewer clicking through sees
   "no deadline yet" rather than an error. `app/requests/[id]/page.tsx:48-53` additionally equates
   `AWAITING_RESPONSE` with the statutory clock, and `lib/dashboard-insights.ts:122` recommends
   "gesetzliche Frist überschritten" straight off that state.
4. **Replies to emailed requests would be dropped.** `workflows/ingest-response.ts:109` gates ingest
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
| 5 | ops, worker, dispatch — **re-derived** against B's transition table, plus A's engine factory (ADR-031) | REBUILD (XL) | **dispatch core done** — ADR-037, migration `0010_anchor_qualification` |

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
Hazard 3 is answered structurally rather than by review: `src/lib/clock.ts` exposes a **discriminated
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
the ops/worker side gets re-derived.

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
chain stops there. A's `templates/art17-loeschung-herkunft.de.md` plus the four
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

- **`scripts/generate-playbooks.mjs`.** Running it in B regenerates the corpus in A's shape (no
  `kind`, scalar `registered`, `onDeadlineExpiry: DRAFT_ART77` on email-primary playbooks). It would
  undo the validator's work in one command.
- **`packages/core/src/subject/verified-subject.ts`.** Its `deriveSubjectSnapshot()` returns an
  unbranded plain object — importing it creates a second subject constructor and defeats ADR-019's
  unforgeable brand.
- **A's `schema.prisma` and its migration chain** (see wave 1b).
- **A's `docs/AUDIT-2026-08-07-spec.md`** — this line already resolved that audit into spec edits
  (ADR-011); the file stays in A's history.
- **A's cost-model and request-accounting modules** under `packages/core/src/leverage/` (ADR-036). The first prices a legal request partly
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

- **`scripts/readiness.mjs`** — its `filesUnder()` swallows a missing-directory throw and returns
  `[]`, so a grep-based check reports **PASS on a directory that does not exist**. Fix that before
  trusting it, and add gates for B's invariants (the three-way C1 clock agreement, "no silence
  escalation without a provable channel") which A's version has no concept of.
- **A's `docs/11-dpia.md`** (imported in wave 1) is scoped to "the leverage ladder only". B already
  processes credit files and parses hostile documents, so the DPIA **understates B's actual
  processing today** — it needs the amendment its own scope note anticipates before it goes to
  counsel, covering ACCESS_ART15_SOURCE, the BYO-Datenkopie ingest, and the provable-clock risk
  ("we assert a deadline that was never legally established") that a ladder-scoped DPIA never faced.
