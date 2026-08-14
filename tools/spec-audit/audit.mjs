// Spec-conformance audit: validates every shipped playbook through the real gate (schema + lints),
// checks template bindings, cross-document reference integrity, census consistency, and the three-way
// agreement of the normative clock rule. Exits non-zero on any failure so CI can gate on it.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ROOT } from './root.mjs';
import { validatePlaybook } from './playbook-lint.mjs';

const fail = [], warn = [], ok = [];
const F = (id, msg) => fail.push(`[FAIL ${id}] ${msg}`);
const W = (id, msg) => warn.push(`[WARN ${id}] ${msg}`);
const O = (msg) => ok.push(`[ok] ${msg}`);

// ---------- 1. Schema compiles ----------
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema/playbook.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
let ajvValidate;
try {
  ajvValidate = ajv.compile(schema);
  O('playbook.schema.json compiles under JSON Schema draft 2020-12');
} catch (e) {
  F('SCHEMA-COMPILE', `schema does not compile: ${e.message}`);
}

// ---------- 2. Every playbook through the full gate ----------
const pbDir = path.join(ROOT, 'playbooks');
const pbFiles = fs.readdirSync(pbDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
const playbooks = {};

for (const f of pbFiles) {
  let doc;
  try {
    doc = YAML.parse(fs.readFileSync(path.join(pbDir, f), 'utf8'));
    O(`${f} parses as YAML`);
  } catch (e) {
    F('YAML-PARSE', `${f}: ${e.message}`);
    continue;
  }
  playbooks[f] = doc;
  if (!ajvValidate) continue;

  // `active: true` is a legitimate end state for a signed-off playbook, but nothing in the repo is
  // signed off yet — the lint treats it as an error and that is deliberate (see ARCHITECTURE-DECISIONS §4).
  const problems = validatePlaybook(doc, ajvValidate);
  const errs = problems.filter((p) => p.severity === 'error');
  const warns = problems.filter((p) => p.severity === 'warn');
  for (const e of errs) F(e.id, `${f}: ${e.message}`);
  for (const w of warns) W(w.id, `${f}: ${w.message}`);
  if (!errs.length) O(`${f} passes the full validation gate (schema + semantic lints)`);
}

// ---------- 2b. Corpus-level: a scoped playbook needs the request that produces its scope ----------
// `scopeSource: PROVENANCE_ANSWER` means the letter's category list comes from THIS controller's own
// Art. 15(1)(g) answer. Without a sibling ACCESS_ART15_SOURCE playbook for the same controller there is
// no way to obtain one, so the erasure is unreachable — a playbook that looks like a capability and is
// not. Cross-file, so neither the schema nor the per-file lint can see it.
// The sibling must ALSO carry a broker watchlist. `deriveErasureScope` refuses outright without one
// (there is no closed set to validate a named source against, so no source name may reach a letter),
// and the schema deliberately does not require `brokerWatchlist` on every ACCESS_ART15_SOURCE — a
// watchlist-less provenance request is a legitimate standalone instrument, since an incomplete source
// list is an Art. 77 lever on its own. So "a sibling exists" is not the same condition as "a scope can
// be derived", and only this corpus-level check can tell the difference.
const watchlistedSourceControllers = new Set(
  Object.values(playbooks)
    .filter((p) => p?.requestType === 'ACCESS_ART15_SOURCE' && (p?.provenance?.brokerWatchlist ?? []).length > 0)
    .map((p) => p.controller),
);
const anySourceControllers = new Set(
  Object.values(playbooks).filter((p) => p?.requestType === 'ACCESS_ART15_SOURCE').map((p) => p.controller),
);
for (const [f, pb] of Object.entries(playbooks)) {
  if (pb?.scopeSource !== 'PROVENANCE_ANSWER') continue;
  if (!anySourceControllers.has(pb.controller)) {
    F('SCOPE-UNREACHABLE',
      `${f}: declares scopeSource: PROVENANCE_ANSWER but no ACCESS_ART15_SOURCE playbook exists for controller "${pb.controller}", so its scope can never be derived and the request can never be rendered`);
  } else if (!watchlistedSourceControllers.has(pb.controller)) {
    F('SCOPE-UNREACHABLE',
      `${f}: declares scopeSource: PROVENANCE_ANSWER and controller "${pb.controller}" has a provenance playbook, but that playbook declares no provenance.brokerWatchlist — deriveErasureScope refuses without one, so the scope can never be derived for ANY answer`);
  } else {
    O(`${f} has a watchlisted provenance source playbook for "${pb.controller}" — its scope is derivable`);
  }
}

// ---------- 3. Template existence + orphans ----------
const tplDir = path.join(ROOT, 'templates');
const tplNames = fs.readdirSync(tplDir).filter((t) => t.endsWith('.md')).map((t) => t.replace(/\.md$/, ''));
const referenced = new Set(Object.values(playbooks).map((p) => p.template));
for (const [f, pb] of Object.entries(playbooks)) {
  if (pb.template && tplNames.includes(pb.template)) O(`${f} -> templates/${pb.template}.md exists`);
}
for (const name of tplNames) {
  if (!referenced.has(name)) W('TPL-ORPHAN', `templates/${name}.md is not referenced by any playbook`);
}

// ---------- 4. Cross-file reference integrity (docs -> files) ----------
const docFiles = fs.readdirSync(path.join(ROOT, 'docs')).map((f) => `docs/${f}`);
const allDocs = [...docFiles, 'README.md', 'CLAUDE.md', 'ARCHITECTURE-DECISIONS.md', 'PROMPT.md', 'PROMPT-FEATURES.md', 'PROMPT-PIVOT.md'];
const refRe = /`([a-zA-Z0-9_\-./]+\.(md|json|yaml|yml|ts))`|\]\((\.\/)?([a-zA-Z0-9_\-./]+\.(md|json|yaml|yml))\)/g;
for (const d of allDocs) {
  const p = path.join(ROOT, d);
  if (!fs.existsSync(p)) continue;
  const body = fs.readFileSync(p, 'utf8');
  for (const m of body.matchAll(refRe)) {
    const ref = m[1] || m[4];
    if (!ref || ref.startsWith('http') || ref.includes('*')) continue;
    // A backticked filename used as markdown LINK TEXT — [`foo.test.ts`](packages/core/test/foo.test.ts)
    // — is labelled by the adjacent link target, not a bare path reference. Resolve the target.
    if (m[1] && body.slice(m.index + m[0].length, m.index + m[0].length + 2) === '](') {
      continue; // the link target itself is matched separately by the second alternative
    }
    const candidates = [path.join(ROOT, ref), path.join(ROOT, path.dirname(d), ref)];
    if (!candidates.some((c) => fs.existsSync(c))) W('DOC-REF', `${d} references "${ref}" which does not exist on disk`);
  }
}

// ---------- 5. Controller slug consistency ----------
const censusSlugs = new Set();
const seed = fs.readFileSync(path.join(ROOT, 'docs/07-controllers-seed.md'), 'utf8');
for (const m of seed.matchAll(/^\|\s*([a-z0-9][a-z0-9-]*)\s*\|/gm)) censusSlugs.add(m[1]);
const pivot = fs.readFileSync(path.join(ROOT, 'docs/09-pivot-modules.md'), 'utf8');

// A slug the census keeps only as an ALIAS. docs/07 keeps `boniversum` so historical references
// resolve, and says in the same row: "do not write a playbook against it" (it merged into infoscore in
// Sep 2025). The CENSUS check below cannot catch that — the row exists, so a playbook against it looks
// clean — and prose is not a gate. A playbook against a merged-away controller books permanent
// non-compliance against a name that is not a controller, files its Art. 77 complaint at a dead
// addressee, and (because idempotency keys on controllerId, ADR-013) lets the SAME follow-up be raised
// twice under two slugs, which is the Art. 12(5) "excessive" exposure CLAUDE.md §8 exists to prevent.
const aliasedSlugs = new Set(
  [...seed.matchAll(/^\|\s*([a-z0-9][a-z0-9-]*)\s*\|[^\n]*$/gm)]
    .filter((m) => /do not write a playbook against it/i.test(m[0]))
    .map((m) => m[1]),
);
for (const s of aliasedSlugs) O(`docs/07 marks "${s}" as an alias only — no playbook may target it`);

for (const [f, pb] of Object.entries(playbooks)) {
  if (pb.controller && aliasedSlugs.has(pb.controller)) {
    F('CENSUS-ALIAS',
      `${f}: controller "${pb.controller}" is kept in docs/07 as a slug ALIAS only ("do not write a playbook against it") — route the request to the surviving controller instead`);
  }
  if (pb.controller && pb.controller !== '__PARAM__' && !censusSlugs.has(pb.controller)) {
    W('CENSUS', `${f}: controller "${pb.controller}" has no slug row in docs/07-controllers-seed.md`);
  }
  for (const b of pb.provenance?.brokerWatchlist || []) {
    if (!censusSlugs.has(b)) W('WATCHLIST', `${f}: brokerWatchlist entry "${b}" has no controller row in docs/07 census`);
  }
}

// ---------- 6. requestType coverage vs data model ----------
const dataModel = fs.readFileSync(path.join(ROOT, 'docs/03-data-model.md'), 'utf8');
for (const t of schema.properties.requestType.enum) {
  if (!dataModel.includes(t) && !pivot.includes(t)) {
    W('ENUM-DRIFT', `requestType "${t}" is in playbook.schema.json but appears in neither docs/03 nor docs/09`);
  }
}
if (/`OBJECTION_ART21 \| ACCESS_ART15 \| ERASURE_ART17 \| ROBINSON`/.test(dataModel)) {
  W('ENUM-DRIFT', 'docs/03 RightsRequest.requestType still lists the pre-pivot 4-type enum');
}
// H3/H6: the two non-statutory action types must NOT be RightsRequest.requestType values.
const rrLine = dataModel.match(/`requestType` \(`([^`]+)`\)/);
if (rrLine) {
  const declared = rrLine[1].split('|').map((s) => s.trim());
  for (const bad of ['ROBINSON', 'EINMELDUNG_FRAUD']) {
    if (declared.includes(bad)) {
      F('ENUM-DRIFT', `docs/03: RightsRequest.requestType includes "${bad}", which has no Art. 12(3) deadline and no Art. 77 remedy (audit H3) — it belongs to SuppressionEnrolment / FraudMarkerFiling`);
    }
  }
  for (const t of ['OBJECTION_ART21', 'ACCESS_ART15', 'ACCESS_ART15_SOURCE', 'ERASURE_ART17']) {
    if (!declared.includes(t)) F('ENUM-DRIFT', `docs/03: RightsRequest.requestType is missing statutory type "${t}"`);
  }
}

// ---------- 7. C1: the three normative files must agree that email is not proof ----------
const NORMATIVE = {
  'CLAUDE.md': fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8'),
  'docs/05-legal-guardrails.md': fs.readFileSync(path.join(ROOT, 'docs/05-legal-guardrails.md'), 'utf8'),
  'schema/request-state-machine.md': fs.readFileSync(path.join(ROOT, 'schema/request-state-machine.md'), 'utf8'),
};
if (/DKIM-aligned,?\s*\*?\*?or\*?\*?\s*postal proof/i.test(NORMATIVE['schema/request-state-machine.md'])) {
  F('CLOCK-CONTRADICTION', 'schema/request-state-machine.md still admits "email accepted + DKIM-aligned" as a provable send, contradicting CLAUDE.md §6 and docs/05 §6 (audit C1)');
}
for (const [name, body] of Object.entries(NORMATIVE)) {
  if (!/[Ee]mail is not proof/.test(body)) {
    F('CLOCK-CONTRADICTION', `${name} no longer states that email is not proof of delivery — the three normative files must agree verbatim (audit C1)`);
  }
  if (!/provisionalDeadlineAt/.test(body)) {
    W('CLOCK-CONTRADICTION', `${name} does not mention provisionalDeadlineAt — check it still describes the resolved C1 model`);
  }
}

// ---------- 8. structured.* inventory (doc-sandbox output contract) ----------
const structuredKeys = new Set();
for (const [f, pb] of Object.entries(playbooks)) {
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('structured.')) structuredKeys.add(`${k}  (${f})`);
      walk(v);
    }
  };
  walk(pb.validation);
  walk(pb.provenance);
}

// ---------- 9. Dev-fixture playbook documents pass the SAME gate (audit P1c/P2) ----------
// The seed writes Playbook.document JSON that the worker later casts to `Playbook` with no runtime
// validation — so fixture documents must clear the identical schema+lint gate the shipped corpus
// does. Requires apps/api to be built; warns (rather than fails) when it is not, so the YAML-only
// CI path keeps working.
{
  const seedDist = path.join(ROOT, 'apps/api/dist/db/seed.js');
  const fixturesDist = path.join(ROOT, 'apps/api/dist/common/dev-fixtures.js');
  if (fs.existsSync(seedDist) && fs.existsSync(fixturesDist)) {
    try {
      const { demoPlaybookDocument, DEMO_PLAYBOOK_VERSION } = await import(seedDist);
      const { DEV_DEMO_PLAYBOOK_PAIRS } = await import(fixturesDist);
      for (const pair of DEV_DEMO_PLAYBOOK_PAIRS) {
        const slug = `demo.${pair.controllerSlug}.${pair.requestType.toLowerCase()}`;
        const doc = demoPlaybookDocument(slug, pair.controllerSlug, pair.requestType);
        const problems = validatePlaybook(doc, ajvValidate).filter((p) => p.severity === 'error');
        if (problems.length) {
          for (const p of problems) F('SEED-GATE', `${slug}: [${p.id}] ${p.message}`);
        } else {
          O(`${slug} (seed fixture document) passes the full validation gate`);
        }
        if (doc.active !== false) F('SEED-GATE', `${slug}: fixture document must ship active:false — the counsel gate applies to fixtures`);
        if (doc.version !== DEMO_PLAYBOOK_VERSION) F('SEED-GATE', `${slug}: document.version ${doc.version} != DEMO_PLAYBOOK_VERSION ${DEMO_PLAYBOOK_VERSION}`);
        if (pair.requestType === 'ERASURE_ART17' && doc.scopeSource !== 'PROVENANCE_ANSWER') {
          F('SEED-GATE', `${slug}: a bureau-erasure fixture must carry the BOUNDED shape (scopeSource: PROVENANCE_ANSWER) — docs/07 forbids the unbounded letter`);
        }
      }
    } catch (e) {
      F('SEED-GATE', `could not evaluate seed fixture documents: ${e.message}`);
    }
  } else {
    W('SEED-GATE', 'apps/api/dist not built — seed fixture playbook documents were NOT validated this run');
  }
}

// ---------- 10. Templates carry no outcome promise (docs/05 §3; audit P7) ----------
// The i18n suite sweeps UI copy for outcome promises; templates — the HIGHEST-blast-radius prose in
// the repo — were outside every sweep. Same regex as packages/i18n/test/strings.test.ts.
{
  const FORBIDDEN_PROMISES = /(we will get|we guarantee|garantier|wir werden daf|raise your score|Score verbessern|Score erhöhen|100\s?%|sicher gelöscht)/i;
  const tplDir = path.join(ROOT, 'templates');
  for (const f of fs.readdirSync(tplDir).filter((t) => t.endsWith('.md'))) {
    const body = fs.readFileSync(path.join(tplDir, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    if (FORBIDDEN_PROMISES.test(body)) {
      F('TPL-PROMISE', `templates/${f} contains outcome-promise language (docs/05 §3 — never promise an outcome)`);
    } else {
      O(`templates/${f} carries no outcome promise`);
    }
  }
}

// ---------- report ----------
console.log('==================== FAILURES ====================');
fail.forEach((l) => console.log(l));
if (!fail.length) console.log('(none)');
console.log('\n==================== WARNINGS ====================');
warn.forEach((l) => console.log(l));
if (!warn.length) console.log('(none)');
console.log('\n==================== PASSED ====================');
ok.forEach((l) => console.log(l));
console.log('\n=========== structured.* keys the doc-sandbox must emit ===========');
[...structuredKeys].forEach((k) => console.log('  ' + k));
console.log(`\nSUMMARY: ${fail.length} failures, ${warn.length} warnings, ${ok.length} checks passed.`);
if (fail.length) process.exitCode = 1;
