import { describe, expect, it } from 'vitest';
import {
  outcomeForRequestType,
  planRequestCreation,
  type SelfServeRoute,
  type StatutoryRequestType,
} from '../src/index.js';
import { ENRICHMENT_BROKER_ROUTES } from '../src/leverage/broker-routes.seed.js';

function route(over: Partial<SelfServeRoute> & Pick<SelfServeRoute, 'companySlug' | 'routeType' | 'url'>): SelfServeRoute {
  return { steps: [], requiresLogin: false, ...over };
}

describe('outcomeForRequestType', () => {
  it('maps erasure to the ERASURE outcome', () => {
    expect(outcomeForRequestType('ERASURE_ART17')).toBe('ERASURE');
  });

  it('returns null for access, provenance AND objection — none has a safe self-serve equivalent', () => {
    expect(outcomeForRequestType('ACCESS_ART15')).toBeNull();
    expect(outcomeForRequestType('ACCESS_ART15_SOURCE')).toBeNull();
    // Art. 21(1) vs 21(2) are one enum value; routing a 21(1) objection to a marketing form is wrong.
    expect(outcomeForRequestType('OBJECTION_ART21')).toBeNull();
  });

  it('throws on an unknown request type rather than silently demoting it to the legal path', () => {
    expect(() => outcomeForRequestType('GARBAGE' as unknown as StatutoryRequestType)).toThrow(/unmapped/i);
  });
});

describe('planRequestCreation — cheapest-rung-first (docs/08 guardrail 5)', () => {
  it('does NOT create a legal request when a self-serve route achieves the erasure', () => {
    const plan = planRequestCreation({
      requestType: 'ERASURE_ART17',
      controllerSlug: 'zoominfo',
      selfServeRoutes: ENRICHMENT_BROKER_ROUTES, // the real seeded ZoomInfo removal form
      legalPlaybookAvailable: true, // a legal playbook exists, but self-serve must still win
    });
    expect(plan.kind).toBe('PREFER_SELF_SERVE');
    if (plan.kind === 'PREFER_SELF_SERVE') {
      expect(plan.route.companySlug).toBe('zoominfo');
      expect(plan.leverageAction.tier).toBe('1');
      expect(plan.leverageAction.mechanism).toBe('SELF_SERVE_ROUTED');
    }
  });

  it('falls through to a legal request when no self-serve route matches but a playbook exists', () => {
    const plan = planRequestCreation({
      requestType: 'ERASURE_ART17',
      controllerSlug: 'some-broker-without-a-route',
      selfServeRoutes: ENRICHMENT_BROKER_ROUTES,
      legalPlaybookAvailable: true,
    });
    expect(plan.kind).toBe('CREATE_LEGAL');
    if (plan.kind === 'CREATE_LEGAL') expect(plan.leverageAction.tier).toBe('LEGAL');
  });

  it('reports NO_ROUTE (does not materialise a legal request) when there is no route AND no playbook', () => {
    const plan = planRequestCreation({
      requestType: 'ERASURE_ART17',
      controllerSlug: 'unknown-controller',
      selfServeRoutes: [],
      legalPlaybookAvailable: false,
    });
    expect(plan.kind).toBe('NO_ROUTE');
    if (plan.kind === 'NO_ROUTE') expect(plan.leverageAction.tier).toBe('NONE');
  });

  it('never routes an OBJECTION_ART21 to self-serve, even if a marketing route exists (21(1) vs 21(2))', () => {
    const prefs = [route({ companySlug: 'acme', routeType: 'MARKETING_PREFS', url: 'https://x/prefs' })];
    const plan = planRequestCreation({
      requestType: 'OBJECTION_ART21',
      controllerSlug: 'acme',
      selfServeRoutes: prefs,
      legalPlaybookAvailable: true,
    });
    expect(plan.kind).toBe('CREATE_LEGAL'); // objection has no safe self-serve equivalent here
  });

  it('never routes an ACCESS_ART15 to self-serve, even if a route exists for that controller', () => {
    const withRoute = [route({ companySlug: 'zoominfo', routeType: 'DSR_ERASURE', url: 'https://x/remove' })];
    const plan = planRequestCreation({
      requestType: 'ACCESS_ART15',
      controllerSlug: 'zoominfo',
      selfServeRoutes: withRoute,
      legalPlaybookAvailable: true,
    });
    expect(plan.kind).toBe('CREATE_LEGAL');
  });

  it('reports NO_ROUTE for an access request when no legal playbook exists', () => {
    const plan = planRequestCreation({
      requestType: 'ACCESS_ART15',
      controllerSlug: 'no-playbook-controller',
      selfServeRoutes: [],
      legalPlaybookAvailable: false,
    });
    expect(plan.kind).toBe('NO_ROUTE');
  });

  it('never routes the ACCESS_ART15_SOURCE flagship to self-serve', () => {
    const plan = planRequestCreation({
      requestType: 'ACCESS_ART15_SOURCE',
      controllerSlug: 'schufa',
      selfServeRoutes: [route({ companySlug: 'schufa', routeType: 'DSR_ERASURE', url: 'https://x' })],
      legalPlaybookAvailable: true,
    });
    expect(plan.kind).toBe('CREATE_LEGAL');
  });

  it('propagates the guided flag for a login-gated route', () => {
    const login = [route({ companySlug: 'acme', routeType: 'DSR_ERASURE', url: 'https://x', requiresLogin: true })];
    const plan = planRequestCreation({
      requestType: 'ERASURE_ART17',
      controllerSlug: 'acme',
      selfServeRoutes: login,
      legalPlaybookAvailable: false,
    });
    expect(plan.kind).toBe('PREFER_SELF_SERVE');
    if (plan.kind === 'PREFER_SELF_SERVE') expect(plan.guided).toBe(true);
  });

  it('every plan carries a LeverageAction so the decision is always recorded', () => {
    for (const rt of ['ERASURE_ART17', 'ACCESS_ART15', 'OBJECTION_ART21'] as StatutoryRequestType[]) {
      const plan = planRequestCreation({ requestType: rt, controllerSlug: 'nobody', selfServeRoutes: [], legalPlaybookAvailable: true });
      expect(typeof plan.leverageAction.costCents).toBe('number');
      expect(plan.leverageAction.mechanism.length).toBeGreaterThan(0);
    }
  });
});
