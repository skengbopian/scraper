# PLAN-OPERATIONAL — from audited scaffold to a functioning node

**Date:** 2026-08-15 · **Derived from:** the 15-agent deployment audit run against branch
`audit/2026-08-13` (clean, suite 484/0, spec-audit 76 green). **Authority:** this file plans; it
overrides nothing. `CLAUDE.md` outranks everything here. Companion: `PROMPT-OPERATIONAL.md`
(copy-paste kickoff prompts for parallel sessions A–D).

## 1. Where we are (verified against the tree, 2026-08-15)

The engine is real: the 17-state machine is spec-synced, the branded `RequestSubject` and
`ProvableSendEvidenceId` hold, crypto-shred erasure works end to end, 26 SQL invariants ship in 19
migrations, and the §6 two-clock rule holds *empirically* — a simulated registered send is refused
with `SIMULATED_ANCHOR` and sets no clock.

The perimeter is not built. Three independent hard stops, each alone reducing real sends to zero:

1. **No production path to `VERIFIED`.** The only writer sits behind `DevOnlyGuard`;
   `IdentityVerifiedGuard` blocks request creation.
2. **No Mandate route.** `runGuards` requires a live in-scope Mandate; the only writer is the dev seed.
3. **No playbook loader.** Nothing parses `playbooks/*.yaml` at runtime
   (`apps/api/src/common/dev-fixtures.ts:119` states this by design); the `Playbook` table is empty
   on a real node → every request routes `NO_ROUTE`.

Plus: the worker refuses any non-dev boot **by design** (`apps/worker/src/config.ts:90`) until a
provider factory exists — that throw is correct and comes out only in the same commit as the factory.
One live bug: `apps/api/src/requests/requests.service.ts` `nextActionFor` maps 16/17 states and
throws on `AWAITING_DELIVERY_PROOF` → a 500 on the only path to a statutory clock.

The pivot's decentralised half is documented (`docs/14`); the **non-profit half is documented
nowhere** — no entity, no funding model, no governance, and **no LICENSE file**, which under default
copyright makes the entire "citizens self-host this" launch model unlawful to distribute today.
`docs/01-mvp-scope.md` still prices at €5–10/mo in three places including an M3 Stripe deliverable.
The counsel gate is unenforceable as built: no template body is hashed anywhere; the worker resolves
the letter by filename at dispatch and strips the DRAFT header before rendering.

## 2. Definition of "operational" (the first-real-send gate)

One real, identity-verified human — realistically the product owner on their own posture-A node —
creates and sends **one Art. 21(2) objection to AZ Direct by email**, landing in
`AWAITING_RESPONSE_PROVISIONAL` with `provisionalDeadlineAt` set and `statutoryDeadlineAt` NULL.
For that to be true and not theatre: Postgres with all migrations and `SCRAPER_REPOSITORY=prisma`;
worker boots via a real provider factory; DKIM-aligned mailer; object store actually holding the
rendered copy the evidence chain hashes; a production identity path with a real `providerRef`; a
live Mandate covering `OBJECTION_ART21`; a counsel signature bound to a **hash** of the template
body; the endpoint verified against the live Datenschutz page; the playbook imported and activated
by a recorded human act; an Art. 13 notice served at registration; `readiness.mjs` green in DEPLOY
posture.

**Explicitly not included:** any statutory clock (email cannot start one, by design), escalation on
silence, Art. 15/Provenance (needs the IdentityPacket + three counsel answers), processing the
controller's *reply* (ingest currently enqueues `bytes: []`), a second user, or public release.

## 3. Decision register — owner only (record answers in docs/15)

| # | Question | Recommendation | Blocks | Due |
|---|---|---|---|---|
| D1 | Identity artefact on posture A | German eID / AusweisIDent (§18 PAuswG) — the only route an individual can procure; POSTIDENT/IDnow B2B needs a legal entity | Gates 7–9; longest procurement lead after counsel. **Largest unowned risk: if eID is not procurable by a private person, posture A as written is unshippable** | this week |
| D2 | Entity now, or posture A as a private individual first | (b) — first send as natural person; entity blocks public release/posture B/money, not the first letter (~2 months saved by sequencing) | licence licensor, Impressum, DPIA controller, AVVs, RDG §6/§7 route | this week |
| D3 | Licence | AGPL-3.0 for the app; CC0/CC-BY for `playbooks/` + `templates/`; THIRD-PARTY-NOTICES + Datenanfragen CC0 attribution | any public release — no LICENSE = unlawful to run | before publishing |
| D4 | Does money ever move (incl. Verein dues) | Never / donations only; strike or supersede the three €5–10/mo statements in docs/01 before counsel is instructed | RDG instruction scope, §52 AO category, whole consumer-contract workstream | before counsel brief |
| D5 | First letter | `werbewiderspruch.az-direct` by email, provisional clock — the only playbook with no blocking OQ; `identityProof.required: false` sidesteps the IdentityPacket | scope + cost of first counsel instruction | this week |
| D6 | QTSP | Degraded-but-honest mode as shipped default (built + tested both paths); procure an account only for the node you run | postal workstream shape, UI clock copy, Art. 77-on-silence scope | with counsel brief |
| D7 | Mandate form on posture A | Recorded in-app confirmation + evidence hash (docs/14 already argues it); QES per self-hoster is not procurable | mandate route build (gate 7) | with counsel brief |
| D8 | Backup retention number | 7 days as compose env var; KEK on separate media, never beside the DB dump | DPIA signature, erasure-confirmation copy, operator guide | before DPIA sign-off |
| D9 | apps/web prototype | Keep briefly as design source for dial/map/countdown, port to web-next, point the a11y gate at web-next, then delete | usability gate pointing at the right artefact; packaging | with UX work |

## 4. Phases

| Phase | What | Owner | Effort / elapsed |
|---|---|---|---|
| 0 | **Parallel engineering, decision-independent** — sessions A–D (see §5) | eng | A: 2–4d · B: 2–3d · C: 3–5d · D: 3–4wk |
| 1 | Owner decisions D1–D9; declare posture/operator/money in docs/14 §1 + docs/15 | owner | hours; D1 procurement starts immediately |
| 2 | **Counsel instruction** — the long pole; brief the day session B lands. First target scoped small: art21 template sign-off + az-direct endpoint verification + RDG opinion (3 questions) + mandate form + Art. 13 notice + Art. 30 ROPA template + per-seam AVV checklist | counsel | weeks–months elapsed; cash |
| 3 | Identity + mandate surfaces (verify route, provider webhook — the most security-critical route in the product — screens, mandate create/revoke, re-verification) | eng | 2–3wk after D1 |
| 4 | Corpus activation + **first real send** (phase-0 tooling + counsel returns + readiness green) | owner | days |
| 5 | **The 30-day fuse:** provable-send path — az-direct declares `onDeadlineExpiry: DRAFT_ART77` and invariant 4b refuses escalation on a provisional clock, so postal/manual proof + delivery-proof UI + Art. 77 artefact must land within ~30 days of phase 4 | eng + counsel | 3–4wk; commission in the same counsel brief as phase 2 |
| ∥ | **Public-release track** (parallel; gates release, not first send): LICENSE (D3), Docker/compose packaging, docs/15 operator guide, SECURITY.md + disclosure, DPIA rewrite against real processing, usability gate on web-next, versioning/signed releases, ingest/reply half of the pipeline | eng + owner | weeks |

Rough total: **10–12 engineering weeks, mostly parallel, inside 3–4 months elapsed** — dominated by
counsel latency and D1 procurement, which engineering cannot compress.

## 5. Parallel session map (one git worktree per session — never share a working directory)

| Session | Branch | Owns (exclusive) | Notes |
|---|---|---|---|
| A — boot, CI, live 500 | `ops/A-boot-ci` | `.github/workflows/**`, `scripts/readiness.mjs`, `.env.example`, `apps/api/src/requests/requests.service.ts` (+ its test), API boot guards (`startup-safety`), grant-ops CLI, root `package-lock.json` (delete), `packages/db` lint config | merges **first** — everyone benefits from CI Postgres |
| B — counsel-facing truth + template seal | `ops/B-counsel-docs` | `docs/**`, `CLAUDE.md` (OQ refs only), `PRE-SEND-CHECKLIST.md`, `templates/.signoff.json` (new — **no prose edits to templates**), signoff verifier in `tools/spec-audit`, counsel-packet regeneration, `docs/15` (new) | one-line OQ comment fix in `scripts/readiness.mjs:81` — coordinate with A at merge |
| C — corpus importer + activation | `ops/C-corpus` | new CLI package (suggest `packages/corpus-cli`), additive Prisma migration if an attestation record needs a table | reads the `.signoff.json` schema from §6, not from B's branch |
| D — provider seams + worker factory | `ops/D-providers` | `apps/worker/**`, `packages/core/src/providers/**` | rebase on A before touching `readiness.mjs`/`.env.example`; delete the `config.ts:90` throw **last, same commit as the factory** |

Merge order into `audit/2026-08-13`: **A → B → C → D.**

## 6. Cross-session interface: `templates/.signoff.json`

Both B (creates + verifies) and C (consumes at activation) implement against this shape — defined
here so neither waits on the other:

```json
{
  "art21-werbewiderspruch.de.md": {
    "status": "DRAFT",
    "sha256_stripped": "<hex of the template body AFTER stripDocComment — the exact bytes the worker renders>",
    "counsel": null,
    "signedAt": null
  }
}
```

Rules: every file in `templates/*.md` must have an entry; the verifier recomputes
`sha256_stripped` and FAILs on drift or a missing entry; `status: "SIGNED"` requires non-null
`counsel` + `signedAt`; `corpus:activate` refuses a playbook whose bound template is not `SIGNED`
outside dev posture. This is what makes a counsel signature bind to prose instead of to a filename.

## 7. What no session may build (standing guardrails, restated)

No cross-node lookup, shared identity registry, aggregation, or phone-home (docs/14 §3 — verified
clean today; keep it that way). No weakening of identity binding — if a task appears to, it is a
blocker to flag, not a call to make. Imported playbooks are **always** `active: false` regardless of
YAML. Never mutate an existing `(slug, version)` playbook row. No free-text subject fields. Template
prose changes are counsel-only. State-machine changes (e.g. the manual-postal inbound edge) are
tests-first and deferred to phase 5.

## 8. Risks this plan does not remove

- **D1 may have no purchasable answer** for a private individual — resolve before building gate 7.
- Counsel cost/latency is the real schedule, and the non-profit's funding for it is undecided (D4).
- The reply half of the pipeline (ingest `bytes: []`, no inbound channel, no parser) is deliberately
  sequenced after first send — but a correlated-but-not-ingested reply lets the timer draft an
  Art. 77 complaint alleging silence against a controller that answered. It must land before the
  first reply is *expected*, i.e. within ~a month of phase 4.
