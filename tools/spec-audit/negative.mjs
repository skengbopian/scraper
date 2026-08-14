// Negative tests: what does the validation stack ACCEPT that it must not?
//
// The stack is schema + playbook-lint.mjs. Three of these defects (outcome contradiction, template
// binding, version mutation) are structurally beyond JSON Schema, so testing the schema alone would
// either report permanent unfixable holes or tempt someone to delete the cases. Testing the real gate
// is the honest bar — see playbook-lint.mjs.
//
// !! Each case must be rejected FOR ITS OWN REASON. A base fixture that is itself invalid makes every
// !! case below pass vacuously — which is exactly what happened when `kind` and `active` became
// !! required and this file reported a triumphant 0 holes while testing nothing. The BASE SELF-CHECK
// !! at the bottom of this header block is the guard against that, and it is not optional.
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ROOT } from './root.mjs';
import { validatePlaybook } from './playbook-lint.mjs';

const schema = JSON.parse(fs.readFileSync(`${ROOT}/schema/playbook.schema.json`, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const ajvValidate = ajv.compile(schema);

// A MINIMAL VALID playbook. Every case below is this, mutated in exactly one way.
const base = {
  slug: 'test.case',
  kind: 'RIGHTS_REQUEST',
  controller: 'az-direct',
  requestType: 'OBJECTION_ART21',
  version: 1,
  active: false,
  channel: {
    primary: 'email',
    fallback: 'postal',
    registered: { primary: false, fallback: true },
  },
  recipient: {
    email: 'datenschutz@example.de',
    postal: 'AZ Direct GmbH, Datenschutz, Carl-Bertelsmann-Str. 161S, 33311 Gütersloh',
  },
  template: 'art21-werbewiderspruch.de',
  subjectFields: ['legalName', 'addresses'],
  deadlineDays: 30,
  validation: {
    compliedIf: { anyOf: [{ responseContains: ['Werbewiderspruch'] }] },
    humanReviewIfConfidenceBelow: 0.75,
  },
  escalation: { onDeadlineExpiry: 'DRAFT_ART77', onRefusal: 'DRAFT_ART77' },
  // Required since decision D4: anything that can draft an Art. 77 complaint must name a venue —
  // a seat DPA, or `venue: USER_RESIDENCE` when the controller has no German establishment. This
  // fixture mirrors the real az-direct playbook, so it takes the seat.
  //
  // Adding it here is not cosmetic. The base self-check below exists because a base fixture that
  // fails validation makes every negative case vacuous: each one would be "rejected" for the
  // missing venue rather than for the defect it was written to catch, and the file would report
  // 31/31 rejected while testing nothing at all. That is precisely what happened when the venue
  // conditional landed without this line.
  seatDpa: 'LDI_NRW',
};

const validation = (over) => ({ ...base, validation: { ...base.validation, ...over } });
const channel = (over) => ({ ...base, channel: { ...base.channel, ...over } });
const omit = (obj, key) => { const c = structuredClone(obj); delete c[key]; return c; };

const cases = [
  ['recipient is entirely empty — nothing to send to',
    { ...base, recipient: {} }, 'MUST REJECT'],
  ['channel.primary=postal but only an email recipient given',
    { ...base, channel: { primary: 'postal', registered: { primary: true } }, recipient: { email: 'a@b.de' } }, 'MUST REJECT'],
  ['channel.primary=web_form but only a postal recipient',
    { ...base, channel: { primary: 'web_form', fallback: 'postal', registered: { fallback: true } }, recipient: { postal: 'Somewhere in Germany 12345' } }, 'MUST REJECT'],
  ['recipient.email is not an email address at all',
    { ...base, recipient: { ...base.recipient, email: 'not-an-email ### <<' } }, 'MUST REJECT'],
  ['escalation object is empty — silent no-escalation',
    { ...base, escalation: {} }, 'MUST REJECT'],
  ['humanReviewIfConfidenceBelow omitted — no human-review floor (docs/06 C4)',
    { ...base, validation: omit(base.validation, 'humanReviewIfConfidenceBelow') }, 'MUST REJECT'],
  ['humanReviewIfConfidenceBelow = 0 — parser output auto-decides at ANY confidence (docs/06 C4)',
    validation({ humanReviewIfConfidenceBelow: 0 }), 'MUST REJECT'],
  ['compliedIf is an empty object — matches nothing / undefined semantics',
    validation({ compliedIf: {} }), 'MUST REJECT'],
  ['compliedIf.anyOf contains arbitrary garbage (items were unconstrained `type: object`)',
    validation({ compliedIf: { anyOf: [{ lol: 'wut', drop: 'table' }] } }), 'MUST REJECT'],
  ['compliedIf and refusedIf match the SAME string — contradictory outcome',
    validation({ compliedIf: { responseContains: ['gelöscht'] }, refusedIf: { responseContains: ['gelöscht'] } }), 'MUST REJECT'],
  ['controller slug is an unresolved placeholder',
    { ...base, controller: '__PARAM__' }, 'MUST REJECT'],
  ['recipient is an unresolved placeholder',
    { ...base, recipient: { ...base.recipient, email: '__PARAM__' } }, 'MUST REJECT'],
  ['template names a file that cannot exist (path traversal)',
    { ...base, template: '../../etc/passwd' }, 'MUST REJECT'],
  ['active=true with no counsel/verification marker',
    { ...base, active: true }, 'MUST REJECT'],
  ['ROBINSON: an industry opt-out forced to declare a statutory deadline + Art.77 escalation',
    { ...base, requestType: 'ROBINSON' }, 'MUST REJECT (no Art. 12(3) clock exists for a DDV Robinsonliste enrolment)'],
  ['EINMELDUNG_FRAUD: victim marker forced to declare deadlineDays + escalation',
    { ...base, requestType: 'EINMELDUNG_FRAUD' }, 'MUST REJECT (not a rights request with a statutory clock)'],
  ['registered=true on an EMAIL primary channel — Einwurf-Einschreiben by email is not a thing',
    channel({ registered: { primary: true, fallback: true } }), 'MUST REJECT'],
  ['legacy bare-boolean channel.registered — one flag for a two-channel config (H2)',
    channel({ registered: true }), 'MUST REJECT'],
  ['escalates on deadline expiry but no channel can produce a provable send (CLAUDE.md §6)',
    { ...base, channel: { primary: 'email', registered: { primary: false } }, recipient: { email: 'a@b.de' } }, 'MUST REJECT'],
  ['deadlineDays=1 — statutory clock is one month',
    { ...base, deadlineDays: 1 }, 'MUST REJECT'],
  ['subjectFields omits dateOfBirth while the bound template renders {{dateOfBirth}}',
    { ...base, template: 'art15g-herkunft.de', requestType: 'ACCESS_ART15_SOURCE', seatDpa: 'HBDI', provenance: { extractPerCategory: true }, subjectFields: ['legalName'] }, 'MUST REJECT'],
  ['ACCESS_ART15_SOURCE with no provenance block — flagship request that extracts nothing',
    { ...base, requestType: 'ACCESS_ART15_SOURCE', template: 'art15g-herkunft.de', seatDpa: 'HBDI', subjectFields: ['legalName', 'dateOfBirth', 'addresses'] }, 'MUST REJECT'],
  ['identityProof.required=true but accepts:[none] — self-contradictory',
    { ...base, identityProof: { required: true, accepts: ['none'] } }, 'MUST REJECT'],
  ['identityProof.accepts=[full_id] for a bare marketing objection — over-collection (docs/07)',
    { ...base, identityProof: { required: true, accepts: ['full_id'] } }, 'MUST REJECT'],
  ['seatDpa is free text — a typo silently misroutes an Art. 77 complaint',
    { ...base, seatDpa: 'LFDI_BAYERN_TYPO' }, 'MUST REJECT'],
  ['onIncompleteSourceList on a non-provenance request — escalation lever with no basis',
    { ...base, escalation: { ...base.escalation, onIncompleteSourceList: 'DRAFT_ART77' } }, 'MUST REJECT'],
  ['a one-character match needle — would auto-decide on noise in any German letter',
    validation({ compliedIf: { responseContains: ['x'] } }), 'MUST REJECT'],
  ['recipient.webForm is a plain http:// URL — credentials/identity over cleartext',
    { ...base, channel: { primary: 'web_form', fallback: 'postal', registered: { fallback: true } }, recipient: { ...base.recipient, webForm: 'http://example.de/form' } }, 'MUST REJECT'],

  // --- wave 4: the Art. 17(1)(d) partial-erasure scope, and the placeholder address it exposed ---
  ['the template states a bounded erasure scope but no scopeSource supplies it — {{#each categories}} over an unsupplied list renders NOTHING, so the letter announces "ausschließlich der folgenden Datenkategorien" and then lists none: an unbounded erasure demand at a credit bureau, arriving silently',
    { ...base,
      requestType: 'ERASURE_ART17',
      template: 'art17-loeschung-herkunft.de',
      subjectFields: ['legalName', 'dateOfBirth', 'addresses'],
      identityProof: { required: true, accepts: ['redacted_id'] },
      channel: { primary: 'postal', fallback: 'email', registered: { primary: true, fallback: false } },
      recipient: { postal: 'SCHUFA Holding AG, Datenschutz, Kormoranweg 5, 65201 Wiesbaden', email: 'datenschutz@example.de' },
    }, 'MUST REJECT'],
  ['scopeSource on a request type that never establishes a scope — an objection letter bounded by categories no Art. 21 answer produces',
    { ...base, scopeSource: 'PROVENANCE_ANSWER' }, 'MUST REJECT'],
  ['escalation drafts an Art. 77 complaint but names NO venue — neither a seat DPA nor venue: USER_RESIDENCE (decision D4). An absent venue used to be indistinguishable from a deliberately dynamic one, and explanation.retorio proved that "someone forgot" happens; the complaint would be drafted with nowhere to file it',
    omit(base, 'seatDpa'), 'MUST REJECT'],
  ['escalation names a venue on a trigger that is NOT DRAFT_ART77 — the conditional must not fire where no complaint can be drafted, or it would demand a venue of every playbook and stop meaning anything',
    { ...omit(base, 'seatDpa'), escalation: { onDeadlineExpiry: 'NONE', onRefusal: 'NONE' } }, 'MUST ACCEPT'],
  ['a REGISTERED postal channel whose address is a note-to-self ("TODO(counsel): verify") — over 10 characters and free of __PARAM__, so the schema accepts it, while a registered send is the only thing that starts the Art. 12(3) clock',
    { ...base,
      channel: { primary: 'email', fallback: 'postal', registered: { primary: false, fallback: true } },
      recipient: { ...base.recipient, postal: 'TODO(counsel): verify' },
    }, 'MUST REJECT'],
];

// ---------------------------------------------------------------------------
// BASE SELF-CHECK — without this the whole file can pass while testing nothing.
// ---------------------------------------------------------------------------
const baseErrors = validatePlaybook(base, ajvValidate);
console.log('BASE SELF-CHECK — the unmutated fixture must be VALID, or every case below is vacuous.');
if (baseErrors.filter((e) => e.severity === 'error').length) {
  console.log('  *** BASE FIXTURE IS INVALID — THESE RESULTS ARE MEANINGLESS ***');
  baseErrors.forEach((e) => console.log(`      [${e.severity} ${e.id}] ${e.message}`));
  console.log('\nFix the base fixture to match the current schema before trusting any result below.');
  process.exitCode = 1;
} else {
  console.log('  ok — base fixture is valid; each case is isolated to its own defect.\n');
}

console.log('NEGATIVE TESTS — does the validation stack reject playbooks that must never be sendable?\n');
let accepted = 0, rejected = 0;
const holes = [];
for (const [name, doc, expectation] of cases) {
  const errs = validatePlaybook(doc, ajvValidate).filter((e) => e.severity === 'error');
  const valid = errs.length === 0;
  if (valid) accepted++; else rejected++;
  // Both directions are enforced. A MUST ACCEPT case that gets rejected is not a "hole" in the
  // safety sense — nothing unsafe gets through — but it is exactly as damaging to this file's
  // meaning: it means a conditional fires where it should not, and the fixtures below it start
  // failing for a shared reason rather than for their own defect (which is what the base
  // self-check above exists to prevent, one level up).
  const bad = valid ? expectation.startsWith('MUST REJECT') : expectation.startsWith('MUST ACCEPT');
  if (bad) holes.push(`${expectation}: ${name}`);
  console.log(`${bad ? '  ✗ HOLE  ' : '  ·       '}${(valid ? 'ACCEPTED' : 'rejected').padEnd(9)} | ${name}`);
  if (!valid) console.log(`             └─ ${errs.map((e) => `${e.id}: ${e.message}`).join('; ').slice(0, 220)}`);
}

console.log(`\n${accepted} accepted, ${rejected} rejected out of ${cases.length}.`);
console.log(`${holes.length} of these are cases where the validation stack did the OPPOSITE of what it must.`);
holes.forEach((h) => console.log(`  - ${h}`));
if (holes.length) process.exitCode = 1;
