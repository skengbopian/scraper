# Decision pass — 2026-08-14

The 2026-08-13 audit ended with a list of eight things it had deliberately NOT fixed, each because it
needed a design or counsel decision first (`AUDIT-2026-08-13.md` §3). Those decisions were taken, and
this file records what was implemented against them. It is the fix ledger for that list; the audit
narrative itself stays in the 08-13 file.

All eight landed, D2/D3 in two passes: **pass 1 (identity + erasure) is implemented**; pass 2
(credit-file sealing + the M4 role split) is not — see §3.

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

## 3. D2/D3 — pass 1 implemented, pass 2 outstanding

The decision was to stage it (B2): identity first, credit-file second. Identity is what *generates a
letter* and is what a stolen dump most directly weaponises; `CreditFileEntry` is advisory parser
output that never drives an irreversible action. Splitting there means the DPIA stops overstating
after pass 1 rather than after both.

### Pass 1 — landed

- **Two keys per user** in a `UserKey` table (`DOSSIER`, `EVIDENCE`), plus the pre-existing AUTH key
  on `User.wrappedDek`, which stays separate so a dossier compromise does not open the second factor.
  `wrappedDek IS NULL` means shredded, and a CHECK keeps that in step with `shreddedAt`: material
  without a stamp is a corruption, a stamp without material is a claim the bytes contradict.
- **`Identity.legalName`/`dateOfBirth` and `IdentityAddress` lines are sealed** under DOSSIER.
  Migrations 0016 (additive) → backfill script → 0017 (drops the plaintext, and REFUSES to run until
  the backfill has sealed every row, checking the rows rather than trusting an operator's word).
  0018 re-points the 0005 identity-freeze trigger at the sealed columns — PL/pgSQL resolves columns
  at execution time, so dropping them left the function silently broken.
- **The subject snapshot in `RequestEvent` is sealed under EVIDENCE.** This is what makes the erasure
  real: that table is append-only by trigger, so a plaintext name there would have outlived any
  erasure forever, and shredding the dossier while the ledger still named the person is not an
  erasure. EVIDENCE rather than DOSSIER because the snapshot proves the request was about the
  verified account holder and nobody else — the anti-stalker binding and the Art. 17(3)(e) defence
  in one record — so it must survive erasure to a bounded window.
- **`DELETE /auth/account`**, step-up gated: shred DOSSIER, shred AUTH, delete credential and
  recovery codes, delete credit-file rows (crude but correct until pass 2 seals them), scrub email to
  a digest, revoke every session, stamp `userErasedAt` — which finally makes `evaluateSession`'s
  USER_ERASED branch reachable after three waves of being structurally null. Idempotent: a second
  request must not rewrite the first stamp, because that date is the evidence and the date the
  EVIDENCE window is measured from.
- **The worker is now a key-holder**, stated in the code rather than discovered later: the subject is
  derived at send time from the Identity row, so sealing it does not move the identity out of that
  process.

### Pass 2 — outstanding

`CreditFileEntry.{reportedBy, label, amountCents, raw}` is still plaintext, and the credit-file store
still shares the main Postgres role (M4, checklist D6). Erasure deletes those rows today, which is a
correct erasure by a cruder mechanism; sealing them under DOSSIER makes the delete redundant.

### What the DPIA now says, and what it deliberately does not

§6 describes the implemented two-key model and the "this row is a TARGET" warning is gone, because
the row is no longer a target. Three things are stated as limits rather than softened:

- **The threat closed is a stolen database dump or backup.** Not a compromised application process —
  both the API and the worker hold the DOSSIER key while they work — and not a compromised KEK.
- **Backups are the honest gap.** A shred destroys the live key; a backup taken before it still
  contains one, so erasure completes when that backup expires. R6 moves from UNRESOLVED to
  partly-resolved with the backup half named as an **[OPS]** decision: short retention, stated, and
  no completion confirmation to the user earlier than it allows.
- **The EVIDENCE window is 3 years** from the year-end of the erasure (§ 195 with § 199(1) BGB),
  marked **[COUNSEL]**. The mechanism is not counsel's question; the number is.

## 4. Verification

`pnpm -r build` 7/7 · `pnpm -r test` **552 passing** (core 310, api 91, web-next 71, worker 50, i18n 15,
doc-sandbox 15; baseline was 525) · spec-audit **0 failures, 0 warnings, 76 checks** · negative fixtures
**33 cases, base self-check green, 0 wrong-direction results** · version seal 0 problems · state-machine
graph 0 structural problems (incl. the new F3a anti-journey) · migrations 0000–0018 deployed to
`scraper3` **and** `scraper3_test` (0017 refused until the backfill ran, which is the guard working) · axe gate green (light/dark/Leichte Sprache) · API boot smoke green,
census serving · `pnpm readiness`: **no mechanical failures**, dev posture.
