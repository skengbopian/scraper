# PROMPT-OPERATIONAL — parallel session kickoff prompts (2026-08-15)

Four self-contained prompts, one per Claude Code session, each in its own git worktree. House
convention: this file follows `PROMPT.md` / `PROMPT-FEATURES.md` / `PROMPT-PIVOT.md` as a
copy-paste session brief. Paste the one-liner for your session, or the full section.

## Common rules — every session

1. Read `PLAN-OPERATIONAL.md` first. `CLAUDE.md` (auto-loaded) outranks it and this file.
2. First command: `pnpm install` (worktrees do not share `node_modules`).
3. **Verify every cited file:line before editing** — citations come from an audit and may have
   drifted a few lines. If a cited thing does not exist, investigate before assuming.
4. Touch only the files your session owns (PLAN §5). If a fix genuinely requires another session's
   file, leave a `// TODO(session-X):` note and record it in your summary instead.
5. Tests-first for anything touching `packages/core` state machine or playbook engine
   (CLAUDE.md convention). No session in this wave should need a transition change — if you think
   you do, stop and flag it.
6. If any task appears to weaken identity binding or a CLAUDE.md guardrail, treat it as a blocker
   and say so. Leave `// TODO(counsel):` / `// TODO(safety):` rather than guessing.
7. Definition of done, all sessions: `pnpm -r build` clean, `pnpm -r test` green (report the new
   test count), `cd tools/spec-audit && npm run all` green, plus your session-specific DoD.
8. Commit style: conventional commits, small multi-commit series with reasoning-heavy bodies
   (match `git log` house style). Commit on your branch; do not push, do not merge.
9. End with a summary: what landed, what you deliberately did not do, every TODO added, and
   anything the other sessions or the owner must know.

---

## Session A — boot, CI, and the live 500 (branch `ops/A-boot-ci`)

You are session A of a four-session parallel wave (PLAN-OPERATIONAL.md §5). Your job: make the node
bootable, persistent, and honestly tested. Everything here is decision-independent.

1. **Fix the live 500 first.** `apps/api/src/requests/requests.service.ts` — `nextActionFor` maps
   16 of the 17 states in `packages/core/src/state-machine/states.ts` and throws on
   `AWAITING_DELIVERY_PROOF`, so `GET /requests` and `GET /requests/:id` 500 for any request parked
   by a registered lodgement — the only path to a statutory Art. 12(3) clock. Add the entry
   (repo-consistent vocabulary, e.g. `AWAIT_DELIVERY_PROOF`) **and a test that iterates `STATES`
   against the map** so the two can never drift again.
2. **CI Postgres.** Add a `services: postgres:16` block to the CI workflow with `DATABASE_URL_TEST`
   and a `prisma migrate deploy` step over all 19 migration dirs — `migrate deploy`, NOT `db push`:
   the invariants under test live in the raw SQL of the migration chain. Today ~68 tests (auth,
   ops, DB-invariant, timer layers) silently skip without a database while CI reports green.
   Confirm they now execute and report the before/after counts.
3. **Boot honesty.** Refuse to boot outside development/test unless `SCRAPER_REPOSITORY=prisma`
   and `SCRAPER_SCHEDULER=pgboss`, following the allow-list doctrine already stated in the API's
   startup-safety module. `.env.example` currently ships `SCRAPER_REPOSITORY=memory` — silent
   total data loss for an operator who follows the documented setup.
4. **`.env.example` rewrite against actual reads.** Add the five `SCRAPER_*` provider seams
   (currently absent), `API_URL` (read in three places in `apps/web-next`, defaults to
   localhost:3900), `RAW_RESPONSE_RETENTION_DAYS`, `GATEWAY_MAX_SENDS_PER_CONTROLLER_PER_HOUR`;
   fix `WORKFLOW_ENGINE` → `SCRAPER_WORKFLOW_ENGINE`; delete the ~14 dead `*_PROVIDER` names and
   `STRIPE_SECRET_KEY` (non-profit pivot; billing is out). `MODEL_REGION` is the one legacy name
   that IS live — keep it. Then add a **bidirectional** spec-audit check (every var in
   `.env.example` is read somewhere; every env read by apps/ appears in `.env.example`, with a
   short named-exception list) so this cannot rot again.
5. **Readiness as a real gate.** Add DEPLOY-posture rows to `scripts/readiness.mjs` for
   `DATABASE_URL`, `SCRAPER_REPOSITORY`, `SCRAPER_SCHEDULER`. Wire readiness into CI so it
   actually executes (it is invoked by no workflow today): run it in a mode where a LEGAL-track
   FAIL breaks the build while unset-provider rows stay warnings in CI posture.
6. **`grant-ops` CLI.** Nothing in the tree writes `User.role` outside a test, so the ops queue,
   anomaly panel and delivery-proof route are unreachable on a fresh node. Build a CLI
   (`grant-ops <email>`) that works with only `DATABASE_URL`. No HTTP self-promotion route — that
   would be a privilege-escalation surface.
7. **Housekeeping.** Delete the stale tracked root `package-lock.json` (npm lockfile, divergent
   from `pnpm-lock.yaml`); fix `pnpm -r lint` (fails at `packages/db`, TS18003, no src/); add lint
   to CI.

DoD: fresh-clone CI run is green with the database tests executing; a non-dev boot with memory
repository is refused with a clear message; readiness reports the three new rows; the 500 is gone
with a drift-proof test.

---

## Session B — counsel-facing truth + the template seal (branch `ops/B-counsel-docs`)

You are session B of a four-session parallel wave (PLAN-OPERATIONAL.md §5). Your job: make the
documents counsel will be instructed from tell the truth, and build the mechanism that binds a
counsel signature to the prose it approved. **You edit no template prose** — legal wording is
counsel-only; you add metadata and tooling around it.

1. **Resolve the OQ number collision.** `docs/14` §7 assigns OQ-23..26 to four questions that
   `ARCHITECTURE-DECISIONS.md` (~lines 1084–1100) already assigned to four *different* questions —
   and the older set is cited by individual playbook rows. Renumber the docs/14 set to OQ-27..30,
   then `grep -rn 'OQ-2[3-9]'` across the repo and fix every citing site (expect hits in docs/05,
   docs/11, docs/13, docs/14, CLAUDE.md's pivot section, `scripts/readiness.mjs:81` — that last is
   a one-line comment; note it for the merge with session A). A counsel who answers "OQ-25:
   confirmed" must be answering exactly one question.
2. **Fix `docs/counsel-review-packet.md`.** It contradicts itself: §2 rows use the docs/14 OQ
   meanings while §8 and the playbook table use the ARCHITECTURE-DECISIONS meanings. It also
   records sign-off against v1 for 13 playbooks that ship v2/v3, and its az-direct row says "no
   seatDpa field declared" when the YAML now declares `seatDpa: LDI_NRW`. Regenerate §3/§4 from
   `playbooks/.shipped.json` (script it in tools/spec-audit so it stays regenerable, don't
   hand-edit).
3. **Rewrite `PRE-SEND-CHECKLIST.md` against the current tree.** It directs a reviewer to a
   `Controller.active` column, a "migration 18f" trigger, and a `pnpm dev:activate` script — none
   exist; says "45 generated playbooks" where there are 19; names env vars that appear nowhere
   else; and its "DKIM-aligned acceptance = provable send" lines directly contradict CLAUDE.md §6.
   Every mechanical claim in the rewritten checklist must be verifiable by `pnpm readiness` or a
   named test.
4. **Build the template seal** (schema in PLAN §6). Create `templates/.signoff.json` with an entry
   per template (all `status: "DRAFT"` today), where `sha256_stripped` hashes the template body
   AFTER the same `stripDocComment` transform the worker applies at dispatch — locate that
   function and hash the exact bytes that get rendered. Add a verifier to `tools/spec-audit`
   (wired into `npm run all` and readiness's LEGAL track): recomputed-hash drift or a missing
   entry FAILs; `SIGNED` requires non-null counsel + date. Today, editing a signed template would
   silently change what a sealed playbook sends with every seal still green — this closes that.
5. **Create `docs/15-entity-and-governance.md`.** The word "non-profit" appears nowhere in the
   repo. Record the pivot's undocumented half as OPEN decisions, seeded from PLAN §3 (D1–D9),
   each with owner and what it blocks; state explicitly that entity/licence/funding gate *public
   release*, not the first posture-A send. Add the docs/14 §1 scaffold line for the declared
   first-run posture with a `TODO(owner):`.
6. **Supersede the pricing.** `docs/01-mvp-scope.md` states €5–10/mo pricing at three points
   (~:16, ~:74 incl. the M3 "Subscription + billing (Stripe EU)" deliverable, ~:104). Add
   supersession notes citing the 2026-08-14/15 non-profit pivot and docs/15 — do not silently
   delete history; the repo's convention is honest supersession. (`STRIPE_SECRET_KEY` removal from
   `.env.example` belongs to session A.)

DoD: `grep -rn 'OQ-2[3-9]'` resolves every number to exactly one question; spec-audit green
including the new signoff verifier; counsel packet regenerable by script; docs/15 exists with all
nine decisions recorded as OPEN.

---

## Session C — corpus importer + activation (branch `ops/C-corpus`)

You are session C of a four-session parallel wave (PLAN-OPERATIONAL.md §5). Your job: give a real
node a corpus. Today nothing parses `playbooks/*.yaml` at runtime (`apps/api/src/common/dev-fixtures.ts:119`
states the design intent), so the `Playbook` table is empty on any real node and every request
routes `NO_ROUTE` — and docs/14's claim that activation is "a deliberate act against the node's own
database row" is currently a raw psql UPDATE against a row that does not exist.

Build a small CLI package (suggest `packages/corpus-cli`; keep it out of `apps/api`, which session
A owns). Three commands:

1. **`corpus:import`** — parse `playbooks/*.yaml`, validate against `schema/playbook.schema.json`
   with the same validator `tools/spec-audit` uses, resolve/upsert the controller rows the
   playbooks reference (investigate `apps/api/src/census/` for the census data shape — a fresh
   node needs Controller rows too, not just playbooks), upsert playbooks on the existing
   `@@unique([slug, version])`. Two non-negotiables: it writes `active: false` ALWAYS regardless
   of the YAML, and it never mutates an existing `(slug, version)` row — migration 0005's
   `playbook_freeze` will reject it and the version seal must stay green.
2. **`corpus:activate <slug>`** — prints the controller, request type, the fully rendered letter
   against a dummy subject, the bound template's signoff status + hash from
   `templates/.signoff.json` (schema in PLAN §6 — implement against the schema, session B builds
   the file), the Art. 77 venue, and the docs/14 §5.2 responsibility statement; requires the
   operator to retype the slug as confirmation; writes an auditable activation record (investigate
   the existing evidence/audit mechanisms first; an additive migration is acceptable if none
   fits); then flips exactly one row. **Refuse activation outside dev posture if the bound
   template is not `SIGNED`.** The attestation wording is counsel-owned — mark it
   `TODO(counsel):` and use honest placeholder German (the person clicking on posture A is the
   data subject; consumer register, not ops register).
3. **`corpus:deactivate <slug>`** — the kill switch, same audit record.

Write tests for all three (import idempotency, active:false enforcement, freeze-respect, refusal
paths). Verify on a dev-fixture node end to end: import 19 playbooks → all inactive → activate
`werbewiderspruch.az-direct` (dev posture, DRAFT allowed with an explicit `--allow-draft` flag
that refuses outside dev) → a request routes to it.

DoD: fresh node goes from empty tables to one deliberately-activated playbook using only the CLI;
spec-audit + version seal stay green; no `apps/api` files touched.

---

## Session D — provider seams + the worker factory (branch `ops/D-providers`)

You are session D of a four-session parallel wave (PLAN-OPERATIONAL.md §5) — the largest chunk.
Your job: build the real provider adapters and the factory, then delete the deliberate boot
refusal at `apps/worker/src/config.ts:90` **last, in the same commit as the factory that replaces
it** — never before: a stub provider records a send that never happened and destroys the user's
statutory clock. Rebase on session A's branch before touching `readiness.mjs` or `.env.example`.

1. **Object store.** Interface in `packages/core` (put/get/delete) + two adapters: filesystem
   (the honest posture-A default — the operator's own disk, EU residency by construction) and
   S3-compatible EU for postures B/C. Wire it where `apps/worker/src/main.ts` currently writes
   `unconfigured://` evidence refs, and into the purge's delete path. Change the readiness
   object-store row to probe a round-trip instead of testing that an env string is non-empty
   (today setting `OBJECT_STORE_ENDPOINT` turns a launch gate green while changing nothing).
2. **Fix the QTSP adapter defect.** `OpenapiTimestamper` returns `kind: 'QUALIFIED'`
   unconditionally while `QTSP_BASE` defaults to the TEST endpoint — a sandbox token plus a
   carrier receipt would mint a real Art. 12(3) deadline. Widen the return to `TimestampAnchor`,
   require an explicit production base, return `SIMULATED` with a reason naming the host
   otherwise, and unit-test that the test host yields `SIMULATED`. The no-QTSP degraded mode is
   genuinely built and tested — preserve it as the shipped default (owner decision D6), reachable
   deliberately via an explicit env, never by omission.
3. **A real Mailer.** None exists (`grep 'implements Mailer'` → StubMailer only). SMTP-based
   adapter with `dkimAligned` derived from a real provider signal — the email channel hard-FAILs
   an unaligned send, correctly. Domain/DNS (SPF/DKIM/DMARC) is operator configuration; document
   the required setup in the adapter's README stub.
4. **DIN 5008 letter renderer.** Today the LetterXpress adapter would base64 the rendered
   MARKDOWN as if it were a PDF, and the recipient is one flat string. Port/adapt the
   Datenanfragen `letter-generator` (MIT — check docs/10's reference) to produce PDF bytes from
   template body + structured recipient, with an enclosure path (redacted-ID copy, needed later).
   This also unblocks the posture-A manual route: an operator told to "print the letter" must not
   print Markdown.
5. **The factory, then the throw.** `apps/worker/src/providers/factory.ts` reading the five
   `SCRAPER_*` selectors, injected into the dispatch/ingest dependency builders, with a boot log
   naming each resolved adapter. Resolve the `SCRAPER_IDENTITY` question honestly: it has no
   worker-side consumer — either drop it from the worker's required list or move the seam to the
   API, with a comment saying why. Only then delete the `config.ts:90` throw, keeping the five
   positive checks above it.
6. **Template signoff at dispatch.** Once `templates/.signoff.json` exists (session B; schema in
   PLAN §6), make dispatch refuse to render a template whose status is not `SIGNED` outside dev
   posture — the runtime mirror of "production refuses stub identity". Build it tolerant of the
   file not existing yet on your branch (feature-detect, test both paths).
7. **Do NOT wire `services/doc-sandbox` into the worker yet.** `RefusingDocSandbox`'s
   confidence-0 → `NEEDS_HUMAN` is currently the only thing preventing shape-mismatched entries
   reaching the provenance ledger as INCOMPLETE-answer escalation material. It stays until the
   controller-response parser exists (phase 5+). Leave a `// TODO(session-later):` naming this.

DoD: worker boots in deploy posture with fs object store + real mailer + simulated timestamper
correctly yielding provisional-only clocks; every state-machine and guardrail test untouched and
green; a send's evidence blob verifiably exists in the object store with a matching SHA-256.
