# @scraper/corpus-cli

Give a node its corpus, and make activating a letter a deliberate, recorded human act.

```bash
DATABASE_URL=… pnpm --filter @scraper/corpus-cli corpus:import
DATABASE_URL=… pnpm --filter @scraper/corpus-cli corpus:status
DATABASE_URL=… SCRAPER_ACTOR="Erika Musterfrau" pnpm --filter @scraper/corpus-cli corpus:activate werbewiderspruch.az-direct
DATABASE_URL=… SCRAPER_ACTOR="Erika Musterfrau" pnpm --filter @scraper/corpus-cli corpus:deactivate werbewiderspruch.az-direct --reason "…"
```

Needs only `DATABASE_URL`. No KEK, no CORS list, no provider seams — an operator standing a node up
has to be able to give it a corpus before the rest of the environment exists.

## Why this package exists

Nothing parsed `playbooks/*.yaml` at runtime. The API says so in its own comment (it should not carry
a YAML dependency for a dev fixture), and there was no other route in — so on any node not running dev
fixtures the `Playbook` table was **empty**, every request routed `NO_ROUTE`, and `docs/14`'s claim
that activation is "a deliberate act against the node's own database row" described a `psql UPDATE`
against a row that did not exist.

## import

Parses, validates through **`tools/spec-audit`'s validator** — the same entry point CI uses, loaded by
path, so a corpus cannot pass CI and be rejected here or the reverse — then upserts the controllers the
playbooks reference and creates the playbook rows.

- **`active: false`, always, whatever the YAML says.** Import is not activation.
- **An existing `(slug, version)` row is never mutated.** A changed document at the same version is a
  refusal, not an update (`docs/04`; migration 0005 `playbook_freeze`).
- **Re-import never deactivates** what an operator deliberately activated.
- **Atomic**: everything is decided read-only first; a validation error or a frozen-version violation
  writes nothing at all.

Two kinds of playbook are **skipped and reported**, never silently absent:

| Skipped | Why |
|---|---|
| `loeschung.generic-*` | parameterised stencils — cloned per controller, never activatable (ADR-018) |
| `loeschung.hireright`, `explanation.retorio` | their controller is in `docs/07` but **not** in the code census (`apps/api/src/census/census.ts`), so there is no verified `Controller` row to bind them to |

That second row is a corpus gap for the owner, not something an importer may paper over: a
`Controller` row invented here would be a legal addressee nobody verified. `tools/spec-audit` cannot
see it, because its controller-slug check reads the **doc** census rather than the running one.

## activate

Prints the controller, the request type, the **fully rendered letter** against a visibly-fake subject,
the bound template's seal and hash, the Art. 77 venue, what can reach an escalation, and the node's
posture — then asks the operator to retype the slug.

- Outside a dev posture it **refuses a template that is not `SIGNED`** in `templates/.signoff.json`.
  `--allow-draft` is a development flag and is refused there.
- It refuses to activate a second playbook for the same `(controller, requestType)`. Swapping one live
  letter for another is a substitution: two decisions, two ledger entries.
- It writes a `CorpusActivation` row (migration 0019, append-only) in the same transaction as the flip.

The attestation wording is German, in a consumer register, and is **`TODO(counsel)`** — see
`src/attestation.ts`. On posture A the person confirming it is the data subject.

## deactivate

The kill switch, and deliberately asymmetric: no preview, no retyped slug, no seal check, and it works
on a row whose template is missing or whose document no longer renders. Turning a playbook **off** has
to succeed in exactly the circumstances where turning it on would rightly fail. It still writes a
ledger row; the letter hash is best-effort and recorded as null when the preview cannot render.

## Notes

- **Repo-rooted by design.** The corpus is files an operator can read, diff and check against the
  published repository before deciding to trust them. A container image ships `playbooks/`,
  `templates/` and `tools/spec-audit` alongside this package.
- **No HTTP equivalent, deliberately** — same reasoning as `grant-ops`. A route that activates a
  playbook is a route that authorises outbound legal letters, reachable by whoever reaches the web
  server. This needs the database credential and a terminal.
