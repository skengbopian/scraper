# Spec-audit harness

Produced the findings in `AUDIT-2026-08-07.md`, and now gates every change via
`.github/workflows/spec-audit.yml`. Run from this directory:

```bash
npm install && npm run all
```

| Script | Checks |
|---|---|
| `audit.mjs` | every shipped playbook through the **full gate** (schema + semantic lints); template existence and orphans; doc cross-references; controller-slug consistency vs the census; `requestType` enum agreement between `docs/03`, the schema and `docs/09`; the three-way agreement of the C1 clock rule across `CLAUDE.md`, `docs/05` and the state machine |
| `negative.mjs` | 28 playbooks that must never be sendable, run through the full gate |
| `statemachine.mjs` | transcribes `schema/request-state-machine.md` as a graph; dead-end and reachability analysis; **anti-journeys** (paths that must NOT exist); asserts `ESCALATED` has exactly one, human-gated, inbound edge |
| `version-check.mjs` | `docs/04`'s "never mutate a shipped version" rule, against the `playbooks/.shipped.json` lockfile |
| `env-check.mjs` | `.env.example` against what the code reads, **both directions**: nothing declared that no code reads, nothing read that the file does not declare |
| `oq-check.mjs` | one OQ number, one question: no number defined in two registers, no number cited that resolves to none |
| `signoff-check.mjs` | the template seal: every letter still hashes to the prose recorded in `templates/.signoff.json`, and `SIGNED` means a named counsel on a date |
| `counsel-packet.mjs` | §3/§4 of `docs/counsel-review-packet.md` still describe the corpus. `--write` regenerates the derived columns; the human ones are never touched |
| `db-invariants.mjs` | the migration chain still declares every constraint and trigger the safety spec relies on |
| `playbook-lint.mjs` | shared module: the semantic invariants JSON Schema **cannot** express. Not a script |
| `root.mjs` | repo root, derived from the script location; override with `SCRAPER_ROOT` |

All scripts exit non-zero on failure.

## Two things that are easy to get wrong here

**1. The schema is not the whole gate.** Three classes of defect are structurally beyond JSON Schema:
cross-field value comparison (do `compliedIf` and `refusedIf` match the same string?), anything needing
the filesystem (does the bound template render a variable `subjectFields` doesn't supply?), and anything
needing history (was a shipped version mutated?). Those live in `playbook-lint.mjs` and are enforced by
the same CI job. `validatePlaybook()` is the entry point — **calling Ajv on its own is not validation.**

**1b. `env-check.mjs`'s indirect list is checked, and must stay that way.** Some variables are read
through a helper, an array of selector names, or a template string, where no regex over `env.NAME`
can see them. Those live in `INDIRECT_READS`, and each entry names a `probe` — text that must still
appear in non-test source. Deleting the read fails the check instead of quietly keeping a dead
variable alive. An exception list nothing verifies is just a second thing to rot; do not add an entry
without a probe that would break if the read went away.

**2. `negative.mjs` can pass while testing nothing.** Every case is the `base` fixture mutated in one
way. If `base` itself becomes invalid — which is exactly what happened when `kind` and `active` became
required — then every case is rejected for that reason instead of its own, and the file reports a
triumphant `0 holes` while exercising not one defect. The **BASE SELF-CHECK** at the top of the run
exists solely to catch this and must not be removed. If you add a required field to the schema, add it
to `base` in the same commit.

## Sealing templates

`templates/.signoff.json` records `{filename: {status, sha256_stripped, counsel, signedAt}}`. The hash
is over the body **after `stripDocComment`** — exactly the bytes `render()` starts from — so a counsel
signature binds to the letter's prose rather than to its filename. Before this, editing a signed
template silently changed what a sealed playbook sends: the worker resolves the letter by filename at
dispatch, and every other seal in the repo stayed green.

```bash
npm run signoff          # verify: does every letter still say what was signed?
npm run seal:templates   # record the current bodies (hashes only — never invents a signature)
```

Signing a template is two edits in one commit: set `status: "SIGNED"` with the counsel's name and
date, and delete the `DRAFT` marker from the file's header. The header is outside the hash (an
engineer must be able to fix a typo in documentation without invalidating a legal signature), so the
verifier cross-checks the two: `SIGNED` with the marker still present FAILs, and so does `DRAFT` with
the marker deleted.

**`--seal` refuses to re-seal a SIGNED template whose prose changed.** Rewriting the hash under a
status that still says SIGNED would turn this tool into the laundry — edit, seal, every gate green
over wording no lawyer has read. Revert the edit, or downgrade the entry to `DRAFT` (visible in the
diff, and it re-blocks activation and dispatch) and take it back to counsel.

## Sealing playbook versions

`playbooks/.shipped.json` records `{slug: {version, sha256}}` for every playbook. The hash is over the
*parsed and re-serialised* document, so comment and whitespace edits are not semantic changes.

```bash
npm run versions   # check: did anyone mutate a shipped version in place?
npm run seal       # record the current tree as shipped
```

Sealing is deliberate — it is the moment you assert "this content is what version N means, forever".
`--seal` refuses to run over an integrity failure (a mutation or a backwards version), because sealing
would launder it into the record. It *will* rewrite a malformed lockfile, since that is what it is for.

## Status

Definition of done for step 3 of the audit's recommended sequence, both met:

- `negative.mjs` → `0 of these are cases the validation stack MUST have rejected and did not`
- `statemachine.mjs` → `0 structural problems`

Verified as load-bearing rather than vacuous: weakening any single schema constraint (e.g. making
`humanReviewIfConfidenceBelow` optional again) makes `negative.mjs` exit 1 and fails CI.
