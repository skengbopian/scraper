# Alpha audit + build report — 2026-08-11

Product-owner ask: audit the current product, automate/implement what the plan still owes, adopt
competitive open source, and reach **a working alpha for effective testing before launch**. Method:
12 structured audit/research passes (6 repo areas, 6 OSS domains; full results in the session
journals), then implementation the same day. Decisions recorded in **ADR-028**; this file is the
narrative summary and the remaining-gap list.

## 1. What the audit found (state before this pass)

- The pure core is the crown jewel and was protected, not rebuilt: 16-state machine with the
  provable-clock structure, guards, idempotency-with-cycles, playbook engine, evidence chain,
  provenance logic — 164/164 tests, spec-synced both directions, spec-audit harness green
  (46 checks, 28 negative fixtures).
- **Nothing served HTTP.** The NestJS API had never booted: pnpm/corepack was broken in the build
  sandbox (now fixed via `npx pnpm`), `@nestjs/platform-express` was missing, nothing populated
  `req.identity` (fail-closed 403 everywhere), the dev seed had no mandate and no active-playbook
  markers (LEGAL unreachable), no list endpoint, no dispatch step, no CORS.
- The web alpha was a client-side portrait of the engine (own seed, no fetch), with a countdown that
  displayed a statutory label for what a real send would only justify as provisional.
- Discovery: the machine also runs a **sibling Next.js Scraper app** (`~/Downloads/scraper`, port
  3000) — the brand source of truth (trowel mark, accent `#6D28D9`). This repo's alpha page now
  mirrors those tokens exactly.

## 2. What was built (all verified live)

| Item | Where | Proof |
|---|---|---|
| API boots; census + Vorgänge + simulate endpoints | `apps/api` | 11 HTTP e2e tests; manual curl journey |
| Dev-fixture identity/mandate, hard-gated | `apps/api/src/common/dev-fixtures.ts` | refuses `NODE_ENV=production`; fixtures-off suite asserts 403/404 |
| Simulated lifecycle on the REAL machine (email ⇒ provisional clock; registered ⇒ statutory; respond/expire/escalate; drafts never send) | `simulate.controller.ts` | e2e asserts clock semantics + 409 on illegal jumps |
| Invariant-1 fix: resend re-runs guards | `requests.service.ts` | e2e chase-path test |
| CC0 census import (datenanfragen.de), provenance retained | `tools/census-import` → generated snapshot | 12/15 records, quality tiers kept; import ≠ activation |
| Web wired live with offline fallback | `apps/web/index.html` | headless shots: live pipeline, both clocks visually distinct |
| doc-sandbox envelope tests | `services/doc-sandbox/test` | 6/6 (injection ⇒ confidence 0) |
| axe a11y gate (docs/09 CI item) | `tools/a11y` + `alpha-ci.yml` | 13 scans green after fixing 9 real contrast violations (semantic ink tokens from the original app) |

Suites: core 164 · api 11 · doc-sandbox 6 · spec-audit 46 checks — all green.

## 3. OSS adopt / defer / reject (licenses verified)

**Adopted:** datenanfragen/data (CC0-1.0), Playwright (Apache-2.0), axe-core + @axe-core/playwright
(MPL-2.0, dev-only), OSIRAA simulated-counterparty *pattern* (Apache-2.0).
**Decided for next phase:** pg-boss (MIT) as interim WorkflowEngine — OQ-12 input; Temporal (MIT)
production target; pdfjs-dist + OCRmyPDF (Ghostscript-free build) for P1.5 ingest; wKovacs64/hibp
(MIT) behind `BreachMonitor` (HIBP CC-BY-4.0 + OQ-16 transfer gate; XposedOrNot fallback); Mozilla
Monitor removal-status model + DRP v1.0 as projection vocabulary (patterns only).
**Rejected:** BADBOOL (CC BY-NC-SA), your-digital-rights/data-brokers (GPL-on-data, stale), pa11y-ci
(LGPL, non-axe engine), unstructured (open-core/US pull), SimpleLogin/addy.io in the alpha (AGPL
isolation + mail-ops; post-alpha, self-hosted unmodified only). Details + reasoning: ADR-028.

## 4. What still stands between this alpha and launch (ordered)

1. **Real auth + Prisma adapter + `0000_init` migration** (P0): sessions, email+TOTP, the
   `RequestsRepository` Prisma implementation, deployable migration chain. The in-memory alpha is
   deliberately not a persistence story.
2. **BYO-Datenkopie ingest (P1.5)** — the roadmap's same-day-utility flagship: upload → identity-match
   gate → CoC rules engine → findings. The doc-sandbox envelope and the chosen parsers are ready.
3. **Real providers behind the existing interfaces** (P1): LetterXpress postal, QTSP timestamps,
   POSTIDENT ident, Mistral-EU parsing — all counsel/contract-gated, none alpha-blocking.
4. **Workflow runner** (pg-boss per OQ-12) so deadline expiry fires from timers instead of the demo
   button.
5. **Counsel workstream** (unchanged, blocks sends, not builds): template sign-offs, playbook
   activation one at a time, OQ-7..22.
6. **Usability gate residue** (docs/09): the manual accessibility passes (screen reader, one-handed,
   mid-range Android), user-action-flow diagrams per module, and the report-§13 name user-test.
7. **Repo unification question for the owner:** this engine repo and the sibling Next.js product app
   should converge (the Next.js app is the production UI target per ADR-027) — decide which repo owns
   what before P0 auth work starts.

## 5. How to run the alpha

```bash
npx pnpm@9.15.9 install && npx pnpm@9.15.9 -r build
SCRAPER_DEV_FIXTURES=1 node apps/api/dist/main.js   # API on :3900
open apps/web/index.html                             # auto-connects; offline = standalone demo
```

Tester journey: Firmen → AZ Direct → „Anfrage vorbereiten" → Vorgänge: provisional clock (amber,
"E-Mail ist kein Zustellnachweis") → Demo: „Frist ablaufen lassen" → „Einschreiben beauftragen" →
statutory clock (violet) → Antwort simulieren → ggf. Beschwerde-Entwurf (Versand: nur Ops, kein
Button existiert).
