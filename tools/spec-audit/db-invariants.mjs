// DB-invariant gate: the migration chain must keep declaring the constraints, triggers and indexes
// the safety spec depends on.
//
// Why this exists: until port wave 1b, `tools/spec-audit` guarded the playbooks, the templates, the
// state machine and the docs — and NOTHING about the database. Every structural guarantee living in
// SQL ("a deadline cannot exist without a provable send", "a credit file cannot be bound to another
// user") could have been dropped by a later migration and no gate would have noticed.
//
// This is deliberately a STATIC check over the SQL, not a live-database check: it must run in CI
// with no Postgres, and it answers the question that actually matters — did someone remove an
// invariant from the chain? A live-schema assertion belongs in the integration suite, which is where
// `apps/api/test/db-invariants.test.ts` proves each rule actually rejects.
//
// Run: node tools/spec-audit/db-invariants.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = join(ROOT, 'packages/db/prisma/migrations');

/** name → why it exists. The "why" is printed on failure so the fix is not just "re-add the line". */
const REQUIRED = {
  deadline_requires_provable_send:
    'CLAUDE.md §6 / ADR-012: the Art. 12(3) clock may exist ONLY after a provable send. Without this a non-provable send can leave a statutory deadline on the row.',
  registered_is_postal_only:
    'docs/04 channel contract: "registered" is a property of postal mail; an email marked registered would fake a provable channel.',
  one_current_address_per_identity:
    'Zero current addresses renders an empty Anschrift line into a legal letter; more than one makes the renderer pick arbitrarily.',
  one_open_request_per_triple:
    'ADR-013: at most one non-terminal request per (user, controller, requestType) — accidental duplicates risk being deemed excessive under Art. 12(5).',
  request_event_append_only:
    'docs/03: the event log is the audit trail. Corrections are new rows; a deletable audit trail is not one.',
  evidence_record_append_only:
    'CLAUDE.md §6: evidence is chained and anchored. Mutable evidence cannot support a deadline assertion to a DPA.',
  escalation_requires_human_send:
    'CLAUDE.md §5 / ADR-008: an Art. 77 complaint reaches ESCALATED only via a HUMAN_OPS humanSend. Auto-escalation must be unrepresentable, not merely discouraged.',
  credit_file_snapshot_identity_binding:
    'CLAUDE.md the one rule / docs/10 §3.1: a credit file bound to another user, or to an unverified identity, must be impossible at the storage layer.',
  credit_file_snapshot_no_rebinding:
    'Same rule, after the fact: a stored snapshot may not be re-pointed at a different person later.',
  auth_credential_requires_envelope_key:
    'CLAUDE.md §4 (port wave 1b): a credential whose user has no envelope key material would hold an unopenable — or worse, unencrypted — second factor.',
  playbook_one_active:
    'docs/04: two active playbooks for one (controller, requestType) means row order decides which letter goes out.',
  playbook_freeze:
    'docs/04 authoring rule: shipped versions never mutate, or the counsel sign-off recorded against version N stops describing what version N sends.',
  identity_freeze:
    'ADR-009/019: the request subject is derived from the verified identity, so editing it in place silently changes whose data future requests concern.',
  request_binding_freeze:
    'The guards ran against (user, controller, playbook, requestType, cycle, idempotencyKey). Re-pointing any of them sends a request the guards never approved.',
  self_serve_login_is_guided:
    'docs/08 guardrail 1: a login-gated route stays a guided handoff, so it must carry the steps the USER follows — we never log in for them.',
  raw_document_requires_purge_date:
    'CLAUDE.md §4: keep the normalised record and hashed evidence, not the raw dump. A retained raw reference with no purge date is an open-ended retention.',

  // --- Auth policy (port wave 3, ADR-035) ------------------------------------------------------
  session_mfa_flags_agree:
    'ADR-035: mfaVerified and mfaCompletedAt describe one fact. Two columns that can disagree is the shape that drifts — and the disagreement that matters is a session the middleware treats as verified while the policy sees no second factor.',
  session_stepup_requires_mfa:
    'docs/06 C2: step-up is a RE-confirmation of the second factor. stepUpAt without mfaCompletedAt is a session that skipped the factor and then re-confirmed it — the path a half-authenticated session would take to the credit file.',
  totp_counter_monotonic:
    'ADR-035: totpLastCounter IS the TOTP replay defence. Rewinding or clearing it re-opens every code in between — which two concurrent MFA submissions would otherwise do, with the older counter landing last.',
  recovery_code_single_use:
    'docs/06 C2: a recovery code is a credential. Redeeming one twice, or un-using one, restores access an attacker may already have spent — and an application-level check is one early return, or one concurrent double-submit, away from being wrong.',
  user_failure_counts_non_negative:
    'ADR-035: a negative failure count silently disables the lockout it is supposed to drive.',
  session_expiry_sweep:
    'ADR-035: the expiry sweep must have an index matching the query it runs, partial on live sessions — otherwise session cleanup degrades exactly as the table grows.',
};

const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const sql = dirs.map((d) => readFileSync(join(MIGRATIONS, d, 'migration.sql'), 'utf8')).join('\n');

// Word-boundary match, not substring: renaming `playbook_one_active` to
// `playbook_one_active_REMOVED` must FAIL this gate, and a plain includes() would pass it.
const declared = (name) => new RegExp(`\\b${name}\\b`).test(sql);
const missing = Object.keys(REQUIRED).filter((name) => !declared(name));
const dropped = Object.keys(REQUIRED).filter(
  (name) => new RegExp(`DROP\\s+(CONSTRAINT|TRIGGER|INDEX)[^;]*${name}`, 'i').test(sql),
);

console.log(`db-invariants: ${dirs.length} migrations, ${Object.keys(REQUIRED).length} required invariants`);
for (const name of missing) {
  console.log(`\n[FAIL] "${name}" is not declared anywhere in the migration chain.\n        ${REQUIRED[name]}`);
}
for (const name of dropped) {
  console.log(`\n[FAIL] "${name}" is DROPped by a later migration.\n        ${REQUIRED[name]}`);
}

const failures = missing.length + dropped.length;
console.log(`\nSUMMARY: ${failures} failures, ${Object.keys(REQUIRED).length - missing.length} invariants present.`);
if (failures > 0) {
  console.error('An invariant may only be removed together with the spec rule that requires it — update both, in one change, with an ADR.');
  process.exit(1);
}
