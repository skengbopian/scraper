# 08 — The leverage ladder (non-legal routes to deletion)

**Operating doctrine.** Consumer welfare is not the same as deletion count. Legal instruments
(Art. 17 / 21 / 77) are artillery — powerful, slow, expensive — and belong to high-harm data only.
Most welfare is created *before* any letter is sent. A company deletes without a lawyer in the loop when
one of four conditions holds:

1. complying is cheaper than refusing,
2. refusing costs them reputation,
3. the user pulled one of *their own* off-switches, so there is nothing to refuse,
4. the record has rotted into junk their own hygiene prunes.

Every rung engineers one of those. **Always take the cheapest rung that achieves the outcome.** The
full rationale is section 8 of the market report; this file is the build spec.

## The ladder

| Tier | Mechanism | Marginal cost (est.) | Build surface |
|---|---|---|---|
| 0 · Prevent | alias email, masked number, virtual card, maildrop on new signups | <€0.10/user/mo | alias service + Copilot signup guardian |
| 1 · Suppress | Robinsonliste, DAA/NAI/YOC, consent withdrawal, ad-ID reset, GPC, **company self-serve deletion & preference centres** | cents; directory built once | `SelfServeRoute` directory + suppression playbooks |
| 2 · Cheap yes | correct DPO routing, pre-verified identity packet, per-controller preferred format, whitelisted agent channel, eventual API | one-time per controller | Controller Gateway + `ControllerChannelIntel` |
| 3 · Reputation | facts-only scoreboard, journalist pipeline, aggregate demand nudge | ≈free once ledger exists | *(Phase 2 — not now)* |
| 4 · Degrade | redirect future flow to owned channels, restriction/correction flag, canary salting | pennies | alias service + Erasure Machine |
| 5 · Collective | aggregated demand → broker-built self-serve intake, standing arrangements | negative at scale | business development + census |
| Legal | Art. 17/21 escalation, Art. 77 complaint | €5–15 per contested postal action | Erasure Machine L4 — **reserved** |

## What to build now (Phase 0.5), in order

### 1. Tier telemetry spine — build FIRST, everything else reports into it
Without this you cannot tell which rung is protecting welfare per euro, which is the whole point.

- New entity **`LeverageAction`**: `id`, `userId`, `controllerId?`, `tier` (0–5 | LEGAL),
  `mechanism` (enum, e.g. `ALIAS_ISSUED`, `SELF_SERVE_COMPLETED`, `SUPPRESSION_ENROLLED`,
  `CONSENT_WITHDRAWN`, `REQUEST_SENT`, `ESCALATED`), `costCents` (est. or actual), `outcome`
  (`SUCCEEDED | FAILED | PENDING | UNVERIFIABLE`), `verifiedAt?`, `evidenceRecordId?`.
- Rollup view: **outcomes per euro, per tier** — this is the number the business is steered by.
- Acceptance: every user-visible action in the product writes exactly one `LeverageAction`.

### 2. Tier 1a — Self-serve route directory (highest yield per engineering hour)
The single highest-success, lowest-conflict action: use the company's own deletion page / "do not
sell or share" toggle / marketing preference centre. Nothing for them to refuse.

- New entity **`SelfServeRoute`**: `companySlug`, `routeType`
  (`ACCOUNT_DELETION | MARKETING_PREFS | DO_NOT_SELL | AD_ID_RESET | CONSENT_WITHDRAWAL`),
  `url`, `steps[]` (ordered human-readable instructions), `requiresLogin` (bool),
  `estMinutes`, `lastVerifiedAt`, `verificationMethod`, `successRate`.
- UX: **guided handoff** — deep-link the user into the route with a checklist and a "did it work?"
  confirmation that writes a `LeverageAction`. Auto-fill only where a public form exists.
- **GUARDRAIL (security, non-negotiable):** do NOT collect, store, or use the user's credentials for
  third-party sites, and do not log into accounts on their behalf. Guided handoff is both cheaper and
  safer than automating an authenticated session. If a route requires login, it stays guided. Flag any
  proposal to store third-party credentials as `TODO(safety)` and stop.
- Seed with the top ~30 German consumer services (see `docs/07` targets + major e-commerce, loyalty
  schemes, telcos, utilities). Staleness kills this asset — build the `lastVerifiedAt` re-check job now.

### 3. Tier 1b — Suppression-programme enrolment
Industry self-regulation the brokers voluntarily ingest. These are *not* legal demands, so they need
no mandate and no identity friction beyond what the programme itself asks.

- New entity **`SuppressionProgram`** (`slug`, `name`, `jurisdiction`, `channel`, `renewalMonths`)
  and **`SuppressionEnrolment`** (`userId`, `programId`, `state`, `enrolledAt`, `expiresAt`).
- Seed: DDV **Robinsonliste** (DE), **DAA / Your Online Choices** (EU ad opt-out), **NAI** (US-origin
  but honoured broadly), telephone/postal preference equivalents.
- Add a **renewal job** — several programmes lapse; a silent lapse is a silent welfare loss.
- Acceptance: one-click enrolment across all applicable programmes, with expiry tracking.

### 4. Tier 0 — Alias issuance (prevention)
Prevention is the cheapest welfare in the product and should not wait for the full Receipts module.
**Split the module:** issuance ships now; the attribution graph stays deferred to Phase 2.

- New entity **`Alias`**: `userId`, `type` (`EMAIL | PHONE | CARD | POSTAL`), `value`,
  `issuedForCompany?`, `state` (`ACTIVE | BURNED`), `createdAt`.
- Ship email aliases on Scraper-controlled domains first (own the infrastructure — do not depend on a
  third-party alias vendor for a core primitive). Phone/card/maildrop are vendor integrations, later.
- Forwarding + one-click **burn**. Burning an alias is itself a Tier-4 degradation action.
- **GUARDRAIL (legal):** aliases are for marketing/commercial signups. Never present them for legal,
  financial, credit, insurance, or government identity contexts — accuracy duty, Art. 5(1)(d).
  Enforce with a context flag in the issuance API, not just UI copy.

### 5. Tier 2 — Make "yes" cheap (Controller Gateway extension)
Refusals cluster on friction and misrouting. Remove it *on the controller's side*.

- Extend `Controller` with **`ControllerChannelIntel`**: verified DPO/privacy intake address,
  preferred format (`email | web_form | portal | api`), the identity-proof packet they actually accept,
  known response norms, `whitelistStatus` (`NONE | KNOWN_SENDER | AGENT_AGREEMENT | API`).
- Build a **pre-verified identity packet**: a minimal, consistent proof bundle derived from the verified
  `Identity` (redacted ID where required, nothing more), attached at send time so the controller's
  agent never has to ask.
- Track **per-controller cost-and-yield** so the census learns which framing gets actioned fastest.
- Long game (not code yet, but design the seam): a standard intake/API a broker can adopt so *they*
  automate their side. Log it as an architectural extension point.

## Explicitly NOT in this phase
- Tier 3 public scoreboard, journalist pipeline, aggregate nudges → Phase 2, and only facts-only,
  counsel-reviewed (`docs/05` §7).
- Canary attribution graph, spam/leak monitoring → Phase 2 (issuance only, for now).
- Any automated login to third-party accounts, credential storage, or CAPTCHA-solving services.
- Tier 5 negotiated arrangements — business development, not engineering.

## Guardrails summary (enforce as code, not comments)
1. No third-party credential collection or automated authenticated sessions. Guided handoff only.
2. Aliases blocked in legal/financial/government identity contexts by an explicit API-level context flag.
3. Tier 4 degradation redirects real flow to user-owned channels; it **never** submits false identity,
   address, or financial data.
4. Every action writes a `LeverageAction` with an honest `costCents` — including failures. Under-reporting
   cost corrupts the only metric that steers spend.
5. Cheapest-rung-first: the Erasure Machine must check for an available Tier 0/1 route *before*
   generating a legal request for the same outcome, and prefer it.
