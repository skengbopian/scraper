# Decision pass — 2026-08-14

The 2026-08-13 audit ended with a list of eight things it had deliberately NOT fixed, each because it
needed a design or counsel decision first (`AUDIT-2026-08-13.md` §3). Those decisions were taken, and
this file records what was implemented against them. It is the fix ledger for that list; the audit
narrative itself stays in the 08-13 file.

Seven of the eight landed. **D2/D3 (two-key envelope encryption + crypto-shred erasure) did not** —
see §3, which says plainly what that means for the DPIA and for launch.

## 1. What this pass implemented

### D1 — `AWAITING_DELIVERY_PROOF`: the Art. 12(3) clock is reachable again (audit F3a)

The gap: once the LetterXpress adapter was made honest (F3b — it had been stamping `origin: 'CARRIER'`
and `deliveredAt: now()` onto a mere lodgement), every real registered send returned `proof: null` and
degraded to the provisional clock. The graph had no upgrade edge, so **in production the statutory
clock could not be reached at all** — the product's central legal mechanism, unreachable by
construction.

A dedicated STATE, not an upgrade edge on `AWAITING_RESPONSE_PROVISIONAL`: email sends live in that
state too, so the edge would have needed a runtime guard, and invariant 4a would have stopped being a
property of the graph. The regression class this repo was rebuilt to prevent.

- Four new edges: `SENT --registeredSendLodged-->`, and out of the new state
  `provableSendConfirmed` / `responseIngested` / `proofRetrievalFailed`. Withdrawal applies as it does
  to any non-terminal state.
- **A lodgement starts NO clock** — not the statutory one, and not the provisional one either. The
  provisional clock exists to trigger the chase, and the chase asks for a registered send that has by
  definition already happened. It sets only `proofDueAt` (lodgement + 14 days, `TODO(counsel)`), an
  operational hint for the retrieval job.
- **The month runs from DELIVERY, not from retrieval.** `apply()` gained `ctx.deliveredAt` and it is
  REQUIRED on the asynchronous edge. On that path `ctx.now` is when our job fetched the receipt;
  dating the month from it would hand the controller our queue latency as extra statutory time. A
  `deliveredAt` in the future is refused as a corrupt proof.
- **A missing receipt asks a human, never escalates.** `proofRetrievalFailed → NEEDS_HUMAN`. Not
  knowing whether a letter arrived is the opposite of evidence that it did.
- The branded `ProvableSendEvidenceId` requirement is untouched: both inbound edges to
  `AWAITING_RESPONSE` demand it.
- Migrations `0014` (enum value alone — Postgres refuses to USE a new enum value in the transaction
  that added it) and `0015` (`proofDueAt`, its index, and a CHECK). The CHECK is the legal rule in the
  database: `proofDueAt` exists only in `AWAITING_DELIVERY_PROOF`, and in that state neither clock
  column may be set. With 0001's `deadline_requires_provable_send` the database now refuses both halves
  of the failure — a clock without proof, and proof-waiting with a clock.
- Worker: a `REGISTERED_LODGED` outcome variant (`eventFor()` still total; email still cannot reach
  anything but `sendAccepted:nonProvable`); a third expiry path in `deadline.ts` with a `DUE_FIELD`
  table — the old ternary answered "deadlineAt" for every kind that was not `provisional`, so a
  `proof` timer would have read the statutory clock, found it null, and fired unconditionally.
- **The manual path, which is what makes this work today.** `POST /ops/requests/:id/delivery-proof`
  records a paper Auslieferungsbeleg → anchors and chains a POSTAL_PROOF record → mints the branded id
  → applies the same `provableSendConfirmed` the retrieval job will apply. OQ-11 blocks automating the
  fetch, not the transition. With no QTSP configured it **fails closed and says which**: the receipt is
  stored (losing it would be worse than being unable to use it — the postal channel's own reasoning),
  the request does not move, and the response names the `UNPROVABLE_*` reason. There is deliberately no
  dev flag that makes the anchor come back `QUALIFIED`.
- Tri-document rule honoured: `CLAUDE.md` §6, `docs/05` §6 and `schema/request-state-machine.md` all
  say the same thing. **The clock rule itself did not change** — only a provable send starts it. What
  is new is that the provable send may be confirmed asynchronously.

### D4 — the escalation venue is expressible (audit P5)

`seatDpa` was schema-required on one shape only, nothing read it at escalation time, and "the user's
own Land DPA" — correct for a US broker with no German establishment — could not be written down at
all. So an absent value was ambiguous between *dynamic by design* and *someone forgot*, and
`explanation.retorio` proved forgetting happens.

- `venue` enum with the single value `USER_RESIDENCE`, plus a schema conditional: any playbook whose
  escalation contains `DRAFT_ART77` on any trigger MUST declare `seatDpa` **or** `venue`.
- 13 playbooks fixed, versions bumped, corpus re-sealed. The two German controllers took their seat
  (`LDI_NRW`, `HBDI`); the foreign brokers and both stencils took `USER_RESIDENCE`.
- The resolved venue now reaches the ops escalation payload and renders on the drafted row.
  `USER_RESIDENCE` arrives with no authority attached, on purpose: resolving it needs the data
  subject's Land and that payload carries no subject data. `TODO(counsel)` OQ-20.
- Research corrections from `docs/13` applied (HIS operator → HBDI; CRIF Karlsruhe → LfDI BW).
- **This fixes expressibility, not correctness.** Every venue value stays counsel-owned.

### D5 — the session token is rotated at MFA and at step-up (audit L2)

`/auth/totp` used to upgrade the same bearer in place, so a token captured in the window between
password and code — where a token is freshest and most exposed — became a fully privileged session the
moment the **victim** completed their own challenge. The attacker supplied nothing; they waited.

Now MFA completion, recovery-code redemption and step-up each mint a new token and revoke the old one
in one transaction. `createdAt`/`expiresAt` are inherited, never recomputed: rotation re-issues an
identifier, it does not restart the absolute lifetime — otherwise a session could be kept alive
forever by re-confirming.

### D6 — the published alpha renders API data as text, not HTML

`apps/web/index.html` is the published demo Artifact, so it was hardened rather than retired. Every
render path that interpolates API-derived data now uses `textContent`; the remaining `innerHTML`
assignments are module-local constant literals and say so.

### D7 — the ops surface stopped swallowing answers, and the anomaly log is visible

- `resolveCase` / `fileComplaint` / `discardComplaint` / `assignDocument` returned `void` and dropped
  the `ApiResult`. STALE_STATE, GUARD_MANDATE, "no proven receipt" — every one of those sentences was
  thrown away, leaving a button that looked like it worked. They now return the API's message and the
  rows render it. Same dead-end class already fixed on the consumer side.
- The `AnomalyEvent` panel exists. The table has been written since 0013 and `GET /ops/anomalies` has
  served it; nothing rendered it, so "flag anomalous targeting for human review" was a row in a
  database nobody opened. Rendered last on the page deliberately: it is usually empty, and a
  usually-empty panel at the top trains reviewers to scroll past the one row that will matter.

### D8 — the warning channel is clean, and the scrypt comment is honest

- **33 stale doc-refs → 0.** Shorthand paths were corrected to real ones; claims about files that
  never existed were rewritten truthfully rather than deleted. The three in `docs/11` were the
  dangerous subset — §3 cited a "protection-router" repository and integration test as *enforcement
  evidence* and neither has ever existed in this repo. The control is real (`leverage/routing.ts` +
  the persisted `routingDecision`); the citation was not, which in a document a regulator reads as
  evidence is the worse of the two failures.
- The scrypt parameters are unchanged and the comment no longer calls them "OWASP params". It states
  N=2^14 against OWASP's 2^17 floor, states the reason (≈800ms interactive login, paid on failed
  sign-ins too, on an unauthenticated endpoint), and states the cost of the trade rather than hiding
  it. `TODO(safety)` to move to argon2id, with the migration path noted — the stored string is
  self-describing, so a second scheme needs no schema change.
- Applied migrations 0008/0009 keep their drifted comments, and
  `packages/db/prisma/migrations/README.md` now carries the immutability rule and the correction.

## 2. Two defects this pass introduced and caught

Recorded because both were found by gates rather than by review, which is the argument for the gates.

- **The negative-fixture harness went vacuous.** D4's venue conditional made the harness's own base
  fixture invalid, and its base self-check exists for exactly that: with an invalid base, all 31 cases
  are "rejected" for the missing venue rather than for the defect each was written to catch. The file
  reported `31 rejected` while testing nothing. Fixed (the base takes the real az-direct seat), plus
  two new cases proving the conditional fires **and** does not over-fire, plus the harness now
  enforces `MUST ACCEPT` expectations as well as `MUST REJECT` ones — a one-directional check is how
  the over-firing case would have gone unnoticed.
- **A dead-end screen.** `AWAITING_DELIVERY_PROOF` was missing from the case pipeline's step map, so it
  fell through to "nothing done, nothing active" — a screen telling a user who has just paid for a
  registered letter that nothing has happened. The project rule is that every screen states the next
  action; a pipeline showing no progress after a send does not.

## 3. NOT implemented: D2/D3 — two-key encryption and crypto-shred erasure

**Identity PII and credit-file contents are still plaintext at rest, and there is still no account
erasure path.** `Identity.legalName`, `Identity.dateOfBirth`, `IdentityAddress` line fields and
`CreditFileEntry.{reportedBy,label,amountCents,raw}` are unchanged from the 08-13 audit's H2/W14
findings.

Why it is not here: the change is a schema migration, a data migration of existing rows, a rewrite of
every read and write path in the API and the worker (the worker derives the subject at dispatch, so it
becomes a key-holder too), an erasure endpoint, the M4 credit-store role split, and a DPIA rewrite. It
is all-or-nothing — a schema change without the repository rewrites leaves the tree broken — and it did
not fit the working window this pass had. Starting it and stopping half way would have been worse than
not starting.

What was **not** done as a substitute, deliberately: erasure-by-scrub without encryption. It is
buildable today and it is a different design from the one chosen, and quietly shipping a rejected
alternative is worse than shipping nothing.

Consequences to hold on to:

- `docs/11-dpia.md` §6 **keeps its "this row is a TARGET, not the present state" warning.** It comes out
  when the implementation lands, not before. A DPIA that describes an intention as a control is the
  failure mode this repo has already corrected once.
- `pnpm readiness` still shows the counsel box *"DPIA signed AFTER §6 reflects implementation (identity-PII
  encryption + crypto-shred are open)"* unticked. That is accurate.
- The design decision itself stands and does not need re-taking: two keys per user (DOSSIER, shredded
  immediately on Art. 17; EVIDENCE, retained to a limitation window then shredded by a job), a
  `UserKey` table rather than more columns on `User`, reusing `AesGcmEnvelopeCrypto` and `KekResolver`.
  The first concrete step is the schema + migration + the key store, and the honest scope note is that
  it only pays off in the same pass that converts the columns.
- The threat model, when it does land, must be written down as **"a stolen DB dump or backup"** and not
  a word more. Both the API and the worker will hold the DOSSIER key, so a compromised application
  process is not covered.

## 4. Verification

`pnpm -r build` 7/7 · `pnpm -r test` **549 passing** (core 310, api 89, web-next 71, worker 49, i18n 15,
doc-sandbox 15; baseline was 525) · spec-audit **0 failures, 0 warnings, 76 checks** · negative fixtures
**33 cases, base self-check green, 0 wrong-direction results** · version seal 0 problems · state-machine
graph 0 structural problems (incl. the new F3a anti-journey) · migrations 0000–0015 deployed to
`scraper3` **and** `scraper3_test` · axe gate green (light/dark/Leichte Sprache) · API boot smoke green,
census serving · `pnpm readiness`: **no mechanical failures**, dev posture.
