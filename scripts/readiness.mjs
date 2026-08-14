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
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const isDeployPosture = env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test';

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

const draftTemplates = fs.readdirSync(path.join(ROOT, 'templates')).filter((f) => f.endsWith('.md'))
  .filter((f) => /\bDRAFT\b/.test(fs.readFileSync(path.join(ROOT, 'templates', f), 'utf8')));
add('LEGAL', draftTemplates.length ? HUMAN : PASS, 'templates counsel-signed (DRAFT marker removed)',
  draftTemplates.length ? `${draftTemplates.length} still DRAFT: ${draftTemplates.join(', ')}` : '');

for (const [name, args] of [
  ['spec-audit', ['tools/spec-audit/audit.mjs']],
  ['negative fixtures', ['tools/spec-audit/negative.mjs']],
  ['state-machine graph', ['tools/spec-audit/statemachine.mjs']],
  ['playbook version seal', ['tools/spec-audit/version-check.mjs']],
]) {
  try {
    execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'pipe' });
    add('LEGAL', PASS, `${name} green`);
  } catch (e) {
    add('LEGAL', FAIL, `${name} FAILED`, String(e.stdout ?? '').split('\n').find((l) => l.includes('FAIL')) ?? '');
  }
}

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
add('COMPLIANCE', env.OBJECT_STORE_ENDPOINT ? PASS : isDeployPosture ? FAIL : WARN,
  'EU object store configured (evidence artefacts + purge sweep need a real store)', env.OBJECT_STORE_ENDPOINT ? '' : '(unset)');

// ---------- COUNSEL (never auto-passable) ----------
for (const label of [
  'every controller endpoint verified against the CURRENT Datenschutz page (docs/07 TODO(counsel) rows)',
  'Art. 77 venue confirmed per controller (incl. CRIF seat move München→Karlsruhe; HIS operator → Hessen)',
  'RDG structure decided (Inkasso registration vs lawyer white-label)',
  'DPIA signed AFTER §6 reflects implementation (identity + erasure landed 2026-08-14; credit-file sealing, DB-role split and the backup window are open)',
  'ident/QTSP/postal contracts signed; stubs disabled; dry run against a test controller done',
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
console.log(`\n${failures ? `${failures} FAILURES` : 'no mechanical failures'} · posture: ${isDeployPosture ? 'DEPLOY' : `dev (NODE_ENV=${env.NODE_ENV})`} · ☐ boxes are humans-only, a script cannot tick them`);
if (failures) process.exitCode = 1;
