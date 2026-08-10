import { describe, expect, it } from 'vitest';
import { assertNoCredential, isGuidedOnly } from '../src/leverage/self-serve.js';
import { SOURCE_HARDENING_ROUTES } from '../src/leverage/source-hardening.seed.js';

describe('source-hardening seed (docs/10 §7.7 target #5, safe part)', () => {
  it('covers the professional networks brokers re-scrape (linkedin, xing)', () => {
    const slugs = new Set(SOURCE_HARDENING_ROUTES.map((r) => r.companySlug));
    expect(slugs).toContain('linkedin');
    expect(slugs).toContain('xing');
  });

  it('every route is https, has guided steps, and is login-gated (guided handoff only)', () => {
    for (const r of SOURCE_HARDENING_ROUTES) {
      expect(r.url, `${r.companySlug} url`).toMatch(/^https:\/\//);
      expect(r.steps.length, `${r.companySlug} steps`).toBeGreaterThan(0);
      // These require signing into the user's own account → guided, never automated.
      expect(r.requiresLogin, `${r.companySlug} must be login-gated/guided`).toBe(true);
      expect(isGuidedOnly(r)).toBe(true);
    }
  });

  it('carries no credential (docs/08 guardrail 1)', () => {
    for (const r of SOURCE_HARDENING_ROUTES) {
      expect(() => assertNoCredential(r as unknown as Record<string, unknown>)).not.toThrow();
    }
  });
});
