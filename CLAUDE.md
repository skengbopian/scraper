# CLAUDE.md — Scraper Phase 0

You are helping build **Scraper**, a Germany-first consumer data-rights platform. This file holds
rules that override convenience. Read `docs/` in order before writing code. When a decision is
ambiguous, prefer the safer, more legally conservative option and leave a `// TODO(counsel):` note.

## The one rule that outranks all others: this must never become a tool to find or harass a person

Scraper's core action is "look up what a data controller holds about a person, then act on it." That
is also exactly how a stalker locates a victim. Therefore, **non-negotiably**:

- Every outbound request (access, objection, erasure) MUST be about the **authenticated, identity-verified
  account holder** and no one else. There is no free-text "subject" field that can differ from the
  verified identity.
- A request's subject identifiers (legal name, DOB, address) are **derived from the verified identity
  record**, never typed in freely per request.
- Any content that comes *back* from a controller (addresses, credit data) is released to the user
  only after step-up auth and, for high-sensitivity data, only to the **verified postal address**.
- Rate-limit and log all lookups; flag anomalous targeting for human review.
- If you are about to implement a feature that lets a user act on data about a **third party**, STOP
  and flag it. That feature does not belong in this product without a dedicated safety design.

If any task appears to weaken identity binding, treat it as a blocker and say so.

## Non-negotiable guardrails

1. **Identity binding is in the MVP.** Do not build the request pipeline in a way that can send a real
   request before the account is identity-verified. Stub the provider (IDnow/Nect/POSTIDENT-eID) behind
   an interface, but the *gate* is real from commit one.
2. **Treat every controller response document as hostile input.** Broker letters/PDFs flow into OCR+LLM.
   Parse them in an isolated service: structured-output-only, no tool/function calling, one document per
   context, zero cross-user context. **Parser output may never trigger an irreversible action** (never
   auto-mark a controller "compliant", never auto-close a ticket) without deterministic validation or a
   human step. See `docs/06-security-safety.md`.
3. **Data residency: EU only.** All storage and all LLM inference for personal data must run in an EU
   region. No US-region model APIs on user data. Put the model provider behind an interface so the region
   is a config choice, and default it to EU.
4. **Minimise and encrypt.** Envelope-encrypt each user's assembled data map under keys gated by their
   auth. Segregate any credit-file store. Purge raw DSAR response files after they are normalised
   (keep the normalised record + the hashed evidence, not the raw dump longer than the retention window).
5. **Legal framing is load-bearing, not cosmetic.** The default action is the **unconditional Art. 21(2)
   marketing objection** and **Art. 15** access — user-initiated, individualised, one subject. Do NOT
   architect a "bulk Art. 15 sweep" engine as the core funnel (regulatory risk: Digital Omnibus). Never
   generate text that promises a specific outcome (e.g. "we will raise your Schufa score"). See
   `docs/05-legal-guardrails.md`.
6. **Every legally-meaningful action produces evidence, and the statutory clock only ever starts on a
   provable send.** Screenshot/rendered-copy + SHA-256, chained, and anchored with a qualified eIDAS
   timestamp for clock-critical events. **Email is not proof of delivery** — a DKIM-aligned accept proves
   we sent, not that they received. Therefore:
   - An email or web-form send sets a **`provisionalDeadlineAt`** only. It is an internal scheduling hint;
     it is never `deadlineAt`, and is never asserted to a controller or a DPA as a statutory deadline.
   - **`deadlineAt` (the Art. 12(3) clock) is set only by a provable send** — a verifiable postal channel
     (Einwurf-Einschreiben) whose receipt is anchored with a qualified eIDAS timestamp.
   - **The provable send may be confirmed asynchronously, and the month runs from DELIVERY.** A carrier
     does not hand over the Auslieferungsbeleg at the counter, so a registered *lodgement*
     (Einlieferung) sets **no clock at all** and parks the request in `AWAITING_DELIVERY_PROOF`; the
     receipt, whenever it arrives — fetched by the retrieval job or recorded by an ops human from the
     paper original — applies the same `provableSendConfirmed`. The month is measured from the time the
     receipt evidences, never from when we fetched it: queue latency is ours to bear, not statutory time
     to give away. A receipt that never arrives goes to a **human**, never to an escalation.
   - On silence after a provisional send, the user is asked to authorise a **registered re-send**. That
     re-send starts a **fresh** Art. 12(3) month from the registered send time.
   - **No path into `ESCALATION_DRAFTED` may rest on a provisional clock.** Escalating on *silence*
     requires a provable send; escalating on a *refusal or an incomplete answer* does not, because the
     controller's own reply proves receipt.
   The state machine encodes this structurally, not by a runtime check — see
   `schema/request-state-machine.md` §"The clock" and invariants 2 and 4. `CLAUDE.md` §6, `docs/05` §6 and
   that file are one normative rule in three places: change all three or change none.
7. **Cheapest rung first.** Legal requests are expensive artillery reserved for high-harm data. Before
   generating one, check for a Tier 0/1 route achieving the same outcome (the company's own deletion or
   preference page, an industry suppression programme, prevention via alias) and prefer it. See
   `docs/08-leverage-ladder.md`. Two hard sub-rules: **never collect, store, or use a user's third-party
   credentials** and never log into their accounts for them (guided handoff only); and **never submit
   false identity, address, or financial data** to a controller — degradation means redirecting real
   flow to user-owned channels, not falsifying records (Art. 5(1)(d)).
8. **Idempotency everywhere.** A `(user, controller, request_type)` may not be sent twice **by accident**
   (duplicate requests risk being deemed "excessive" under Art. 12(5)). Use idempotency keys and a
   per-user request ledger. This is emphatically **not** "may not be sent twice, ever": a re-send of the
   same request, a lawful annual Art. 15 re-access, and a provenance-driven follow-up to a controller
   already contacted must all remain possible. The key therefore carries a cycle dimension and the guard
   excludes the request being guarded — see `schema/request-state-machine.md` §"Idempotency".

## Engineering conventions

- **Language/stack:** TypeScript everywhere (Node 20+). API in NestJS. PostgreSQL via Prisma. Durable
  workflows via **Temporal** (or BullMQ if Temporal is too heavy for the first milestone — abstract it).
  Object storage: S3-compatible, EU region (e.g. Scaleway/Hetzner/OVH or AWS eu-central-1).
- **Monorepo** with pnpm workspaces: `apps/api`, `apps/worker`, `services/doc-sandbox`, `packages/*`.
- **Config over hardcoding.** Model provider, postal provider, ident provider, storage region are all
  interfaces with env-driven implementations.
- **Tests first for the state machine and the playbook engine.** These are the parts that, if wrong,
  send legally-wrong letters at scale. Unit-test transitions and playbook validation exhaustively.
- **No secrets in the repo.** `.env.example` only.
- Keep German legal wording in `templates/` reviewed by counsel; never inline legal prose in code.

## Pivot focus (read `docs/09-pivot-modules.md`)

The product is three modules on this engine: **Provenance** (Art. 15(1)(g) source requests → purge
broker-sourced bureau data), **Fraud Shield** (keep identity fraud off the Schufa file), **File Fixer**
(automate data copies, disputes, deadlines). Do NOT build "scraping defence improves your Schufa" — it is
false (report §5). Primary targets are the bureaus that buy broker data (infoscore/Experian, CRIF) plus
Schufa's undefined "Datenlieferanten" clause; escalation venue for infoscore + CRIF is LfDI BW.

## Usability is a launch gate (equal weight to the security gates)

Any German adult — low literacy, low digital confidence, or no idea what a credit bureau is — must
understand the risk, the benefit, and the next action from **visual cues and guided flows**, never a
written tutorial or legal wall. Sequencing: **get the functional path working first (a plain UI is fine),
then complete the UX before onboarding real users** — usability blocks launch, not the first working
request. Per module the UX deliverables are the **user-action-flow diagram and the visual components
(data-flow map, red/amber/green file-health dial, request pipeline with a deadline countdown).** One
decision per screen with a clear default; plain German ≈ B1 with a Leichte Sprache
option and a one-tap jargon explainer on every legal term; WCAG 2.2 AA + screen-reader + one-handed on a
mid-range Android. Add an axe a11y check to CI and "every screen states the next action, no dead ends" to
every feature's definition of done.

## When you are unsure

Leave `// TODO(counsel):` for legal questions and `// TODO(safety):` for anything touching identity,
third-party data, or evidence. Surface these in your summary rather than guessing.
