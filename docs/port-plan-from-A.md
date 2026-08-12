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
| 2c | A's remaining screens: auth, konto, ops queue, herkunft, schutz, schufa, wissen, report | REFIT (L) | next |
| 3 | auth policy: step-up guard, idle timeout, TOTP replay defence, recovery codes, durable throttling, revoke-everywhere | REFIT (L) | |
| 4 | leverage: A's ladder-ordered `chooseRung` (better than B's scalar `preferRoute`) minus its cost model; playbooks in tranches, starting with the `loeschung-herkunft` family | REFIT (L) | |
| 5 | ops, worker, dispatch — **re-derived** against B's transition table, plus A's engine factory (ADR-031) | REBUILD (XL) | |

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

**2c — porting the remaining screens.** A's copy for its own screens (dashboard, bundle, report, ops) was NOT
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
