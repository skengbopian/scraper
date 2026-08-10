import { describe, expect, it } from 'vitest';
import { assertNoCredential, chooseCheapestRung, type SelfServeRoute } from '../src/leverage/self-serve.js';
import { ENRICHMENT_BROKER_ROUTES, TARGET_ENRICHMENT_BROKERS } from '../src/leverage/broker-routes.seed.js';

const VALID_ROUTE_TYPES = new Set(['ACCOUNT_DELETION', 'MARKETING_PREFS', 'DO_NOT_SELL', 'AD_ID_RESET', 'CONSENT_WITHDRAWAL', 'DSR_ERASURE']);

describe('enrichment-broker seed (docs/10 §7.7 target #1)', () => {
  it('covers every ranked target broker with a route', () => {
    const covered = new Set(ENRICHMENT_BROKER_ROUTES.map((r) => r.companySlug));
    for (const slug of TARGET_ENRICHMENT_BROKERS) {
      expect(covered, `no self-serve route seeded for target broker "${slug}"`).toContain(slug);
    }
  });

  it('every route is well-formed: https URL, known routeType, has steps', () => {
    for (const r of ENRICHMENT_BROKER_ROUTES) {
      expect(r.url, `${r.companySlug} url must be https`).toMatch(/^https:\/\//);
      expect(VALID_ROUTE_TYPES, `${r.companySlug} routeType`).toContain(r.routeType);
      expect(r.steps.length, `${r.companySlug} needs guided steps`).toBeGreaterThan(0);
    }
  });

  it('no seeded route requires login or carries a credential (docs/08 guardrail 1)', () => {
    for (const r of ENRICHMENT_BROKER_ROUTES) {
      expect(r.requiresLogin, `${r.companySlug} must be a no-login self-serve route`).toBe(false);
      expect(() => assertNoCredential(r as unknown as Record<string, unknown>)).not.toThrow();
    }
  });

  it('each broker route is chosen over the legal fallback for an erasure (cheapest-rung-first)', () => {
    for (const slug of TARGET_ENRICHMENT_BROKERS) {
      const c = chooseCheapestRung({
        controllerSlug: slug,
        outcome: 'ERASURE',
        routes: ENRICHMENT_BROKER_ROUTES,
        legalPlaybookAvailable: true,
      });
      expect(c.rung, `${slug} should route to its self-serve form first`).toBe('SELF_SERVE');
      if (c.rung === 'SELF_SERVE') {
        expect(c.route.companySlug).toBe(slug);
        expect(c.guided).toBe(false); // email-code forms are not login-gated
      }
    }
  });

  it('does not accidentally seed a duplicate slug', () => {
    const slugs = ENRICHMENT_BROKER_ROUTES.map((r: SelfServeRoute) => r.companySlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
