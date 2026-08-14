// Model the state machine exactly as written in schema/request-state-machine.md
// and test whether the journeys the rest of the docs REQUIRE are reachable.
const STATES = ['DRAFT','BLOCKED_IDENTITY','READY','SENT','AWAITING_DELIVERY_PROOF',
  'AWAITING_RESPONSE_PROVISIONAL',
  'AWAITING_RESPONSE','AWAITING_REGISTERED_RESEND','RESPONSE_RECEIVED','NEEDS_HUMAN','COMPLIED',
  'INCOMPLETE','REFUSED','ESCALATION_DRAFTED','ESCALATED','CLOSED_FAILED','WITHDRAWN'];

const TERMINAL = ['COMPLIED','CLOSED_FAILED','WITHDRAWN'];

// transcribed verbatim from the doc
const T = [
  ['DRAFT','guardFail(identity)','BLOCKED_IDENTITY'],
  ['DRAFT','guardFail(idempotency|mandate)','CLOSED_FAILED'],
  ['DRAFT','guardsPass','READY'],
  ['BLOCKED_IDENTITY','identityVerified:guardsPass','READY'],
  ['BLOCKED_IDENTITY','identityVerified:guardFail','CLOSED_FAILED'],
  ['READY','dispatch','SENT'],
  ['SENT','provableSendConfirmed','AWAITING_RESPONSE'],
  ['SENT','registeredSendLodged','AWAITING_DELIVERY_PROOF'],
  ['SENT','sendAccepted:nonProvable','AWAITING_RESPONSE_PROVISIONAL'],
  ['SENT','sendPermanentlyFailed','NEEDS_HUMAN'],
  ['AWAITING_DELIVERY_PROOF','provableSendConfirmed','AWAITING_RESPONSE'],
  ['AWAITING_DELIVERY_PROOF','responseIngested','RESPONSE_RECEIVED'],
  ['AWAITING_DELIVERY_PROOF','proofRetrievalFailed','NEEDS_HUMAN'],
  ['AWAITING_RESPONSE_PROVISIONAL','responseIngested','RESPONSE_RECEIVED'],
  ['AWAITING_RESPONSE_PROVISIONAL','provisionalDeadlineExpired','AWAITING_REGISTERED_RESEND'],
  ['AWAITING_REGISTERED_RESEND','userConfirmsResend:guardsPass','READY'],
  ['AWAITING_REGISTERED_RESEND','responseIngested','RESPONSE_RECEIVED'],
  ['AWAITING_REGISTERED_RESEND','userDeclinesResend','CLOSED_FAILED'],
  ['AWAITING_RESPONSE','responseIngested','RESPONSE_RECEIVED'],
  ['AWAITING_RESPONSE','deadlineExpired','ESCALATION_DRAFTED'],
  ['RESPONSE_RECEIVED','validated:complied','COMPLIED'],
  ['RESPONSE_RECEIVED','validated:incomplete','INCOMPLETE'],
  ['RESPONSE_RECEIVED','validated:refused','REFUSED'],
  ['RESPONSE_RECEIVED','lowConfidence|ambiguous','NEEDS_HUMAN'],
  ['NEEDS_HUMAN','humanResolve:complied','COMPLIED'],
  ['NEEDS_HUMAN','humanResolve:incomplete','INCOMPLETE'],
  ['NEEDS_HUMAN','humanResolve:refused','REFUSED'],
  ['NEEDS_HUMAN','humanResolve:escalate','ESCALATION_DRAFTED'],
  ['NEEDS_HUMAN','humanResolve:resend','READY'],
  ['INCOMPLETE','escalate','ESCALATION_DRAFTED'],
  ['INCOMPLETE','responseIngested','RESPONSE_RECEIVED'],
  ['REFUSED','escalate','ESCALATION_DRAFTED'],
  ['REFUSED','responseIngested','RESPONSE_RECEIVED'],
  ['ESCALATION_DRAFTED','humanSend','ESCALATED'],
  ['ESCALATION_DRAFTED','humanDiscard','CLOSED_FAILED'],
  ['ESCALATION_DRAFTED','responseIngested','RESPONSE_RECEIVED'],
  ['ESCALATED','responseIngested','RESPONSE_RECEIVED'],
  ['ESCALATED','resolved:complied','COMPLIED'],
  ['ESCALATED','resolved:failed','CLOSED_FAILED'],
];
// "(any non-terminal) --userWithdraw|mandateRevoked--> WITHDRAWN"
for (const s of STATES) if (!TERMINAL.includes(s)) T.push([s,'userWithdraw|mandateRevoked','WITHDRAWN']);

const out = (s) => T.filter(t => t[0] === s);
const inb = (s) => T.filter(t => t[2] === s);

const problems = [];

console.log('=== 1. States with no outbound transition (dead ends) ===');
for (const s of STATES) {
  const o = out(s).filter(t => t[1] !== 'userWithdraw|mandateRevoked');
  if (!o.length) {
    const kind = TERMINAL.includes(s) ? 'terminal (expected)' : '*** DEAD END (not declared terminal) ***';
    console.log(`  ${s.padEnd(20)} ${kind}`);
    if (!TERMINAL.includes(s)) problems.push(`${s} has no outbound transition but is not a terminal state`);
  }
}

console.log('\n=== 2. Unreachable states ===');
for (const s of STATES) {
  if (s === 'DRAFT') continue;
  if (!inb(s).length) { console.log(`  ${s} unreachable`); problems.push(`${s} unreachable`); }
}

console.log('\n=== 3. Required journeys (from docs) — reachable? ===');
function reach(from, to, banned = []) {
  const seen = new Set([from]); const q = [[from, []]];
  while (q.length) {
    const [s, path] = q.shift();
    if (s === to) return path;
    for (const [a, ev, b] of out(s)) {
      if (banned.includes(ev)) continue;
      if (!seen.has(b)) { seen.add(b); q.push([b, [...path, `${a} --${ev}--> ${b}`]]); }
    }
  }
  return null;
}
const journeys = [
  ['docs/09 Provenance: human reviews an INCOMPLETE source list and escalates it',
   'NEEDS_HUMAN','ESCALATION_DRAFTED', ['humanResolve:refused'],
   'playbooks set escalation.onIncompleteSourceList: DRAFT_ART77; an incomplete answer is neither complied nor refused'],
  ['docs/01 M1: user verifies identity after being blocked, then proceeds',
   'BLOCKED_IDENTITY','READY', [], 'CLAUDE.md usability gate: no dead-end screens'],
  ['Late response arrives after the deadline draft was created (routine in practice)',
   'ESCALATION_DRAFTED','RESPONSE_RECEIVED', [], 'controllers commonly answer past the one-month clock'],
  ['Controller answers after a complaint was filed',
   'ESCALATED','RESPONSE_RECEIVED', [], 'DPA complaints often prompt a late reply that must be recorded'],
  ['Baseline: deadline expiry produces a DRAFTED (not sent) complaint',
   'AWAITING_RESPONSE','ESCALATION_DRAFTED', [], 'docs/06 C4 / CLAUDE.md guardrail'],
  ['Baseline: refusal produces a DRAFTED complaint',
   'REFUSED','ESCALATION_DRAFTED', [], 'docs/04 step 7'],
];
for (const [name, from, to, banned, why] of journeys) {
  const p = reach(from, to, banned);
  console.log(`  ${p ? 'OK  ' : 'GAP '} ${from} -> ${to}`);
  console.log(`        ${name}`);
  if (p) console.log(`        path: ${p.join(' | ') || '(same state)'}`);
  else { console.log(`        NO PATH. Why it matters: ${why}`); problems.push(`No transition path ${from} -> ${to}: ${name}`); }
}

console.log('\n=== 3b. Anti-journeys (these MUST NOT be reachable) ===');
const antiJourneys = [
  ['C1: silence on a PROVISIONAL clock must never reach an Art. 77 draft',
   'AWAITING_RESPONSE_PROVISIONAL', 'ESCALATION_DRAFTED',
   ['responseIngested', 'userConfirmsResend:guardsPass'],
   'CLAUDE.md §6 / docs/05 §6: email is not proof of delivery, so a deadline that started on an email accept cannot support a DPA complaint. Escalation on SILENCE requires a provable send; only a registered re-send (userConfirmsResend) or an actual reply (responseIngested) may unlock it.'],
  ['C1: the provisional deadline must not itself be an escalation trigger',
   'AWAITING_REGISTERED_RESEND', 'ESCALATION_DRAFTED',
   ['responseIngested', 'userConfirmsResend:guardsPass'],
   'declining the registered re-send closes the request as NO_PROVABLE_CLOCK; it must not silently escalate'],
  ['F3a: a lodged registered send must never reach an Art. 77 draft without a receipt, a reply, or a human',
   'AWAITING_DELIVERY_PROOF', 'ESCALATION_DRAFTED',
   ['provableSendConfirmed', 'responseIngested',
    'humanResolve:escalate', 'humanResolve:incomplete', 'humanResolve:refused', 'humanResolve:complied', 'humanResolve:resend'],
   'Einlieferung is not Zustellung, so a lodged letter whose Auslieferungsbeleg never came back evidences nothing. The two legitimate exits are banned here (the receipt arrives -> provableSendConfirmed, or the controller replies -> responseIngested), and so is every humanResolve:* event. What remains is exactly what must remain: the timeout path proofRetrievalFailed dead-ends at NEEDS_HUMAN. No SYSTEM-driven path leaves that dead end — every onward edge requires HUMAN_OPS, and humanResolve:escalate is additionally refused by invariant 4b (no provable send, no controller response), which packages/core/test/state-machine.test.ts asserts directly.'],
];
for (const [name, from, to, banned, why] of antiJourneys) {
  const p = reach(from, to, banned);
  console.log(`  ${p ? 'VIOLATION' : 'OK       '} ${from} -/-> ${to}`);
  console.log(`        ${name}`);
  if (p) {
    console.log(`        LEAK: ${p.join(' | ')}`);
    console.log(`        Why it matters: ${why}`);
    problems.push(`FORBIDDEN path exists ${from} -> ${to}: ${name}`);
  }
}

console.log('\n=== 4. Can ESCALATED be reached without a human? (invariant 3) ===');
const autoEvents = T.filter(t => t[2]==='ESCALATED').map(t=>t[1]);
const humanGated = autoEvents.every(e => e.startsWith('human'));
console.log(`  inbound events to ESCALATED: ${autoEvents.join(', ')} -> ${humanGated ? 'OK, human-gated' : 'VIOLATION'}`);
if (!humanGated) problems.push('ESCALATED has a non-human inbound edge — an Art. 77 complaint could be auto-sent');
if (autoEvents.length !== 1) problems.push(`ESCALATED must have exactly one inbound edge (humanSend); found ${autoEvents.length}: ${autoEvents.join(', ')}`);

console.log('\n=== 5. Can COMPLIED be reached from parser output alone? (invariant 4) ===');
inb('COMPLIED').forEach(t => console.log(`  ${t[0]} --${t[1]}--> COMPLIED`));
console.log('  note: RESPONSE_RECEIVED --validated:complied--> COMPLIED is guarded only by prose invariant 4,');
console.log('        not by the transition graph. The graph alone permits an auto-complied transition.');

console.log('\n=== 6. Terminal-state sanity ===');
console.log(`  REFUSED is described as triggering escalation but is not listed as terminal; outbound: ${out('REFUSED').map(t=>t[1]).join(', ')}`);
console.log(`  COMPLIED outbound: ${out('COMPLIED').map(t=>t[1]).join(', ') || '(none — terminal)'}`);
console.log(`  ESCALATED can reach COMPLIED: ${!!reach('ESCALATED','COMPLIED')}`);

console.log(`\n=== SUMMARY: ${problems.length} structural problems ===`);
problems.forEach(p => console.log('  - ' + p));
