// One OQ number, one question — enforced.
//
// This existed as a convention and the convention failed. The 2026-08-14 decentralisation pivot
// minted OQ-23..26 in `docs/14` §7 for four questions ADR-036 had already given those numbers to,
// and both sets were then cited from playbooks, docs, shipped code and the counsel packet — whose
// §2 listed one set while its own §8 and §4 tables listed the other. A counsel writing "OQ-25:
// confirmed" would have been confirming one of two unrelated things, and no reader of the answer
// could have told which. The register also carried OQ-27, minted in a source comment during port
// wave 5 and defined nowhere, which is the same defect one step earlier: a number nobody can look
// up cannot be detected as taken, and the obvious renumber walked straight at it.
//
// Both failures are mechanical, so this is mechanical:
//
//   defined twice     -> FAIL. Two questions, one number. This is the 2026-08-14 defect.
//   cited, undefined  -> FAIL. A number in a source comment or a playbook that resolves to nothing.
//                        This is how OQ-27 came to exist.
//
// A number that is defined and never cited is fine and is reported as a note: a question can be
// registered before anything depends on it.
//
// DEFINITION is a table row in one of the three registers below whose first cell is the number,
// with the repo's decorations allowed (`**OQ-9**`, `~~OQ-1~~` for closed). Prose that merely
// mentions a number is a CITATION, never a definition — otherwise a sentence explaining the
// collision would itself register both sides of it.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './root.mjs';

/** The three files allowed to define an OQ. Any other file citing a number must resolve to one of these. */
const REGISTERS = [
  'ARCHITECTURE-DECISIONS.md',
  'docs/10-utility-roadmap.md',
  'docs/14-decentralised-deployment.md',
];

const SCAN_DIRS = ['docs', 'playbooks', 'apps', 'packages', 'services', 'scripts', 'schema', 'templates', 'tools'];
const SCAN_EXT = new Set(['.md', '.ts', '.tsx', '.mjs', '.js', '.yaml', '.yml', '.json']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'build', 'coverage']);

/**
 * Files that TALK ABOUT the numbering rather than using it. `PLAN-OPERATIONAL.md` and
 * `PROMPT-OPERATIONAL.md` quote the pre-fix numbering while describing the fix, which is the correct
 * thing for a plan written before the work to do.
 */
const SKIP_FILES = new Set(['PLAN-OPERATIONAL.md', 'PROMPT-OPERATIONAL.md']);

const DEFINITION = /^\|\s*(?:\*\*|~~)?OQ-(\d+)(?:\*\*|~~)?\s*\|/;
const CITATION = /OQ-(\d+)/g;

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* files(full);
    } else if (SCAN_EXT.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

const targets = [];
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (entry.isFile() && path.extname(entry.name) === '.md' && !SKIP_FILES.has(entry.name)) {
    targets.push(path.join(ROOT, entry.name));
  }
}
for (const d of SCAN_DIRS) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) targets.push(...files(abs));
}

const defined = new Map(); // number -> [{file, line, text}]
const cited = new Map(); // number -> [{file, line}]

for (const file of targets) {
  const rel = path.relative(ROOT, file);
  const isRegister = REGISTERS.includes(rel);
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (isRegister) {
      const def = DEFINITION.exec(line);
      if (def) {
        const n = Number(def[1]);
        if (!defined.has(n)) defined.set(n, []);
        // The row text, trimmed to something a human can tell two questions apart by.
        defined.get(n).push({ rel, line: i + 1, text: line.slice(0, 160) });
        return; // a definition row is not also a citation of itself
      }
    }
    for (const m of line.matchAll(CITATION)) {
      const n = Number(m[1]);
      if (!cited.has(n)) cited.set(n, []);
      cited.get(n).push({ rel, line: i + 1 });
    }
  });
}

const problems = [];
const notes = [];

for (const [n, defs] of [...defined].sort((a, b) => a[0] - b[0])) {
  if (defs.length > 1) {
    problems.push(
      `OQ-${n} is DEFINED ${defs.length} times — two questions, one number:\n` +
        defs.map((d) => `      ${d.rel}:${d.line}  ${d.text}`).join('\n'),
    );
  }
}

for (const [n, refs] of [...cited].sort((a, b) => a[0] - b[0])) {
  if (defined.has(n)) continue;
  problems.push(
    `OQ-${n} is cited ${refs.length}× and DEFINED NOWHERE — it resolves to no question, and nothing ` +
      `stops the next mint from taking it:\n` +
      refs.slice(0, 6).map((r) => `      ${r.rel}:${r.line}`).join('\n') +
      (refs.length > 6 ? `\n      … and ${refs.length - 6} more` : ''),
  );
}

const unused = [...defined.keys()].filter((n) => !cited.has(n)).sort((a, b) => a - b);
const highest = Math.max(0, ...defined.keys());

console.log('OQ REGISTER — one number, one question\n');
console.log(`  · ${defined.size} defined across ${REGISTERS.length} registers · ${cited.size} distinct numbers cited`);
console.log(`  · next number to mint: OQ-${highest + 1}`);
if (unused.length) notes.push(`defined but not yet cited (fine): ${unused.map((n) => `OQ-${n}`).join(', ')}`);
for (const n of notes) console.log(`  · ${n}`);

if (problems.length === 0) {
  console.log('\nSUMMARY: 0 OQ numbering problems.');
} else {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\nSUMMARY: ${problems.length} OQ numbering problem(s).`);
  process.exitCode = 1;
}
