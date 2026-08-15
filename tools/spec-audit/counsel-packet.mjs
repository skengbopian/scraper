// §3 and §4 of `docs/counsel-review-packet.md`, generated from the corpus rather than transcribed.
//
//   node counsel-packet.mjs           — check: does the packet still describe the tree?
//   node counsel-packet.mjs --write   — regenerate the derived columns in place
//
// WHY THIS IS A SCRIPT. The packet is the document counsel is instructed from, and its per-playbook
// facts were hand-copied. By 2026-08-15 they had drifted in exactly the way hand-copied facts do:
// §3 asserted "all bindings are at v1 per playbooks/.shipped.json" and §4 "all 19 at version: 1"
// while thirteen playbooks had shipped v2 or v3, and the `werbewiderspruch.az-direct` row — the
// FIRST letter the product intends to send (PLAN §2) — said "no seatDpa field declared" when the
// YAML declares `seatDpa: LDI_NRW`. A counsel reading that row would have been asked to confirm a
// venue the corpus had already chosen, against a version of a playbook that no longer exists.
//
// So the mechanical columns are derived and the build fails when they drift. What is NOT generated:
// the statutory-basis prose, the per-row "Counsel must verify" list, and the sign-off/Datum/Notizen
// cells. Those are counsel's working state and human judgement — a generator that overwrote them
// would destroy the only part of the document that accumulates value.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ROOT } from './root.mjs';

const PACKET = path.join(ROOT, 'docs/counsel-review-packet.md');
const write = process.argv.includes('--write');

// ---------- the corpus ----------
const pbDir = path.join(ROOT, 'playbooks');
const shipped = JSON.parse(fs.readFileSync(path.join(pbDir, '.shipped.json'), 'utf8'));
const signoff = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/.signoff.json'), 'utf8'));

const playbooks = fs
  .readdirSync(pbDir)
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => YAML.parse(fs.readFileSync(path.join(pbDir, f), 'utf8')))
  .filter((d) => d?.slug)
  .sort((a, b) => a.slug.localeCompare(b.slug));

/** "postal (registered primary) → email", "email only", … — the shape a reviewer needs to see. */
function channels(ch) {
  if (!ch?.primary) return '—';
  const reg = ch.registered ?? {};
  const label = (name, registered) => `${name}${registered ? ' (registered)' : ''}`;
  if (!ch.fallback) return `${label(ch.primary, reg.primary)} only`;
  return `${label(ch.primary, reg.primary)} → ${label(ch.fallback, reg.fallback)}`;
}

/**
 * The venue the playbook DECLARES. Not what a doc says it should be — the point of generating this
 * cell is that the corpus's own answer and the packet's claim about it stopped matching.
 */
function venue(d) {
  if (d.seatDpa) return `\`seatDpa: ${d.seatDpa}\``;
  if (d.venue === 'USER_RESIDENCE') return "`venue: USER_RESIDENCE` (user's Land-DPA)";
  if (d.venue) return `\`venue: ${d.venue}\``;
  return '**none declared**';
}

/** What can reach ESCALATION_DRAFTED. `onDeadlineExpiry: NONE` means silence is not escalatable. */
function escalation(d) {
  const e = d.escalation ?? {};
  const on = [];
  if (e.onDeadlineExpiry && e.onDeadlineExpiry !== 'NONE') on.push('silence');
  if (e.onRefusal && e.onRefusal !== 'NONE') on.push('refusal');
  if (e.onIncompleteSourceList && e.onIncompleteSourceList !== 'NONE') on.push('incomplete');
  return on.length ? on.join(' + ') : 'none';
}

function activeCell(d) {
  const base = String(d.active === true);
  return d.parameterised ? `${base} (stencil — never activatable)` : base;
}

function versionCell(slug, d) {
  const lock = shipped[slug];
  if (!lock) return `${d.version} ⚠ not in .shipped.json`;
  if (lock.version !== d.version) return `${d.version} ⚠ lockfile says ${lock.version}`;
  return String(lock.version);
}

// ---------- template rows ----------
const bindings = new Map(); // template basename -> playbooks
for (const d of playbooks) {
  const name = `${d.template}.md`;
  if (!bindings.has(name)) bindings.set(name, []);
  bindings.get(name).push(d);
}

function sealCell(name) {
  const e = signoff[name];
  if (!e) return '**no seal entry**';
  const short = `\`${String(e.sha256_stripped).slice(0, 8)}\``;
  return e.status === 'SIGNED' ? `SIGNED · ${e.counsel} · ${e.signedAt} · ${short}` : `DRAFT · ${short}`;
}

function bindingVersions(name) {
  const bound = bindings.get(name) ?? [];
  const counts = new Map();
  for (const d of bound) counts.set(d.version, (counts.get(d.version) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => a[0] - b[0])
    .map(([v, n]) => `v${v}${n > 1 ? ` ×${n}` : ''}`)
    .join(', ');
}

// ---------- table surgery ----------
const source = fs.readFileSync(PACKET, 'utf8');

/** Split a markdown table row into cells. Fails loudly rather than silently mis-columning. */
function cells(row) {
  const inner = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

function block(text, id) {
  const begin = new RegExp(`<!-- GENERATED:${id} BEGIN[^>]*-->`);
  const end = `<!-- GENERATED:${id} END -->`;
  const b = text.match(begin);
  if (!b) throw new Error(`counsel-packet: no GENERATED:${id} BEGIN marker in ${path.relative(ROOT, PACKET)}`);
  const from = text.indexOf(b[0]) + b[0].length;
  const to = text.indexOf(end, from);
  if (to === -1) throw new Error(`counsel-packet: no GENERATED:${id} END marker`);
  return { from, to, body: text.slice(from, to) };
}

/**
 * Rebuild a table, keeping every human column.
 *
 * Human cells are carried over BY COLUMN NAME, not by position. That is not fastidiousness: the
 * first run of this generator matched by index, the new header had one more column than the old, and
 * every "Counsel must verify before flipping" cell in §4 — nineteen rows of accumulated legal
 * review — was silently replaced by the sign-off checkbox one place to its left. A generator that
 * can destroy the only part of the document worth having must not depend on two tables happening to
 * have the same shape.
 *
 * Rows are matched by their first cell. A new playbook therefore starts with empty human cells
 * rather than inheriting somebody else's sign-off, and a removed one takes its notes with it.
 */
function rebuild(existingBody, header, rows, humanCols) {
  const prior = new Map();
  let oldHeader = null;
  for (const line of existingBody.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const c = cells(line);
    if (/^-+$/.test(c[0])) continue;
    if (!oldHeader) {
      oldHeader = c;
      continue;
    }
    prior.set(c[0], c);
  }
  // new column index -> old column index, by header text.
  const carry = new Map();
  for (const i of humanCols) {
    const j = (oldHeader ?? []).indexOf(header[i]);
    if (j !== -1) carry.set(i, j);
  }
  const out = [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`];
  for (const row of rows) {
    const old = prior.get(row[0]);
    const merged = row.map((cell, i) => {
      if (!humanCols.has(i)) return cell;
      const j = carry.get(i);
      return old && j !== undefined ? (old[j] ?? '') : '';
    });
    out.push(`| ${merged.join(' | ')} |`);
  }
  return `\n\n${out.join('\n')}\n\n`;
}

const TEMPLATE_HEADER = [
  'Template',
  'Bound playbooks',
  'Statutory basis (from the file\'s own content)',
  'Seal',
  'Binding playbook versions',
  'Sign-off',
  'Datum',
  'Notizen',
];
const TEMPLATE_HUMAN = new Set([2, 5, 6, 7]);

const templateRows = [...bindings.keys()].sort().map((name) => [
  `\`templates/${name}\``,
  (bindings.get(name) ?? [])
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((d) => `\`${d.slug}\`${d.parameterised ? ' (stencil)' : ''}`)
    .join(', '),
  '',
  sealCell(name),
  bindingVersions(name),
  '',
  '',
  '',
]);

const PLAYBOOK_HEADER = [
  'Playbook (slug)',
  'v',
  'requestType',
  'Channel(s)',
  'Declared venue',
  'Escalates on',
  'active',
  'Counsel must verify before flipping',
  'Sign-off',
  'Datum',
  'Notizen',
];
const PLAYBOOK_HUMAN = new Set([7, 8, 9, 10]);

const playbookRows = playbooks.map((d) => [
  `\`${d.slug}\``,
  versionCell(d.slug, d),
  d.requestType,
  channels(d.channel),
  venue(d),
  escalation(d),
  activeCell(d),
  '',
  '',
  '',
  '',
]);

let next = source;
for (const [id, header, rows, human] of [
  ['templates', TEMPLATE_HEADER, templateRows, TEMPLATE_HUMAN],
  ['playbooks', PLAYBOOK_HEADER, playbookRows, PLAYBOOK_HUMAN],
]) {
  const b = block(next, id);
  next = next.slice(0, b.from) + rebuild(b.body, header, rows, human) + next.slice(b.to);
}

console.log('COUNSEL PACKET — §3/§4 against the corpus\n');
console.log(`  · ${playbooks.length} playbook(s) · ${bindings.size} bound template(s) · ${Object.keys(signoff).length} sealed`);

const orphanTemplates = Object.keys(signoff).filter((n) => !bindings.has(n));
if (orphanTemplates.length) console.log(`  · templates bound by no playbook: ${orphanTemplates.join(', ')}`);

if (write) {
  if (next === source) console.log('\nalready current — nothing written.');
  else {
    fs.writeFileSync(PACKET, next);
    console.log('\nrewrote the generated columns of §3 and §4.');
  }
} else if (next !== source) {
  console.log(
    '\n  ✗ docs/counsel-review-packet.md §3/§4 no longer describe the corpus. This is the document\n' +
      '    counsel is instructed from: a stale version number or venue in it is a question asked about\n' +
      '    a playbook that no longer exists. Run `npm run packet:write` and review the diff.',
  );
  console.log('\nSUMMARY: 1 counsel-packet problem.');
  process.exitCode = 1;
} else {
  console.log('\nSUMMARY: 0 counsel-packet problems.');
}
