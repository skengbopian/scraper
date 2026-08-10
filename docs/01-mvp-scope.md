# 01 — Phase 0 scope and milestones

> **SUPERSEDED IN PART BY `docs/09-pivot-modules.md` (2026-08-07, audit H4).**
> This file predated the pivot. It had **no milestone for the flagship** — research killed the
> "scraping defence protects your Schufa" thesis and made the **Art. 15(1)(g) provenance request** the
> highest-return proof of the product. Anyone following the old M1→M2 order builds the wrong thing
> first.
>
> **`docs/09` governs scope and ordering. This file governs the safety spine (M0) and the delivery
> mechanics.** The milestone list below has been reordered to match; where the two disagree on *what*
> to build, `docs/09` wins.
>
> Two concrete corrections already applied: **M1 is now the provenance loop, not the Werbewiderspruch
> loop**, and the bureau target list routes **Boniversum → infoscore** (merged Sep 2025).

**Goal:** a small, safe, mostly-automated loop that proves German consumers will pay €5–10/mo, and that
legally-precise automated requests get better results than generic ones — without building the
expensive or risky modules yet. Team: 2–3 engineers + Claude Code, ~3 months.

## In scope

### M0 — Skeleton & safety spine (weeks 1–3)
- Monorepo, CI, EU-region infra, Postgres, Prisma, durable-workflow layer.
- **Identity binding gate:** account cannot create a RightsRequest unless `Identity.status == VERIFIED`.
  Ident provider behind an interface (stub in dev; real provider contract is a human TODO).
- **RightsRequest state machine** (see `schema/request-state-machine.md`) with the Art. 12(3) one-month
  clock. Exhaustive unit tests.
- **Evidence ledger:** hash-chained records; QTSP timestamp behind an interface.
- **Untrusted-document sandbox** service interface (real OCR+LLM can be stubbed first, but the isolation
  boundary and the "no irreversible action from parser output" rule exist from M0).

### M1 — The PROVENANCE loop (the flagship — weeks 3–6)
The single milestone that proves the thesis. See `docs/09` §Provenance.
- Playbook engine loads/validates a YAML playbook and renders a template with verified-identity fields.
- **`ACCESS_ART15_SOURCE`** — Art. 15(1)(g) source request — end to end against **infoscore/Experian**
  (primary target: its own Art. 14 notice names AZ Direct) and **Schufa** (the undefined
  "Datenlieferanten" clause), postal + Einwurf-Einschreiben so the statutory clock is provable.
- Parse the reply in the doc sandbox into `ProvenanceEntry` rows; match named sources against the
  playbook's `brokerWatchlist`.
- An **incomplete** source list resolves to `INCOMPLETE` (never `REFUSED`) and routes to an Art. 77
  **draft** — the BayLDA precedent that an incomplete Art. 15 answer is itself a violation.
- Chained follow-ups are **proposals requiring human confirmation**, never auto-created.
- Idempotency per `docs/03` §Idempotency — a unique key with a cycle dimension, *not* a bare unique
  triple, or the follow-up chain and annual re-access both break.
- Ticket dashboard: status, both clocks (statutory vs provisional, never conflated), evidence.

### M2 — The Werbewiderspruch loop + access/parse breadth (weeks 6–10)
Was M1. Demoted because it does not prove the pivot thesis, not because it stopped mattering — the
Art. 21(2) objection remains the highest-win-rate individual action and is where the provenance chain
lands once a broker is named.
- **Art. 21(2) marketing objection** to ~8 address traders, via email + hybrid letter.
- **Robinsonliste** enrolment — as a `SuppressionEnrolment`, **not** a `RightsRequest`: it has no
  Art. 12(3) clock and no Art. 77 remedy (audit H3, `docs/08`).
- **Art. 15 Datenkopie** to Schufa, CRIF and infoscore (**not** Boniversum — merged into infoscore
  Sep 2025; route there).
- **Escalation:** on a *provable* deadline expiry or a refusal, auto-**draft** (never auto-send) an
  Art. 77 complaint with the evidence pack; a human reviews and sends.

### M2.5 — Leverage rungs (weeks 6–11, parallel with M2)
The cheapest welfare in the product, per `docs/08-leverage-ladder.md`. Build order matters:
- **Tier telemetry spine** (`LeverageAction`) first — outcomes per euro, per tier, including failures.
- **Tier 1a self-serve route directory** (`SelfServeRoute`) with guided handoff — the company's own
  deletion / preference / "do not sell" pages. No credential storage, ever; login routes stay guided.
- **Tier 1b suppression enrolment** (Robinsonliste, DAA/YOC, NAI, postal/telephone preference) with
  expiry + renewal job.
- **Tier 0 alias issuance** — email aliases on our own domains, forwarding + burn. Issuance only;
  the attribution graph stays in Phase 2. Blocked by API contract in legal/financial/ID contexts.
- **Tier 2 `ControllerChannelIntel`** + pre-verified identity packet — make saying yes cheap.
- **Cheapest-rung-first routing:** the Erasure Machine checks for a Tier 0/1 route before generating a
  legal request for the same outcome.

### M3 — Prove it & charge (weeks 10–13)
- 30-day re-scan/re-check loop.
- Subscription + billing (Stripe EU) at €5–10/mo; waitlist → paid conversion measured.
- Minimal user-facing "your requests & results" view. Internal per-controller response-rate stats
  (private; the *public* scoreboard is deferred).

## Explicitly OUT of Phase 0 (do not build)
- Browser extension / Copilot (site grades, GPC, CRLite, OHTTP, banner auto-reject).
- Receipts module **attribution half**: canary monitoring, attribution graph, **public** leaderboard,
  journalist pipeline, aggregate nudges. (Alias *issuance* is in — see M2.5.)
- Any automated authenticated session on a third-party site, third-party credential storage, or
  CAPTCHA-solving service.
- Score Studio beyond the single Datenkopie *request*: no dispute engine, no retention case-builder,
  no 12-criteria simulator, no C-203/22 explanation tooling yet.
- L2 LLM **browser agents** (web-form controllers fall back to the human queue in Phase 0).
- Face-search opt-outs, SpyCloud/Constella licensing, inbox scanning, census beyond ~20 controllers.

## Acceptance criteria (the gate to Phase 1)
- **A verified user can run a full `ACCESS_ART15_SOURCE` provenance request end to end** against
  infoscore and Schufa: rendered from verified-identity fields, sent by Einwurf-Einschreiben with a
  QTSP-anchored clock, reply parsed in the sandbox into `ProvenanceEntry` rows, brokers matched, and an
  Art. 77 complaint **drafted** (not sent) on an incomplete source list. *This is the milestone that
  proves the thesis — `docs/09`.*
- A verified user can also fire an Art. 21(2) objection and an Art. 15 request to ≥10 controllers, with
  tamper-evident proof and a live statutory clock.
- **Zero paths exist that create a request about a non-verified subject.** Asserted by test, not by
  review: the API surface has no person-describing field and `RequestSubject` is unconstructible
  outside `deriveSubject()`.
- **Zero paths exist that send an Art. 77 complaint without a human.** `ESCALATED` has exactly one
  inbound edge, it requires a `HUMAN_OPS` actor, and a database trigger rejects the row otherwise.
- **No statutory deadline is ever asserted from a non-provable send** (`CLAUDE.md` §6) — enforced by a
  DB `CHECK` constraint, not only in application code.
- ≥50% verified-removal/response at the pilot; paying users at €5–10/mo.
- A human pre-send checklist (counsel-reviewed templates, ident + postal + QTSP accounts, DPIA) is green.

## The usability gate (`docs/09`) — launch-blocking, and NOT satisfied by M0–M3
The functional core above may ship with a plain UI. **Before real users are onboarded**, `docs/09`'s
usability gate must be complete: user-action-flow diagrams per module, the visual components (data-flow
map, red/amber/green dial, request pipeline with a live deadline countdown), B1-level German with a
Leichte Sprache option, WCAG 2.2 AA, and an axe check in CI. That work is deliberately sequenced after
the first working request — it is not descoped.

## The pre-send human checklist (must be green before ANY real request leaves the system)
1. Counsel sign-off on every file in `templates/`.
2. RDG structure decided (Inkasso registration or lawyer-partner white-label). See `docs/05`.
3. Ident provider live; QES/mandate flow tested.
4. Hybrid-mail + Einwurf-Einschreiben account live; QTSP account live.
5. DPIA completed and signed; DPO appointed; EU hosting + EU inference confirmed.
