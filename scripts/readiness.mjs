// The pre-send checklist's mechanical verifier (PRE-SEND-CHECKLIST.md: "Run `pnpm readiness`
// first"). Promised for port wave 1, delivered by the 2026-08-13 audit — the checklist's own
// caveat ("until then treat every mechanical check here as unverified") stopped being acceptable
// the day the port closed.
//
// Scope: everything a script CAN verify. The counsel boxes (template sign-off, venue confirmation,
// contracts) stay human — this prints them as reminders, never as passes. Exit 1 on any FAIL.
//
//   node scripts/readiness.mjs            — posture report for the current env
//   NODE_ENV=production ... readiness     — the pre-send gate proper
//   node scripts/readiness.mjs --ci       — CI posture: repo-answerable rows gate the build,
//                                           environment-shaped rows report as warnings
//
// THE --ci POSTURE, and why it is not just NODE_ENV=test. CI has no vendor accounts, no CORS list
// and no object store, so a full deploy-posture run there fails for nine reasons that are all "this
// is a build machine" and none that are "someone broke something" — a gate that is red by
// construction is a gate people learn to ignore. But most rows need none of that: they read the
// repo. No playbook ships active, the spec harnesses are green, the version seal holds, the env
// surface matches the code. Those are commit-reviewable claims, they are exactly the ones worth
// failing a build over, and until now readiness was invoked by NO workflow at all — so none of them
// were checked anywhere but in someone's terminal, on the day they remembered to look.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const isCi = process.argv.includes('--ci');
const isDeployPosture = !isCi && env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test';

const rows = [];
const add = (track, status, label, detail = '') => rows.push({ track, status, label, detail });
const PASS = 'ok', FAIL = 'FAIL', WARN = 'warn', HUMAN = 'human';

// ---------- LEGAL PIPELINE ----------
const pbDir = path.join(ROOT, 'playbooks');
let activeInRepo = 0;
for (const f of fs.readdirSync(pbDir).filter((f) => f.endsWith('.yaml'))) {
  // Top-level `active:` only (regex, no YAML dep at the root): the spec-audit gate below parses
  // properly and would also fail an active:true as a lint error.
  if (/^active:\s*true\b/m.test(fs.readFileSync(path.join(pbDir, f), 'utf8'))) activeInRepo += 1;
}
add('LEGAL', activeInRepo === 0 ? PASS : FAIL, 'no playbook ships active:true in the repo',
  activeInRepo ? `${activeInRepo} active — activation is a counsel act against the DATABASE row, never the YAML` : '');

// Sign-off comes from `templates/.signoff.json`, not from grepping the file for the word DRAFT. The
// marker lives in the doc-comment header, which the worker STRIPS before rendering — so it was a
// claim about a comment, and deleting the comment turned this row green while changing nothing about
// whether counsel had seen the letter. The manifest records a signatory, a date, and the hash of the
// prose signed; `signoff-check.mjs` below fails if any of the three stops describing what is sent.
const signoffPath = path.join(ROOT, 'templates', '.signoff.json');
const signoff = fs.existsSync(signoffPath) ? JSON.parse(fs.readFileSync(signoffPath, 'utf8')) : null;
if (!signoff) {
  add('LEGAL', FAIL, 'templates/.signoff.json exists', 'missing — no template sign-off is recorded anywhere');
} else {
  const unsigned = Object.entries(signoff).filter(([, e]) => e.status !== 'SIGNED').map(([f]) => f);
  add('LEGAL', unsigned.length ? HUMAN : PASS, 'templates counsel-signed (templates/.signoff.json)',
    unsigned.length ? `${unsigned.length}/${Object.keys(signoff).length} still DRAFT: ${unsigned.join(', ')}` : '');
}

// The spec harnesses, run rather than cited. Each is repo-answerable — the verdict depends on the
// checkout and nothing else — which is why these gate in every posture, CI included.
for (const [track, name, args] of [
  ['LEGAL', 'spec-audit', ['tools/spec-audit/audit.mjs']],
  ['LEGAL', 'negative fixtures', ['tools/spec-audit/negative.mjs']],
  ['LEGAL', 'state-machine graph', ['tools/spec-audit/statemachine.mjs']],
  ['LEGAL', 'playbook version seal', ['tools/spec-audit/version-check.mjs']],
  ['LEGAL', 'template seal (prose matches what was signed)', ['tools/spec-audit/signoff-check.mjs']],
  ['LEGAL', 'open-question register (one number, one question)', ['tools/spec-audit/oq-check.mjs']],
  ['LEGAL', 'counsel packet §3/§4 describe the corpus', ['tools/spec-audit/counsel-packet.mjs']],
  // Not LEGAL: this one is about the operator's environment, not the legal pipeline. It is here so
  // `pnpm readiness` is a single command that answers "is this checkout deployable", rather than a
  // command an operator has to remember to run a second harness alongside.
  ['COMPLIANCE', 'env surface (.env.example ↔ code)', ['tools/spec-audit/env-check.mjs']],
]) {
  try {
    execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'pipe' });
    add(track, PASS, `${name} green`);
  } catch (e) {
    add(track, FAIL, `${name} FAILED`, String(e.stdout ?? '').split('\n').find((l) => l.includes('✗') || l.includes('FAIL')) ?? '');
  }
}

// A licence is repo-answerable, so it is a row and not a ☐. WARN rather than FAIL outside a
// deployment: the licence is an open owner decision (docs/15 D3), and a gate that is red by
// construction on every commit is one people stop reading. In DEPLOY posture it is a hard failure,
// because under default copyright nobody but the author may run, copy or modify this software — and
// "EU citizens self-host it" is the entire launch model.
const licence = ['LICENSE', 'LICENSE.md', 'LICENCE', 'LICENCE.md', 'COPYING'].find((f) => fs.existsSync(path.join(ROOT, f)));
add('LEGAL', licence ? PASS : isDeployPosture ? FAIL : WARN, 'a LICENSE file exists (docs/15 §3, decision D3)',
  licence ? `= ${licence}` : 'none — distributing this repo is unlawful today, and distribution IS the launch model');

// ---------- IDENTITY / EVIDENCE / CRYPTO (deploy posture only where env-shaped) ----------
const providerSeams = ['SCRAPER_MAILER', 'SCRAPER_POSTAL', 'SCRAPER_TIMESTAMPER', 'SCRAPER_IDENTITY', 'SCRAPER_DOC_SANDBOX'];
for (const seam of providerSeams) {
  const v = env[seam] ?? '(unset)';
  const real = v !== '(unset)' && v !== 'stub' && v !== 'simulated';
  add('IDENTITY', isDeployPosture ? (real ? PASS : FAIL) : WARN, `${seam} names a real adapter`, `= ${v}`);
}
add('IDENTITY', env.SCRAPER_DEV_FIXTURES === '1' ? (isDeployPosture ? FAIL : WARN) : PASS,
  'dev fixtures off outside development/test', env.SCRAPER_DEV_FIXTURES === '1' ? 'SCRAPER_DEV_FIXTURES=1' : '');
add('IDENTITY', env.SCRAPER_KEK_MODE === 'env' ? PASS : isDeployPosture ? FAIL : WARN,
  'SCRAPER_KEK_MODE=env (dev KEK resolver is allow-listed to dev/test)', `= ${env.SCRAPER_KEK_MODE ?? '(unset)'}`);
add('IDENTITY', env.LETTERXPRESS_MODE === 'sandbox' || !env.LETTERXPRESS_MODE ? WARN : HUMAN,
  'LetterXpress live mode requires the Auslieferungsbeleg fetch (OQ-11) — adapter returns proof:null until then',
  `LETTERXPRESS_MODE=${env.LETTERXPRESS_MODE ?? '(unset)'}`);

// ---------- COMPLIANCE / INFRA ----------
add('COMPLIANCE', (env.MODEL_REGION ?? 'eu') === 'eu' ? PASS : FAIL, 'MODEL_REGION=eu (no non-EU inference on personal data)',
  `= ${env.MODEL_REGION ?? 'eu (default)'}`);
add('COMPLIANCE', env.SCRAPER_CORS_ORIGINS ? PASS : isDeployPosture ? FAIL : WARN,
  'SCRAPER_CORS_ORIGINS set (dev list must never serve a deployment)', env.SCRAPER_CORS_ORIGINS ? '' : '(unset)');
// ---------- OBJECT STORE: a round trip, not a non-empty string ----------
//
// This row used to test that `OBJECT_STORE_ENDPOINT` was truthy. Setting the variable to any value
// at all turned a launch gate green while changing nothing — and there was no adapter behind it, so
// the worker wrote `unconfigured://<key>` into every evidence record: a well-formed reference to
// nothing. PRE-SEND-CHECKLIST §5.2 carried it as a known-unverified gate for exactly that reason.
//
// The question the gate is supposed to answer is "will the letter we hashed still be there, and can
// we destroy a raw document when its retention window expires" (CLAUDE.md §6 and §4). Only a round
// trip answers it: write, read back, compare the SHA-256, delete, confirm it is gone. For the
// filesystem store that needs no network and no account, so it happens here. For S3 it needs signed
// requests and credentials a build machine does not have, so this names the command instead of
// pretending — `pnpm --filter @scraper/worker probe:store` runs the same four steps through the
// adapter itself.
//
// Deliberately NOT folded into the `providerSeams` loop above even though `SCRAPER_OBJECT_STORE` is
// the sixth entry of the worker's REQUIRED_REAL_PROVIDERS: that loop can only check that a string
// is not "stub", and here we can do better.
function probeFilesystemObjectStore(configuredRoot) {
  const root = path.resolve(configuredRoot);
  const dir = path.join(root, 'readiness-probe');
  const file = path.join(dir, `${crypto.randomBytes(8).toString('hex')}.txt`);
  const body = `scraper readiness probe ${new Date().toISOString()}\n`;
  const expected = crypto.createHash('sha256').update(body).digest('hex');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, body, { mode: 0o600 });
    const readBack = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (readBack !== expected) return { ok: false, detail: `read-back hashed to ${readBack.slice(0, 12)}…, not ${expected.slice(0, 12)}…` };
    fs.unlinkSync(file);
    // A store that cannot DELETE is a store on which CLAUDE.md §4 retention silently fails.
    if (fs.existsSync(file)) return { ok: false, detail: 'the object is still readable after delete' };
    try { fs.rmdirSync(dir); } catch { /* other probes may be running; an empty dir is harmless */ }
    return { ok: true, detail: `round trip ok under ${root}` };
  } catch (e) {
    return { ok: false, detail: `${e.code ?? ''} ${e.message}`.trim() };
  }
}

const objectStore = env.SCRAPER_OBJECT_STORE;
if (!objectStore) {
  add('COMPLIANCE', isDeployPosture ? FAIL : WARN,
    'SCRAPER_OBJECT_STORE selects a store (evidence artefacts + the purge sweep need one)', '(unset)');
} else if (objectStore === 'fs') {
  const root = env.OBJECT_STORE_FS_ROOT;
  const probe = root ? probeFilesystemObjectStore(root) : { ok: false, detail: 'OBJECT_STORE_FS_ROOT is unset' };
  add('COMPLIANCE', probe.ok ? PASS : FAIL,
    'object store round-trips (put → read back → SHA-256 → delete → gone)', probe.detail);
  // A disk is EU-resident by construction only in the sense that the operator knows where the
  // machine is. Nothing here can check that, and neither can anything else — see docs/14 posture A.
  add('COUNSEL', HUMAN, 'the filesystem object store is on EU-resident, encrypted, backed-up storage that survives a restart');
} else if (objectStore === 's3') {
  const missing = ['OBJECT_STORE_ENDPOINT', 'OBJECT_STORE_BUCKET', 'OBJECT_STORE_REGION', 'OBJECT_STORE_ACCESS_KEY_ID', 'OBJECT_STORE_SECRET_ACCESS_KEY'].filter((k) => !env[k]);
  add('COMPLIANCE', missing.length === 0 ? PASS : isDeployPosture ? FAIL : WARN,
    'S3 object store fully configured', missing.length ? `missing: ${missing.join(', ')}` : `= ${env.OBJECT_STORE_ENDPOINT}/${env.OBJECT_STORE_BUCKET} (${env.OBJECT_STORE_REGION})`);
  add('COMPLIANCE', HUMAN,
    'object store round trip — readiness cannot sign a request from here; run `pnpm --filter @scraper/worker probe:store`');
  // The adapter refuses a non-EU region STRING. It cannot tell where a host is: a MinIO instance in
  // Virginia answers to `eu-central-1` perfectly happily (CLAUDE.md §3).
  add('COUNSEL', HUMAN, 'the S3 endpoint is physically in the EU and the bucket is private, encrypted and un-versioned');
} else {
  add('COMPLIANCE', FAIL, 'SCRAPER_OBJECT_STORE names a known store', `= ${objectStore} (expected fs | s3)`);
}

// Persistence and durable time. These three mirror `assertApiStartupSafe()`
// (apps/api/src/common/startup-safety.ts), which is NORMATIVE — it refuses the boot; this only
// reports. `apps/api/test/startup-safety.test.ts` runs this script against the same environments as
// the boot gate and asserts the two agree, so the duplication cannot drift silently.
//
// They are reported rather than left to the boot because the failure they describe is invisible at
// runtime. An operator who reaches the pre-send checklist on an in-memory node has a product that
// answers every request correctly and forgets all of it on the next restart — including the evidence
// chain that a statutory claim rests on.
add('COMPLIANCE', env.DATABASE_URL ? PASS : isDeployPosture ? FAIL : WARN,
  'DATABASE_URL set (EU-region Postgres — docs/02 residency)', env.DATABASE_URL ? '' : '(unset)');
add('COMPLIANCE', env.SCRAPER_REPOSITORY === 'prisma' ? PASS : isDeployPosture ? FAIL : WARN,
  'SCRAPER_REPOSITORY=prisma (the in-memory adapter loses every request and evidence record on restart)',
  `= ${env.SCRAPER_REPOSITORY ?? '(unset)'}`);
add('COMPLIANCE', env.SCRAPER_SCHEDULER === 'pgboss' ? PASS : isDeployPosture ? FAIL : WARN,
  'SCRAPER_SCHEDULER=pgboss (without it NO Frist timer is ever armed — deadlines never fire)',
  `= ${env.SCRAPER_SCHEDULER ?? '(unset)'}`);

// ---------- COUNSEL (never auto-passable) ----------
for (const label of [
  'every controller endpoint verified against the CURRENT Datenschutz page (docs/07 TODO(counsel) rows)',
  'Art. 77 venue confirmed per controller (incl. CRIF seat move München→Karlsruhe; HIS operator → Hessen)',
  'RDG posture decided per deployment model (docs/14: posture A = self-representation, OQ-29; operated nodes = Inkasso vs lawyer white-label)',
  'DPIA signed AFTER §6 reflects implementation (identity + erasure landed 2026-08-14; credit-file sealing, DB-role split and the backup window are open)',
  'ident/QTSP/postal contracts signed; stubs disabled; dry run against a test controller done',
  'deployment posture declared (docs/14 §1 — record A/B/C, operator and date there); for operated nodes the DPIA instantiated with that node\'s own stack (docs/11 §4)',
  'docs/15 decisions D1–D9 answered, or at least the ones this send depends on (D5 first letter, D6 QTSP, D7 mandate form)',
]) add('COUNSEL', HUMAN, label);

// ---------- report ----------
const ICON = { [PASS]: '  ✓', [FAIL]: '  ✗', [WARN]: '  •', [HUMAN]: '  ☐' };
let failures = 0;
for (const track of ['LEGAL', 'IDENTITY', 'COMPLIANCE', 'COUNSEL']) {
  console.log(`\n${track}`);
  for (const r of rows.filter((r) => r.track === track)) {
    if (r.status === FAIL) failures += 1;
    console.log(`${ICON[r.status]} ${r.label}${r.detail ? `  — ${r.detail}` : ''}`);
  }
}
const postureLabel = isCi
  ? 'CI (repo-answerable rows gate; environment rows are warnings)'
  : isDeployPosture ? 'DEPLOY' : `dev (NODE_ENV=${env.NODE_ENV})`;
console.log(`\n${failures ? `${failures} FAILURES` : 'no mechanical failures'} · posture: ${postureLabel} · ☐ boxes are humans-only, a script cannot tick them`);
if (failures) process.exitCode = 1;
