// `.env.example` versus what the code actually reads — in BOTH directions.
//
// The file is the operator's only description of the environment a node needs, and nothing checked
// it. By 2026-08-15 it advertised seventeen variables no code had ever read (MAILER_SENDING_DOMAIN,
// POSTAL_API_KEY, IDENTITY_PROVIDER, QES_PROVIDER, STRIPE_SECRET_KEY, TEMPORAL_ADDRESS …), omitted
// the five SCRAPER_* provider seams the worker requires in production, and named WORKFLOW_ENGINE
// where the worker reads SCRAPER_WORKFLOW_ENGINE. Every one of those is the same failure: an
// operator sets a careful, complete-looking environment and the process ignores it. On a
// decentralised launch (docs/14) the operator is a volunteer with no way to tell the difference.
//
// Two directions, because each catches a different rot:
//
//   declared but never read  -> the file promises that setting something does something.
//   read but never declared  -> a node needs a variable nobody documented; the operator finds out
//                               from a crash, or worse, from a default that quietly did the wrong
//                               thing.
//
// SCOPE. Sources are apps/, packages/, services/ and scripts/ — the code a deployment runs, plus
// readiness, which is part of the operator's surface. tools/ is excluded: this harness is a
// standalone dev utility, and its own SCRAPER_ROOT is not node configuration.
//
// The "declared but unread" scan reads test files too (a variable a test relies on is genuinely
// read); the "read but undeclared" scan does not (DATABASE_URL_TEST and CI are CI plumbing, not
// operator configuration, and demanding them in .env.example would be noise).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './root.mjs';

const SRC_DIRS = ['apps', 'packages', 'services', 'scripts'];
const SRC_EXT = new Set(['.ts', '.tsx', '.mjs', '.js']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'build', 'coverage', 'prisma']);
const isTestFile = (rel) => /(^|\/)test(s)?\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);

/**
 * Names read INDIRECTLY — through a helper, an array of selector names, or a template string —
 * which no regex over `env.NAME` can see.
 *
 * Each entry names a `probe`: text that must still appear in non-test source for the read to exist.
 * Deleting the read therefore fails this check rather than silently keeping a dead variable alive.
 * That is the whole reason the list is allowed to exist — an unverified exception list is just a
 * second thing to rot. The default probe is the quoted name; an entry overrides it only where the
 * name is never written out in full, which today is exactly one case.
 */
const INDIRECT_READS = {
  // SCRAPER_IDENTITY was here until the factory landed. It is gone from both lists deliberately:
  // the worker has no identity consumer, so demanding it made the process refuse to boot over a
  // variable it would then ignore. This check is what noticed — the entry outlived its read by one
  // commit, and the harness said so.
  SCRAPER_MAILER: 'apps/worker/src/config.ts REQUIRED_REAL_PROVIDERS + scripts/readiness.mjs providerSeams',
  SCRAPER_POSTAL: 'apps/worker/src/config.ts REQUIRED_REAL_PROVIDERS + scripts/readiness.mjs providerSeams',
  SCRAPER_TIMESTAMPER: 'apps/worker/src/config.ts REQUIRED_REAL_PROVIDERS + scripts/readiness.mjs providerSeams',
  SCRAPER_DOC_SANDBOX: 'apps/worker/src/config.ts REQUIRED_REAL_PROVIDERS + scripts/readiness.mjs providerSeams',
  RAW_RESPONSE_RETENTION_DAYS: 'apps/worker/src/config.ts positiveInt(env, ...)',
  GATEWAY_MAX_SENDS_PER_CONTROLLER_PER_HOUR: 'apps/worker/src/config.ts positiveInt(env, ...)',
  LETTERXPRESS_USER: 'apps/worker/src/providers/real-providers.ts env(name)',
  LETTERXPRESS_APIKEY: 'apps/worker/src/providers/real-providers.ts env(name)',
  LETTERXPRESS_BASE: 'apps/worker/src/providers/real-providers.ts env(name)',
  QTSP_TOKEN: 'apps/worker/src/providers/real-providers.ts env(name)',
  QTSP_BASE: 'apps/worker/src/providers/real-providers.ts env(name)',
  POSTIDENT_CLIENT_ID: 'apps/worker/src/providers/real-providers.ts env(name)',
  POSTIDENT_PASSWORD: 'apps/worker/src/providers/real-providers.ts env(name)',
  POSTIDENT_BASE: 'apps/worker/src/providers/real-providers.ts env(name)',
  // EnvKekResolver builds the name: `SCRAPER_KEK_${kekRef.toUpperCase()}`. "user" is the only kekRef
  // in use, so this is the one concrete variable that template can produce today — and the only
  // entry whose full name is never written in the source, hence the explicit probe.
  SCRAPER_KEK_USER: {
    where: 'packages/core/src/crypto/envelope.ts EnvKekResolver, kekRef "user"',
    probe: 'SCRAPER_KEK_${kekRef',
  },
};

/**
 * Names a deployment never sets: they come from the CI runner, the test harness, or the shell.
 *
 * `USER` is the last of those — `corpus-cli` falls back to it to label who performed an activation,
 * and asking an operator to declare their own login name in `.env` would be noise.
 */
const NOT_OPERATOR_CONFIG = new Set(['CI', 'DATABASE_URL_TEST', 'SCRAPER_ROOT', 'USER']);

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* sourceFiles(full);
    } else if (SRC_EXT.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

const files = [];
for (const d of SRC_DIRS) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) files.push(...sourceFiles(abs));
}

// `process.env.NAME`, `process.env['NAME']`, and the `env: NodeJS.ProcessEnv` parameter idiom this
// repo uses throughout (`env.NAME` / `env['NAME']`) so a function's env is testable.
const DIRECT = /(?:process\.env|(?<![A-Za-z0-9_.])env)(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g;

const readAnywhere = new Map(); // NAME -> first file that reads it
const readInAppCode = new Map();
const appCodeText = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, 'utf8');
  const test = isTestFile(rel);
  if (!test) appCodeText.push({ rel, text });
  for (const m of text.matchAll(DIRECT)) {
    const name = m[1] ?? m[2];
    if (!readAnywhere.has(name)) readAnywhere.set(name, rel);
    if (!test && !readInAppCode.has(name)) readInAppCode.set(name, rel);
  }
}

const problems = [];
const notes = [];

// The indirect table earns its keep only if it is itself checked.
for (const [name, entry] of Object.entries(INDIRECT_READS)) {
  const where = typeof entry === 'string' ? entry : entry.where;
  const probe = typeof entry === 'string' ? null : entry.probe;
  const hit = appCodeText.find((f) =>
    probe ? f.text.includes(probe) : f.text.includes(`'${name}'`) || f.text.includes(`"${name}"`),
  );
  if (!hit) {
    problems.push(
      `INDIRECT_READS lists ${name} (${where}) but no non-test source mentions it — the read was ` +
        'removed. Delete the entry here and the variable from .env.example.',
    );
    continue;
  }
  if (!readAnywhere.has(name)) readAnywhere.set(name, hit.rel);
  if (!readInAppCode.has(name)) readInAppCode.set(name, hit.rel);
}

const examplePath = path.join(ROOT, '.env.example');
if (!fs.existsSync(examplePath)) {
  console.error('FAIL: .env.example does not exist — an operator has no description of the environment.');
  process.exit(1);
}
const declared = new Map(); // NAME -> line number
fs.readFileSync(examplePath, 'utf8').split('\n').forEach((line, i) => {
  const m = /^\s*([A-Z][A-Z0-9_]*)=/.exec(line);
  if (m) {
    if (declared.has(m[1])) problems.push(`.env.example declares ${m[1]} twice (lines ${declared.get(m[1])} and ${i + 1})`);
    else declared.set(m[1], i + 1);
  }
});

for (const [name, line] of declared) {
  if (readAnywhere.has(name)) continue;
  problems.push(
    `.env.example:${line} declares ${name}, which NO code reads. Setting it does nothing — delete ` +
      'it, or land it in the same commit as the adapter that reads it.',
  );
}

for (const [name, where] of readInAppCode) {
  if (declared.has(name) || NOT_OPERATOR_CONFIG.has(name)) continue;
  problems.push(
    `${where} reads ${name}, which .env.example does not declare. An operator configuring from ` +
      'that file would never set it.',
  );
}

notes.push(`${declared.size} declared · ${readInAppCode.size} read by shipped code · ${Object.keys(INDIRECT_READS).length} indirect`);

console.log('ENV SURFACE — .env.example against what the code reads\n');
for (const n of notes) console.log(`  · ${n}`);
if (problems.length === 0) {
  console.log('\nSUMMARY: 0 env-surface problems.');
} else {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\nSUMMARY: ${problems.length} env-surface problem(s).`);
  process.exitCode = 1;
}
