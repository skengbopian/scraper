import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertNoCredential,
  chooseCheapestRung,
  FORBIDDEN_CREDENTIAL_KEYS,
  isGuidedOnly,
  type SelfServeRoute,
} from '../src/leverage/self-serve.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function route(over: Partial<SelfServeRoute> & Pick<SelfServeRoute, 'companySlug' | 'routeType' | 'url'>): SelfServeRoute {
  return { steps: [], requiresLogin: false, ...over };
}

describe('cheapest-rung-first routing (docs/08 guardrail 5)', () => {
  const erasureRoute = route({ companySlug: 'zoominfo', routeType: 'DSR_ERASURE', url: 'https://x/remove' });

  it('prefers a self-serve route over a legal request when one achieves the outcome', () => {
    const c = chooseCheapestRung({
      controllerSlug: 'zoominfo',
      outcome: 'ERASURE',
      routes: [erasureRoute],
      legalPlaybookAvailable: true, // legal fallback exists, but self-serve is cheaper — must win
    });
    expect(c.rung).toBe('SELF_SERVE');
    if (c.rung === 'SELF_SERVE') expect(c.route).toBe(erasureRoute);
  });

  it('falls back to the legal request when no self-serve route matches the outcome', () => {
    const c = chooseCheapestRung({
      controllerSlug: 'zoominfo',
      outcome: 'ERASURE',
      routes: [],
      legalPlaybookAvailable: true,
    });
    expect(c.rung).toBe('LEGAL');
  });

  it('returns NONE when there is neither a self-serve route nor a legal playbook', () => {
    const c = chooseCheapestRung({ controllerSlug: 'zoominfo', outcome: 'ERASURE', routes: [], legalPlaybookAvailable: false });
    expect(c.rung).toBe('NONE');
  });

  it('does not match a route belonging to a different company', () => {
    const c = chooseCheapestRung({
      controllerSlug: 'apollo',
      outcome: 'ERASURE',
      routes: [erasureRoute], // zoominfo's route
      legalPlaybookAvailable: true,
    });
    expect(c.rung).toBe('LEGAL');
  });

  it('maps ERASURE to both DSR_ERASURE and ACCOUNT_DELETION routes', () => {
    const del = route({ companySlug: 'x', routeType: 'ACCOUNT_DELETION', url: 'https://x/delete' });
    const c = chooseCheapestRung({ controllerSlug: 'x', outcome: 'ERASURE', routes: [del], legalPlaybookAvailable: false });
    expect(c.rung).toBe('SELF_SERVE');
  });

  it('does not treat a marketing-preferences route as satisfying an erasure', () => {
    const prefs = route({ companySlug: 'x', routeType: 'MARKETING_PREFS', url: 'https://x/prefs' });
    const c = chooseCheapestRung({ controllerSlug: 'x', outcome: 'ERASURE', routes: [prefs], legalPlaybookAvailable: true });
    expect(c.rung).toBe('LEGAL');
  });

  it('prefers a no-login route over a login-gated one (less friction, never credential-adjacent)', () => {
    const login = route({ companySlug: 'x', routeType: 'DSR_ERASURE', url: 'https://x/a', requiresLogin: true, successRate: 0.99 });
    const noLogin = route({ companySlug: 'x', routeType: 'DSR_ERASURE', url: 'https://x/b', requiresLogin: false, successRate: 0.5 });
    const c = chooseCheapestRung({ controllerSlug: 'x', outcome: 'ERASURE', routes: [login, noLogin], legalPlaybookAvailable: false });
    expect(c.rung).toBe('SELF_SERVE');
    if (c.rung === 'SELF_SERVE') {
      expect(c.route).toBe(noLogin);
      expect(c.guided).toBe(false);
    }
  });

  it('among equal-friction routes prefers higher success rate, then fewer minutes', () => {
    const lo = route({ companySlug: 'x', routeType: 'DSR_ERASURE', url: 'https://x/lo', successRate: 0.4, estMinutes: 5 });
    const hi = route({ companySlug: 'x', routeType: 'DSR_ERASURE', url: 'https://x/hi', successRate: 0.9, estMinutes: 20 });
    const c = chooseCheapestRung({ controllerSlug: 'x', outcome: 'ERASURE', routes: [lo, hi], legalPlaybookAvailable: false });
    expect(c.rung).toBe('SELF_SERVE'); // unconditional: a regression to LEGAL/NONE must fail, not skip
    if (c.rung === 'SELF_SERVE') expect(c.route).toBe(hi);
  });

  it('marks a login-gated chosen route as guided', () => {
    const login = route({ companySlug: 'x', routeType: 'DSR_ERASURE', url: 'https://x/a', requiresLogin: true });
    const c = chooseCheapestRung({ controllerSlug: 'x', outcome: 'ERASURE', routes: [login], legalPlaybookAvailable: false });
    expect(c.rung).toBe('SELF_SERVE'); // unconditional, so the guarded assertion below cannot be skipped
    if (c.rung === 'SELF_SERVE') expect(c.guided).toBe(true);
  });

  it('isGuidedOnly reflects requiresLogin', () => {
    expect(isGuidedOnly(route({ companySlug: 'x', routeType: 'DSR_ERASURE', url: 'https://x', requiresLogin: true }))).toBe(true);
    expect(isGuidedOnly(route({ companySlug: 'x', routeType: 'DSR_ERASURE', url: 'https://x', requiresLogin: false }))).toBe(false);
  });
});

describe('GUARDRAIL — a self-serve route holds no third-party credential (docs/08 guardrail 1)', () => {
  it('assertNoCredential passes a clean route', () => {
    expect(() => assertNoCredential(route({ companySlug: 'x', routeType: 'DSR_ERASURE', url: 'https://x' }) as unknown as Record<string, unknown>)).not.toThrow();
  });

  // Case variants and camelCase entries the earlier case-sensitive check let slip through.
  for (const key of ['password', 'Password', 'PASSWORD', 'token', 'AuthToken', 'apikey', 'apiKey', 'sessionId', 'cookie', 'jwt', 'clientSecret']) {
    it(`assertNoCredential rejects a route carrying "${key}" (case-insensitive)`, () => {
      const bad = { companySlug: 'x', routeType: 'DSR_ERASURE', url: 'https://x', [key]: 'hunter2' };
      expect(() => assertNoCredential(bad)).toThrow(/credential/i);
    });
  }

  it('assertNoCredential recurses into nested objects and arrays', () => {
    expect(() => assertNoCredential({ companySlug: 'x', meta: { password: 'p' } })).toThrow(/credential/i);
    expect(() => assertNoCredential({ companySlug: 'x', extras: [{ cookie: 'c' }] })).toThrow(/credential/i);
  });

  it('assertNoCredential does not false-positive on requiresLogin (contains "login")', () => {
    expect(() => assertNoCredential(route({ companySlug: 'x', routeType: 'DSR_ERASURE', url: 'https://x', requiresLogin: true }) as unknown as Record<string, unknown>)).not.toThrow();
  });

  it('the SelfServeRoute interface declares no credential field and every field is readonly (source scan)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'packages/core/src/leverage/self-serve.ts'), 'utf8');
    // Isolate the interface body so the FORBIDDEN_CREDENTIAL_KEYS denylist literals below don't self-trip.
    const m = src.match(/export interface SelfServeRoute \{([\s\S]*?)\n\}/);
    expect(m, 'SelfServeRoute interface not found — did it move? Update this guardrail deliberately.').toBeTruthy();
    const body = (m as RegExpMatchArray)[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const deny = FORBIDDEN_CREDENTIAL_KEYS.map((k) => k.toLowerCase());
    // Catch ALL property declarations, not only `readonly` ones — a `password: string` without the
    // keyword would otherwise be invisible to the scan.
    const decls = [...body.matchAll(/^\s*(readonly\s+)?([A-Za-z0-9_]+)\s*[?!]?\s*:/gm)];
    expect(decls.length, 'no fields parsed from the interface body').toBeGreaterThan(0);
    for (const d of decls) {
      expect(deny, `field "${d[2]}" is credential-shaped`).not.toContain(d[2].toLowerCase());
      expect(Boolean(d[1]), `field "${d[2]}" must be declared readonly (immutability)`).toBe(true);
    }
  });
});
