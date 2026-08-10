import { describe, expect, it } from 'vitest';
import {
  assessApplicantRetention,
  createRequest,
  ENRICHMENT_BROKER_ROUTES,
  InMemoryRequestsRepository,
  SOURCE_HARDENING_ROUTES,
  type CreateRequestInput,
  type InMemorySeed,
  type MandateSnapshot,
  type VerifiedIdentity,
} from '../src/index.js';

/**
 * ENGINE END-TO-END: assemble the in-memory repository with the real census + self-serve routes and run
 * the create wiring for every branch. This RUNS the pipeline (cheapest-rung routing → identity binding →
 * guards → idempotency → insert), not just its pure decision function.
 */

const NOW = new Date('2026-08-10T00:00:00Z');

const identity: VerifiedIdentity = {
  id: 'id_1', userId: 'u1', status: 'VERIFIED', method: 'EID',
  legalName: 'Erika Mustermann', dateOfBirth: new Date('1979-03-12T00:00:00Z'),
  addresses: [{ street: 'Heidestraße 17', postalCode: '51147', city: 'Köln', country: 'DE', current: true, verifiedAt: NOW }],
  verifiedAt: NOW, providerRef: 'idnow_abc',
};
const mandate: MandateSnapshot = {
  id: 'm1', userId: 'u1', scope: ['ERASURE_ART17', 'ACCESS_ART15', 'ACCESS_ART15_SOURCE', 'OBJECTION_ART21'], signedAt: NOW, revokedAt: null,
};

function seed(): InMemorySeed {
  return {
    controllers: [
      { slug: 'zoominfo', id: 'c_zoominfo' },
      { slug: 'schufa', id: 'c_schufa' },
      { slug: 'hirevue', id: 'c_hirevue' },
      { slug: 'linkedin', id: 'c_linkedin' },
      // A demo fixture with an ACTIVE playbook, to exercise CREATE_LEGAL without activating a real one.
      { slug: 'demo-broker', id: 'c_demo' },
    ],
    selfServeRoutes: [...ENRICHMENT_BROKER_ROUTES, ...SOURCE_HARDENING_ROUTES],
    activePlaybooks: [{ controllerSlug: 'demo-broker', requestType: 'ERASURE_ART17' }],
    mandates: [mandate],
  };
}

function input(over: Partial<CreateRequestInput> = {}): CreateRequestInput {
  return { userId: 'u1', identity, controllerSlug: 'zoominfo', requestType: 'ERASURE_ART17', cause: 'USER_INITIATED', ...over };
}

describe('engine end-to-end (in-memory boot)', () => {
  it('routes a ZoomInfo erasure to the self-serve form — no legal request is created', async () => {
    const repo = new InMemoryRequestsRepository(seed());
    const r = await createRequest(repo, input({ controllerSlug: 'zoominfo' }), { now: NOW, requestId: 'req_1' });
    expect(r.kind).toBe('SELF_SERVE');
    if (r.kind === 'SELF_SERVE') expect(r.route.url).toContain('zoominfo.com');
    expect(repo.allRequests.length).toBe(0); // nothing inserted
    expect(repo.leverageActions.map((a) => a.mechanism)).toContain('SELF_SERVE_ROUTED');
  });

  it('creates a legal request when a playbook exists and there is no self-serve route', async () => {
    const repo = new InMemoryRequestsRepository(seed());
    const r = await createRequest(repo, input({ controllerSlug: 'demo-broker' }), { now: NOW, requestId: 'req_2' });
    expect(r.kind).toBe('CREATED');
    expect(repo.allRequests.length).toBe(1);
    expect(repo.allRequests[0]!.state).toBe('READY');
    expect(repo.leverageActions.map((a) => a.mechanism)).toContain('REQUEST_CREATED');
  });

  it('reports NO_ROUTE for the counsel-gated flagship (Schufa provenance not yet active)', async () => {
    const repo = new InMemoryRequestsRepository(seed());
    const r = await createRequest(repo, input({ controllerSlug: 'schufa', requestType: 'ACCESS_ART15_SOURCE' }), { now: NOW, requestId: 'req_3' });
    expect(r.kind).toBe('NO_ROUTE'); // no self-serve equivalent and no active playbook → honest "not yet"
    expect(repo.allRequests.length).toBe(0);
  });

  it('reports NO_ROUTE for an AI-screener access request with no active playbook', async () => {
    const repo = new InMemoryRequestsRepository(seed());
    const r = await createRequest(repo, input({ controllerSlug: 'hirevue', requestType: 'ACCESS_ART15' }), { now: NOW, requestId: 'req_4' });
    expect(r.kind).toBe('NO_ROUTE');
  });

  it('the idempotency guard blocks a second open legal request for the same triple', async () => {
    const repo = new InMemoryRequestsRepository(seed());
    const first = await createRequest(repo, input({ controllerSlug: 'demo-broker' }), { now: NOW, requestId: 'req_5a' });
    expect(first.kind).toBe('CREATED');
    const second = await createRequest(repo, input({ controllerSlug: 'demo-broker' }), { now: NOW, requestId: 'req_5b' });
    expect(second.kind).toBe('GUARD_FAILED');
    if (second.kind === 'GUARD_FAILED') expect(second.failed).toBe('idempotency');
    expect(repo.allRequests.length).toBe(1); // the second was not inserted
  });

  it('allows a fresh cycle once the previous request reaches a terminal state (ADR-013)', async () => {
    const repo = new InMemoryRequestsRepository(seed());
    const first = await createRequest(repo, input({ controllerSlug: 'demo-broker' }), { now: NOW, requestId: 'req_c1' });
    expect(first.kind).toBe('CREATED');
    // While it is open, a second is blocked (proven above). Drive it terminal (user withdraws)...
    await repo.applyTransition('req_c1', { from: 'READY', to: 'WITHDRAWN', event: 'userWithdraw', actor: 'USER', at: NOW, patch: { outcome: 'WITHDRAWN' } });
    // ...now a new cycle is allowed (the predecessor is terminal, so no non-terminal sibling remains).
    const second = await createRequest(repo, input({ controllerSlug: 'demo-broker' }), { now: NOW, requestId: 'req_c2' });
    expect(second.kind).toBe('CREATED');
    expect(repo.allRequests.filter((r) => r.state === 'WITHDRAWN').length).toBe(1);
    expect(repo.allRequests.filter((r) => r.state === 'READY').length).toBe(1);
  });

  it('rejects a request whose identity does not belong to the caller (anti-stalker keystone)', async () => {
    const repo = new InMemoryRequestsRepository(seed());
    const r = await createRequest(repo, input({ userId: 'someone-else' }), { now: NOW, requestId: 'req_6' });
    expect(r.kind).toBe('IDENTITY_MISMATCH');
    expect(repo.allRequests.length).toBe(0);
  });

  it('runs the applicant-retention engine alongside the request pipeline', async () => {
    const f = assessApplicantRetention(
      { controllerSlug: 'acme-gmbh', rejectedAt: new Date('2025-12-01T00:00:00Z'), aggClaimPending: false, talentPoolConsent: false },
      NOW,
    );
    expect(f.severity).toBe('OVERDUE');
    expect(f.recommendedAction).toBe('REQUEST_ERASURE');
  });
});
