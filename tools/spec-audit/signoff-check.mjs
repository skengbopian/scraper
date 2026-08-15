// The template seal: does every letter still say what counsel signed?
//
//   node signoff-check.mjs          — verify
//   node signoff-check.mjs --seal   — record the current bodies as sealed (keeps status/counsel/date)
//
// THE HOLE THIS CLOSES. `docs/04` puts all legal wording in `templates/` and makes it counsel-owned;
// `ARCHITECTURE-DECISIONS.md` §4 makes template sign-off a precondition for activating any playbook.
// Neither was enforceable. No template body was hashed anywhere, the worker resolves the letter by
// FILENAME at dispatch, and the doc-comment header carrying the word DRAFT is stripped before
// rendering — so editing a signed template silently changed what a sealed playbook sends, with every
// other seal in the repo still green. `playbooks/.shipped.json` protects the playbook document; the
// letter it names was unprotected, and the letter is the part with legal effect.
//
// WHAT IS HASHED: the body after the doc-comment header is stripped, i.e. exactly the bytes
// `render()` starts from. NORMATIVE implementation: `stripDocComment` in
// `packages/core/src/template/render.ts`, mirrored below because this harness is deliberately not a
// workspace member and must run before (and independently of) the monorepo toolchain. The mirror is
// not trusted on faith — `packages/core/test/signoff.test.ts` recomputes every hash through the real
// `stripDocComment` and fails if the two implementations ever disagree.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './root.mjs';

const DIR = path.join(ROOT, 'templates');
const MANIFEST = path.join(DIR, '.signoff.json');
const seal = process.argv.includes('--seal');

/** MIRROR of packages/core stripDocComment. Change both or neither. */
const stripDocComment = (body) => body.replace(/<!--[\s\S]*?-->\s*/g, '');
const sealHash = (body) => crypto.createHash('sha256').update(stripDocComment(body), 'utf8').digest('hex');

const DRAFT_MARKER = /\bDRAFT\b/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

const templates = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.md'))
  .sort()
  .map((name) => ({ name, body: fs.readFileSync(path.join(DIR, name), 'utf8') }));

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};

if (seal) {
  // --seal REFUSES to re-seal a SIGNED template whose prose has changed. Same doctrine as
  // `version-check.mjs --seal`, and for a sharper reason: rewriting the hash under a status that
  // still says SIGNED would turn this tool into the laundry. Someone edits an approved letter, runs
  // seal, and every gate goes green over prose no lawyer has read — which is the exact failure the
  // seal exists to make impossible, reintroduced by its own maintenance command.
  //
  // The way out is a human act with a name on it: either revert the edit, or downgrade the entry to
  // DRAFT (visible in the diff, and it re-blocks activation and dispatch) and take it back to
  // counsel. Neither is something a script should do on someone's behalf.
  const laundering = templates.filter((t) => {
    const prev = manifest[t.name];
    return prev?.status === 'SIGNED' && prev.sha256_stripped !== sealHash(t.body);
  });
  if (laundering.length > 0) {
    console.error('\nrefusing to seal — these templates are SIGNED and their prose has changed:\n');
    for (const t of laundering) console.error(`  ✗ ${t.name}`);
    console.error(
      '\nRe-sealing would rewrite the hash while the status still says SIGNED, and every gate would go\n' +
        'green over wording no lawyer has read. Either revert the edit, or set the entry back to\n' +
        '"status": "DRAFT" (with counsel/signedAt null) and re-run — that downgrade is visible in the\n' +
        'diff and re-blocks activation and dispatch, which is what it is for.',
    );
    process.exit(1);
  }

  // Hashes only. A signature is never invented and never silently cleared.
  const next = {};
  for (const t of templates) {
    const prev = manifest[t.name];
    next[t.name] = {
      status: prev?.status ?? 'DRAFT',
      sha256_stripped: sealHash(t.body),
      counsel: prev?.counsel ?? null,
      signedAt: prev?.signedAt ?? null,
    };
    if (!prev) console.log(`  · new ${t.name} (DRAFT)`);
    else if (prev.sha256_stripped !== next[t.name].sha256_stripped) console.log(`  · re-sealed ${t.name} (DRAFT)`);
  }
  fs.writeFileSync(MANIFEST, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\nsealed ${templates.length} template(s) into templates/.signoff.json`);
}

const current = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
const byName = new Map(templates.map((t) => [t.name, t]));
const problems = [];

for (const t of templates) {
  if (!(t.name in current)) {
    problems.push(`${t.name}: no entry in templates/.signoff.json — a letter nobody has signed off, and nothing would say so`);
  }
}

for (const [name, entry] of Object.entries(current)) {
  const file = byName.get(name);
  if (!file) {
    problems.push(`${name}: entry names a template that does not exist — a signature waiting for the next file to take that name`);
    continue;
  }
  if (entry.status !== 'DRAFT' && entry.status !== 'SIGNED') {
    problems.push(`${name}: status "${entry.status}" is neither DRAFT nor SIGNED — an unknown status is not a permission`);
    continue;
  }
  const actual = sealHash(file.body);
  if (actual !== entry.sha256_stripped) {
    problems.push(
      `${name}: THE LETTER CHANGED AFTER IT WAS SEALED — recorded ${String(entry.sha256_stripped).slice(0, 12)}…, on disk ${actual.slice(0, 12)}…. ` +
        (entry.status === 'SIGNED'
          ? 'This template is SIGNED: the signature no longer describes what gets sent. Counsel must re-sign.'
          : 'Run `npm run seal:templates` once the wording is where you want it.'),
    );
  }
  if (entry.status === 'SIGNED') {
    if (!entry.counsel) problems.push(`${name}: SIGNED with no \`counsel\` — a signature nobody put their name to`);
    if (!entry.signedAt) problems.push(`${name}: SIGNED with no \`signedAt\``);
    else if (!ISO_DATE.test(entry.signedAt)) problems.push(`${name}: signedAt "${entry.signedAt}" is not an ISO-8601 date`);
    if (DRAFT_MARKER.test(file.body)) {
      problems.push(
        `${name}: SIGNED, but the header still carries the DRAFT marker. The header is stripped before rendering and is ` +
          'outside the hash, so the two can disagree — and a letter telling its reader it is unapproved must not be the one going out.',
      );
    }
  } else if (!DRAFT_MARKER.test(file.body)) {
    problems.push(
      `${name}: DRAFT in the manifest, but the DRAFT marker has been removed from the header. The marker is what an ` +
        'operator reading the file sees, and deleting it is invisible to the hash.',
    );
  }
}

const signed = Object.values(current).filter((e) => e.status === 'SIGNED').length;
console.log('\nTEMPLATE SEAL — does every letter still say what counsel signed?\n');
console.log(`  · ${templates.length} template(s) · ${signed} SIGNED · ${templates.length - signed} DRAFT`);
for (const [name, entry] of Object.entries(current)) {
  const mark = entry.status === 'SIGNED' ? '✓' : '☐';
  const who = entry.status === 'SIGNED' ? `${entry.counsel} · ${entry.signedAt}` : 'awaiting counsel';
  console.log(`  ${mark} ${name.padEnd(34)} ${String(entry.sha256_stripped).slice(0, 12)}…  ${who}`);
}

if (problems.length === 0) {
  console.log('\nSUMMARY: 0 template-seal problems.');
} else {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\nSUMMARY: ${problems.length} template-seal problem(s).`);
  process.exitCode = 1;
}
