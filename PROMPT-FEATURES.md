# Session 2 kickoff prompt — build the leverage-ladder features

Use this **after** the session-1 scaffold from `PROMPT.md` exists (monorepo, Prisma schema,
RightsRequest state machine, playbook engine). Paste the fenced block into Claude Code.

```
You are continuing work on "Scraper". The Phase-0 scaffold exists: monorepo, Prisma data model, the
RightsRequest state machine, and the playbook engine. This session implements the LEVERAGE LADDER —
the non-legal routes to getting a company to delete a user's data.

Read docs/08-leverage-ladder.md in full first, then re-skim docs/03-data-model.md,
docs/04-playbook-spec.md, docs/05-legal-guardrails.md and docs/06-security-safety.md. CLAUDE.md still
governs everything.

The doctrine, so your design choices follow from it: consumer welfare is not deletion count. Legal
requests are expensive artillery reserved for high-harm data. Most welfare comes from prevention, from
industry suppression files, from the company's own off-switches, and from making compliance cheaper
for the controller than refusal. Always take the cheapest rung that achieves the outcome.

Build in this order — each step ships working before the next starts:

1. TELEMETRY SPINE FIRST. Add the LeverageAction entity (userId, controllerId?, tier 0-5|LEGAL,
   mechanism enum, costCents, outcome, verifiedAt?, evidenceRecordId?) plus a rollup query for
   "verified outcomes per euro, by tier". Wire it so that every user-visible action in the product —
   including failures — writes exactly one LeverageAction. This is the metric the business steers by,
   so honest cost accounting matters more than flattering numbers.

2. TIER 1a — SELF-SERVE ROUTE DIRECTORY. Add the SelfServeRoute entity per docs/08. Build the guided
   handoff flow: deep-link the user into a company's own deletion page / marketing preference centre /
   "do not sell" toggle, with an ordered checklist and a "did it work?" confirmation that records the
   outcome. Auto-fill only where a public unauthenticated form exists. Add the lastVerifiedAt staleness
   re-check job. Seed ~30 German consumer services.
   HARD RULE: never collect, store, or use third-party credentials, and never log into a user's account
   on their behalf. Routes requiring login stay guided. If you find yourself designing credential
   storage, stop and raise TODO(safety).

3. TIER 1b — SUPPRESSION ENROLMENT. Add SuppressionProgram + SuppressionEnrolment. Implement one-click
   enrolment across DDV Robinsonliste, DAA/Your Online Choices, NAI, and postal/telephone preference
   equivalents, with expiry tracking and a renewal job (silent lapse = silent welfare loss). These are
   voluntary industry programmes, not legal demands — no mandate required.

4. TIER 0 — ALIAS ISSUANCE (prevention). Add the Alias entity. Ship email aliases on Scraper-controlled
   domains with forwarding and one-click burn. Own this primitive; do not depend on a third-party alias
   vendor. Phone/card/postal are later vendor integrations — stub the interfaces.
   HARD RULE: enforce at the API level (a required context flag, not just UI copy) that aliases cannot
   be issued for legal, financial, credit, insurance, or government identity contexts — GDPR Art 5(1)(d)
   accuracy duty.

5. TIER 2 — MAKE "YES" CHEAP. Add ControllerChannelIntel to the census: verified DPO/privacy intake
   address, preferred format, the identity-proof packet the controller actually accepts, response norms,
   whitelistStatus. Build the pre-verified identity packet (minimal proof derived from the verified
   Identity, redacted ID only where genuinely required) and attach it at send time. Track per-controller
   cost and yield. Leave a documented extension point for a future standard intake/API that a broker
   could adopt.

6. CHEAPEST-RUNG-FIRST ROUTING. Modify the Erasure Machine so that before generating a legal request it
   checks for an available Tier 0/1 route achieving the same outcome and prefers it, recording the
   decision. Add tests proving a legal request is not generated when a self-serve route exists.

Do NOT build this session: the Tier 3 public scoreboard, journalist pipeline or aggregate nudges
(Phase 2, counsel-reviewed, facts-only); the canary attribution graph or spam monitoring (issuance only
for now); any automated authenticated session, credential storage or CAPTCHA-solving; Tier 5 negotiated
arrangements (business development, not code).

Work in small reviewed steps. Write tests for the guardrails as guardrails — an alias issued into a
financial context and a stored third-party credential should both be unrepresentable, not merely
discouraged. When done, update ARCHITECTURE-DECISIONS.md and give me: (a) the tier-by-tier cost/yield
model your telemetry now makes measurable, and (b) anything you had to assume that a human should verify.

Start by showing me the schema additions and the cheapest-rung-first routing logic for review before
implementing the rest.
```

## Why this order

Telemetry first because it is the only way to know which rung earns its keep. Then the two rungs with
the best welfare-per-engineering-hour (self-serve routes and suppression enrolment), which need no
mandate, no identity friction and no counterparty agreement. Then prevention, which is cheap and
compounding. Then the Controller Gateway work, which lowers the unit cost of every future deletion.
Legal escalation stays where it belongs — last, and reserved.
