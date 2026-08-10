// docs/04 authoring rule: "Any change bumps `version`; never mutate a shipped version (audit trail)."
//
// JSON Schema cannot express this — it needs history. The history lives in playbooks/.shipped.json,
// a lockfile of {slug: {version, sha256}}. This check compares the working tree against it:
//
//   version same + content changed  -> FAIL. A shipped version was edited in place. Every request
//                                      already sent under that version now references a playbook that
//                                      no longer exists, which is precisely the audit trail the rule
//                                      protects. Bump the version instead.
//   version went backwards          -> FAIL. Version numbers are the audit key; reuse collides.
//   version bumped                  -> ok, pending re-seal.
//   new slug                        -> ok, pending seal.
//
// `npm run seal` records the current tree as shipped. Sealing is deliberate: it is the moment you
// assert "this content is what version N means, forever".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { ROOT } from './root.mjs';

const LOCK = path.join(ROOT, 'playbooks/.shipped.json');
const pbDir = path.join(ROOT, 'playbooks');
const seal = process.argv.includes('--seal');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const current = {};
for (const f of fs.readdirSync(pbDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
  const raw = fs.readFileSync(path.join(pbDir, f), 'utf8');
  let doc;
  try { doc = YAML.parse(raw); } catch { continue; }
  if (!doc?.slug) continue;
  // Hash the PARSED, re-serialised document: a comment or whitespace edit is not a semantic change,
  // and failing CI on a typo fix in a comment would train people to bump versions meaninglessly.
  current[doc.slug] = { version: doc.version, sha256: sha256(YAML.stringify(doc)), file: f };
}

const shipped = fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, 'utf8')) : {};
// `problems` are integrity failures — sealing over them would launder a mutation into the record.
// `repairable` are defects in the lockfile itself, which is exactly what --seal exists to rewrite;
// letting them block --seal deadlocks the tool against its own output.
const problems = [];
const repairable = [];
const notes = [];

for (const [slug, cur] of Object.entries(current)) {
  const prev = shipped[slug];
  if (!prev) { notes.push(`new: ${slug} v${cur.version} (not yet sealed)`); continue; }
  // A lockfile entry missing either field cannot prove anything. Treat it as a failure rather than
  // silently falling through to "unchanged" — a check that cannot check must not report green.
  if (typeof prev.version !== 'number' || typeof prev.sha256 !== 'string') {
    repairable.push(`playbooks/.shipped.json entry for "${slug}" is malformed (${JSON.stringify(prev)}) — it cannot detect a mutation. Re-seal with \`npm run seal\`.`);
    continue;
  }
  if (cur.version < prev.version) {
    problems.push(`${cur.file}: version went BACKWARDS (${prev.version} -> ${cur.version}). Versions are the audit key; a reused number collides with requests already sent under it.`);
  } else if (cur.version === prev.version && cur.sha256 !== prev.sha256) {
    problems.push(`${cur.file}: slug "${slug}" version ${cur.version} was MUTATED IN PLACE (${prev.sha256.slice(0, 12)} -> ${cur.sha256.slice(0, 12)}). docs/04: never mutate a shipped version — bump to ${cur.version + 1}.`);
  } else if (cur.version > prev.version) {
    notes.push(`bumped: ${slug} v${prev.version} -> v${cur.version} (re-seal to record)`);
  } else {
    notes.push(`unchanged: ${slug} v${cur.version}`);
  }
}
for (const slug of Object.keys(shipped)) {
  if (!current[slug]) problems.push(`slug "${slug}" was sealed as shipped but no longer exists in playbooks/ — deleting a shipped playbook breaks the audit trail of requests sent under it`);
}

console.log('VERSION MONOTONICITY — has a shipped playbook version been mutated?\n');
notes.forEach((n) => console.log(`  · ${n}`));
if (repairable.length) {
  console.log('\n  LOCKFILE DEFECTS (fixed by `npm run seal`):');
  repairable.forEach((p) => console.log(`  ! ${p}`));
}
if (problems.length) {
  console.log('\n  FAILURES:');
  problems.forEach((p) => console.log(`  ✗ ${p}`));
}

if (seal) {
  if (problems.length) {
    console.log('\nRefusing to seal while there are integrity failures — sealing would launder a mutation into the record. Fix them first.');
    process.exitCode = 1;
  } else {
    const out = {};
    // Insertion order = sorted, so the lockfile diffs cleanly. NOTE: do not pass the key list as
    // JSON.stringify's 2nd argument — that parameter is a property ALLOWLIST, not a sort order, and
    // passing slugs there silently strips {version, sha256} and seals empty objects.
    for (const slug of Object.keys(current).sort()) {
      out[slug] = { version: current[slug].version, sha256: current[slug].sha256 };
    }
    fs.writeFileSync(LOCK, JSON.stringify(out, null, 2) + '\n');
    console.log(`\nSealed ${Object.keys(out).length} playbooks into playbooks/.shipped.json`);
  }
} else {
  const total = problems.length + repairable.length;
  console.log(`\nSUMMARY: ${total} version problems.`);
  if (total) process.exitCode = 1;
}
