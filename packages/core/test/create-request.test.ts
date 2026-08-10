import { describe, expect, it } from 'vitest';
import {
  createRequest,
  type CreateRequestInput,
  type CreateRequestPort,
  type MandateSnapshot,
  type OpenRequestRef,
  type SelfServeRoute,
  type VerifiedIdentity,
} from '../src/index.js';

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

function route(over: Partial<SelfServeRoute> & Pick<SelfServeRoute, 'companySlug' | 'routeType' | 'url'>): SelfServeRoute {
  return { steps: [], requiresLogin: false, ...over };
}

interface PortOverrides {
  controllerId?: string | null;
  routes?: SelfServeRoute[];
  hasPlaybook?: boolean;
  mandates?: MandateSnapshot[];
  siblings?: OpenRequestRef[];
}

function makePort(over: PortOverrides = {}) {
  const calls = { insert: 0, record: 0, insertRows: [] as Record<string, unknown>[] };
  const port: CreateRequestPort = {
    findControllerIdBySlug: async () => (over.controllerId === undefined ? 'ctrl_1' : over.controllerId),
    findSelfServeRoutes: async () => over.routes ?? [],
    hasLegalPlaybook: async () => over.hasPlaybook ?? true,
    findLivemandates: async () => over.mandates ?? [mandate],
    findNonTerminalSiblings: async () => over.siblings ?? [],
    countTerminalPredecessors: async () => 0,
    insert: async (row) => { calls.insert++; calls.insertRows.push(row); return { id: String(row.id) }; },
    recordLeverageAction: async () => { calls.record++; },
  };
  return { port, calls };
}

function input(over: Partial<CreateRequestInput> = {}): CreateRequestInput {
  return { userId: 'u1', identity, controllerSlug: 'zoominfo', requestType: 'ERASURE_ART17', cause: 'USER_INITIATED', ...over };
}

const opts = { now: NOW, requestId: 'req_test' };

describe('createRequest — behavioural (a legal request is NOT created when a self-serve route exists)', () => {
  it('PREFER_SELF_SERVE: returns SELF_SERVE and NEVER calls insert', async () => {
    const { port, calls } = makePort({ routes: [route({ companySlug: 'zoominfo', routeType: 'DSR_ERASURE', url: 'https://x/remove' })] });
    const r = await createRequest(port, input(), opts);
    expect(r.kind).toBe('SELF_SERVE');
    expect(calls.insert).toBe(0); // the behavioural guarantee: no legal request materialised
    expect(calls.record).toBe(1); // the decision is recorded
  });

  it('NO_ROUTE: no self-serve route and no playbook ⇒ NO_ROUTE, insert never called', async () => {
    const { port, calls } = makePort({ routes: [], hasPlaybook: false });
    const r = await createRequest(port, input(), opts);
    expect(r.kind).toBe('NO_ROUTE');
    expect(calls.insert).toBe(0);
  });

  it('CREATE_LEGAL: no route but a playbook exists and guards pass ⇒ CREATED, insert called once', async () => {
    const { port, calls } = makePort({ routes: [], hasPlaybook: true });
    const r = await createRequest(port, input(), opts);
    expect(r.kind).toBe('CREATED');
    expect(calls.insert).toBe(1);
    // The inserted subject snapshot is derived, not free-typed.
    expect(calls.insertRows[0]!.subjectLegalName).toBe('Erika Mustermann');
    expect(calls.insertRows[0]!.state).toBe('READY');
  });

  it('CONTROLLER_NOT_FOUND: unknown controller ⇒ no insert', async () => {
    const { port, calls } = makePort({ controllerId: null });
    const r = await createRequest(port, input(), opts);
    expect(r.kind).toBe('CONTROLLER_NOT_FOUND');
    expect(calls.insert).toBe(0);
  });

  it('IDENTITY_MISMATCH: identity.userId ≠ userId ⇒ no insert (anti-stalker keystone on the short-circuit path)', async () => {
    const { port, calls } = makePort();
    const r = await createRequest(port, input({ userId: 'someone-else' }), opts);
    expect(r.kind).toBe('IDENTITY_MISMATCH');
    expect(calls.insert).toBe(0);
  });

  it('GUARD_FAILED: an open sibling triggers the idempotency guard ⇒ no insert', async () => {
    const sibling: OpenRequestRef = { id: 'other', userId: 'u1', controllerId: 'ctrl_1', requestType: 'ACCESS_ART15' };
    const { port, calls } = makePort({ routes: [], hasPlaybook: true, siblings: [sibling] });
    const r = await createRequest(port, input({ requestType: 'ACCESS_ART15' }), opts);
    expect(r.kind).toBe('GUARD_FAILED');
    if (r.kind === 'GUARD_FAILED') expect(r.failed).toBe('idempotency');
    expect(calls.insert).toBe(0);
  });
});
