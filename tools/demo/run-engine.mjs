// Runnable end-to-end demo of the request engine (docs/10: boot).
//
// Assembles the in-memory repository with the real census + self-serve routes and runs the create
// wiring for each branch, then the applicant-retention engine. No database, no NestJS — the pure
// pipeline running end to end. Run:  node tools/demo/run-engine.mjs
import {
  assessApplicantRetention,
  createRequest,
  ENRICHMENT_BROKER_ROUTES,
  InMemoryRequestsRepository,
  SOURCE_HARDENING_ROUTES,
} from '../../packages/core/dist/index.js';

const NOW = new Date('2026-08-10T00:00:00Z');

const identity = {
  id: 'id_1', userId: 'u1', status: 'VERIFIED', method: 'EID',
  legalName: 'Erika Mustermann', dateOfBirth: new Date('1979-03-12T00:00:00Z'),
  addresses: [{ street: 'Heidestraße 17', postalCode: '51147', city: 'Köln', country: 'DE', current: true, verifiedAt: NOW }],
  verifiedAt: NOW, providerRef: 'idnow_abc',
};
const mandate = { id: 'm1', userId: 'u1', scope: ['ERASURE_ART17', 'ACCESS_ART15', 'ACCESS_ART15_SOURCE', 'OBJECTION_ART21'], signedAt: NOW, revokedAt: null };

const repo = new InMemoryRequestsRepository({
  controllers: [
    { slug: 'zoominfo', id: 'c_zoominfo' },
    { slug: 'schufa', id: 'c_schufa' },
    { slug: 'hirevue', id: 'c_hirevue' },
    { slug: 'demo-broker', id: 'c_demo' },
  ],
  selfServeRoutes: [...ENRICHMENT_BROKER_ROUTES, ...SOURCE_HARDENING_ROUTES],
  activePlaybooks: [{ controllerSlug: 'demo-broker', requestType: 'ERASURE_ART17' }],
  mandates: [mandate],
});

let n = 0;
async function run(label, over) {
  const input = { userId: 'u1', identity, controllerSlug: 'zoominfo', requestType: 'ERASURE_ART17', cause: 'USER_INITIATED', ...over };
  const r = await createRequest(repo, input, { now: NOW, requestId: `req_${++n}` });
  const detail =
    r.kind === 'SELF_SERVE' ? `→ guided handoff: ${r.route.url}` :
    r.kind === 'CREATED' ? `→ RightsRequest ${r.id} (READY)` :
    r.kind === 'NO_ROUTE' || r.kind === 'GUARD_FAILED' || r.kind === 'IDENTITY_MISMATCH' ? `→ ${r.reason ?? r.failed ?? ''}` : '';
  console.log(`  ${label.padEnd(48)} ${r.kind.padEnd(16)} ${detail}`);
}

console.log('\n=== request engine (in-memory) ===\n');
await run('ERASURE @ zoominfo (self-serve route exists)', { controllerSlug: 'zoominfo' });
await run('ERASURE @ demo-broker (active playbook, no route)', { controllerSlug: 'demo-broker' });
await run('ERASURE @ demo-broker AGAIN (idempotency)', { controllerSlug: 'demo-broker' });
await run('ACCESS_ART15_SOURCE @ schufa (counsel-gated)', { controllerSlug: 'schufa', requestType: 'ACCESS_ART15_SOURCE' });
await run('ACCESS_ART15 @ hirevue (no active playbook)', { controllerSlug: 'hirevue', requestType: 'ACCESS_ART15' });

console.log(`\n  ledger: ${repo.allRequests.length} RightsRequest(s), ${repo.leverageActions.length} LeverageAction(s)`);
console.log(`  leverage mechanisms: ${repo.leverageActions.map((a) => `${a.tier}/${a.mechanism}`).join(', ')}`);

console.log('\n=== applicant-retention engine ===\n');
for (const [label, rec] of [
  ['rejected 2025-12-01, no claim/consent', { controllerSlug: 'acme', rejectedAt: new Date('2025-12-01T00:00:00Z'), aggClaimPending: false, talentPoolConsent: false }],
  ['rejected 2026-06-01, no claim/consent', { controllerSlug: 'acme', rejectedAt: new Date('2026-06-01T00:00:00Z'), aggClaimPending: false, talentPoolConsent: false }],
  ['rejected 2025-01-01, AGG claim pending', { controllerSlug: 'acme', rejectedAt: new Date('2025-01-01T00:00:00Z'), aggClaimPending: true, talentPoolConsent: false }],
]) {
  const f = assessApplicantRetention(rec, NOW);
  const due = f.deleteDueAt ? f.deleteDueAt.toISOString().slice(0, 10) : '—';
  console.log(`  ${label.padEnd(44)} ${f.severity.padEnd(9)} due:${due}  ${f.recommendedAction}`);
}
console.log('');
