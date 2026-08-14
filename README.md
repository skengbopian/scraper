# Scraper — Phase 0 engineering repo

**Scraper (The Right to Be Forgotten)** is a Germany-first consumer data-rights platform.
This repository is the **Phase 0 ("Prove, safely")** scaffold: a small, safe, mostly-automated
loop that exercises a user's own GDPR rights against a hand-curated set of German data controllers,
captures tamper-evident proof, and escalates on statutory deadlines.

> This is a build brief for an AI coding agent (Claude Code) plus two-to-three human engineers.
> It is **not** legal advice. Every legal claim here must be confirmed with German data-protection
> and RDG counsel before anything ships. See `docs/05-legal-guardrails.md`.

> **Operating model (2026-08-14):** the launch posture is a **decentralised service** — software EU
> citizens self-host (or run for a community) to exercise their own data rights, not a central
> business. Nothing phones home; every node holds its own keys, census copy and statistics. What
> that simplifies, what it weakens, and the open counsel questions it creates are in
> [`docs/14-decentralised-deployment.md`](docs/14-decentralised-deployment.md).

## What Phase 0 is (and is not)

> **Scope is governed by [`docs/09-pivot-modules.md`](docs/09-pivot-modules.md).** Research killed the
> "scraping defence protects your Schufa" thesis; the product is now three modules — **Provenance**
> (flagship), **Fraud Shield**, **File Fixer** — on the same engine.
> [`docs/01-mvp-scope.md`](docs/01-mvp-scope.md) carries the milestone detail and the safety spine.

**The flagship (build this first):**
- **Provenance — `ACCESS_ART15_SOURCE`.** An Art. 15(1)(g) request forcing a credit bureau to name the
  source of each stored data category, then purging the broker-sourced layer. Primary targets:
  **infoscore/Experian** (its own Art. 14 notice names AZ Direct) and **Schufa** (the undefined
  "Datenlieferanten" clause). An incomplete source list is itself an escalation lever.

**The spine it runs on (also in scope):**
- Strong **identity binding** for every account (bank-ident / eID) — load-bearing for safety, not a later feature.
- A **request state machine** with the one-month statutory clock and manual Art. 77 complaint drafting.
  The clock starts **only on a provable send** — email is not proof of delivery (`CLAUDE.md` §6).
- Automated **Art. 21(2) marketing objection** (Werbewiderspruch); **Robinsonliste** enrolment as a
  suppression enrolment, not a rights request.
- **Art. 15 Datenkopie** per bureau (Schufa / CRIF / infoscore — Boniversum merged into infoscore Sep 2025).
- A **hand-curated census** of ~10–20 top German controllers (`docs/07-controllers-seed.md`).
- Email + **hybrid-letter** sending (postal API), incl. Einwurf-Einschreiben for clock-critical mail.
- An **untrusted-document parsing sandbox** (OCR + small EU-hosted LLM) — isolated from day one.
- A **tamper-evident evidence ledger** (hash-chained + qualified timestamp).
- **Usability is a launch gate** (`docs/09`): a plain UI is fine for the first working request, but the
  guided visual flows must be complete before real users are onboarded.

**Explicitly not claimed:** that scraping defence, privacy hygiene, or anything in this product raises a
Schufa score. It does not (report §5). See `docs/05` §3.

**Out of scope for Phase 0 (deferred — do not build yet):**
- Module 2 "Receipts" (canary aliases/numbers, attribution graph, public leaderboard).
- Module 4 browser extension (site grades, GPC, CRLite snapshot, OHTTP).
- Module 5 "Score Studio" beyond a single Schufa/CRIF Datenkopie *request* (no dispute engine, no simulator yet).
- L2 LLM **browser agents** for interactive forms (start L1 templates + human fallback).
- Face-search opt-outs, SpyCloud/Constella, inbox scanning, the 300-controller census.

Rationale and the full product context live in `docs/00-overview.md` and the market report
(`Scraper_Right_to_Be_Forgotten_Report.docx`, delivered separately).

## How to use this repo with Claude Code

1. Read **`PROMPT.md`** — it is the session-1 kickoff prompt (scaffold, data model, state machine,
   playbook engine). Paste it into Claude Code (or run `claude` in this dir).
2. Then **`PROMPT-FEATURES.md`** for session 2 — the leverage-ladder features (telemetry spine,
   self-serve routes, suppression enrolment, alias issuance, cheap-to-comply channel intel).
3. Then **`PROMPT-PIVOT.md`** for session 3 — the three-module restructure (Provenance / Fraud Shield /
   File Fixer), the Article 15(1)(g) provenance request, and the usable-by-any-German UX gate. This is
   the current product focus; see `docs/09-pivot-modules.md`.
4. `CLAUDE.md` is loaded automatically and holds the non-negotiable guardrails.
5. Work top-down through `docs/` in numeric order; `docs/01-mvp-scope.md` defines the first milestones.
6. Example machine-readable playbooks are in `playbooks/`; German legal text lives in `templates/`.
7. `AUDIT-2026-08-07.md` is the pre-session-1 capability and defect audit; `ARCHITECTURE-DECISIONS.md`
   is the running decision log every session appends to (its §3 lists the decisions a coding agent must
   **not** resolve on its own). `tools/spec-audit/` reproduces the audit — run `npm install && npm run all`.

## Repo layout

```
scraper/
├── README.md                  ← you are here
├── CLAUDE.md                  ← persistent guardrails for the coding agent
├── ARCHITECTURE-DECISIONS.md  ← running decision log; §3 = open questions agents must not self-resolve
├── AUDIT-2026-08-07.md        ← pre-session-1 capability & defect audit (blockers, contradictions, holes)
├── PROMPT.md                  ← copy-paste kickoff prompt (session 1: scaffold)
├── PROMPT-FEATURES.md         ← copy-paste kickoff prompt (session 2: leverage ladder)
├── PROMPT-PIVOT.md            ← copy-paste kickoff prompt (session 3: 3 modules + UX gate) — CURRENT
├── package.json               ← monorepo root scripts (pnpm -r)
├── pnpm-workspace.yaml        ← AUTHORITATIVE workspace list (pnpm ignores package.json#workspaces)
├── .env.example               ← every provider key, stubbed; no secrets in the repo
├── docs/
│   ├── 00-overview.md         ← product + market context (condensed)
│   ├── 01-mvp-scope.md        ← Phase-0 milestones and acceptance criteria
│   ├── 02-architecture.md     ← services, stack, deployment
│   ├── 03-data-model.md       ← entities and relationships
│   ├── 04-playbook-spec.md    ← the per-controller playbook format + how the engine runs it
│   ├── 05-legal-guardrails.md ← RDG, Vollmacht/QES, Art 21(2) framing, no outcome promises
│   ├── 06-security-safety.md  ← identity binding, anti-stalker, sandbox, DPIA, evidence integrity
│   ├── 07-controllers-seed.md ← Phase-0 census targets (see 09 for the pivot retarget)
│   ├── 08-leverage-ladder.md  ← non-legal routes to deletion; cheapest-rung-first doctrine
│   ├── 09-pivot-modules.md    ← CURRENT FOCUS: 3 modules, Art. 15(1)(g) provenance, usability gate
│   └── 10-utility-roadmap.md  ← PROPOSAL (2026-08-09): score/privacy impact plan, OSS leverage map
├── playbooks/                 ← example machine-readable controller playbooks (YAML), all active: false
├── templates/                 ← German legal request text (Handlebars-style variables)
├── schema/                    ← JSON Schema for playbooks + the request state machine
├── packages/
│   ├── core/                  ← domain: state machine, guards, playbook engine, subject derivation,
│   │                            evidence chain, provenance ledger. No I/O, no framework.
│   └── db/                    ← Prisma schema + the SQL invariants Prisma's DSL cannot express
├── apps/
│   ├── api/                   ← NestJS; the safety gates are framework guards, not middleware
│   └── worker/                ← durable workflows behind the WorkflowEngine interface
├── services/
│   └── doc-sandbox/           ← isolated untrusted-document parser. NO database dependency, by design
└── tools/
    └── spec-audit/            ← spec-conformance harness (audit / negative / statemachine / versions) → CI
```

## Running it

```bash
pnpm install && pnpm -r build && pnpm -r test
```

```bash
cd tools/spec-audit && npm install && npm run all
```

The four guardrail tests worth knowing about, because they are the ones that fail loudly if someone
erodes a safety property rather than merely breaking a feature:

| Test | Asserts |
|---|---|
| [`api-surface.test.ts`](packages/core/test/api-surface.test.ts) | the request API declares **no person-describing field** — adding `subjectName` fails the build |
| [`subject.test.ts`](packages/core/test/subject.test.ts) | `RequestSubject` is unconstructible outside `deriveSubject()`, at compile time *and* runtime |
| [`state-machine.test.ts`](packages/core/test/state-machine.test.ts) | `ESCALATED` has exactly one inbound edge, requiring `HUMAN_OPS`; silence on a provisional clock cannot reach an Art. 77 draft |
| [`spec-sync.test.ts`](packages/core/test/spec-sync.test.ts) | the code's transition table matches `schema/request-state-machine.md` **exactly** — spec and implementation cannot drift |
