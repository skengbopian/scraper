import { describe, expect, it } from 'vitest';

/**
 * The corpus CLI's half of the CI database guard — see `apps/api/test/db-suites-execute.test.ts`.
 *
 * What this protects is the only test coverage of `corpus:activate`, which is the act that authorises
 * this product to send a legal letter in a person's name. Its refusals — a DRAFT template outside dev,
 * a slug not retyped, a second playbook for the same (controller, requestType) — are all database-
 * backed and all skip without Postgres, so an unnoticed loss of `DATABASE_URL_TEST` would leave the
 * activation ceremony with no tests at all while the run reported green.
 */
describe('CI actually runs the corpus-CLI suite', () => {
  it('DATABASE_URL_TEST is set whenever CI is', () => {
    if (!process.env.CI) return; // a local run without Postgres is legitimate — that is what skipIf is for
    expect(
      process.env.DATABASE_URL_TEST,
      'CI=1 but DATABASE_URL_TEST is unset: the corpus import/activate/deactivate suite would skip and ' +
        'the run would report green. Restore the job-level DATABASE_URL_TEST in .github/workflows/alpha-ci.yml.',
    ).toBeTruthy();
  });
});
