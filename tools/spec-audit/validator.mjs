// THE playbook validation entry point, shared by everything that validates a playbook.
//
// `validatePlaybook` (playbook-lint.mjs) takes a compiled Ajv validator as a parameter rather than
// building one, which is the right shape — but it means every caller assembles the compiler, and two
// callers assembling it slightly differently is two different definitions of "valid". `strict: false`
// and `allErrors: true` are not cosmetic: strict mode rejects the schema outright, and without
// `allErrors` a document reports its first problem and hides the rest.
//
// The second caller arrived with `packages/corpus-cli`, which writes playbooks into a real node's
// database. A corpus that passes CI and is rejected by the importer — or worse, the reverse — would
// mean the gate everyone trusts is not the gate that runs. So the setup lives here, once, and both
// use it.
//
// This harness stays dependency-light and outside the pnpm workspace on purpose (see README), so the
// CLI imports this file by path from the repo root rather than as a package.
import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ROOT } from './root.mjs';
import { validatePlaybook } from './playbook-lint.mjs';

export const SCHEMA_PATH = path.join(ROOT, 'schema/playbook.schema.json');

/** The parsed schema document. `audit.mjs` reads enums out of it to cross-check the docs. */
export const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

/**
 * Compile `schema/playbook.schema.json`. Throws if the schema itself is broken — a caller that
 * swallowed that would validate every document against nothing and report a clean corpus.
 */
export function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(SCHEMA);
}

/**
 * Schema + semantic lints, in one call. Returns the `{severity, id, message}` problem list —
 * **schema alone is not a green light** (playbook-lint.mjs's header explains which three classes of
 * defect are structurally beyond JSON Schema).
 */
export function makeValidator() {
  const ajvValidate = compileSchema();
  return (doc, opts = {}) => validatePlaybook(doc, ajvValidate, opts);
}
