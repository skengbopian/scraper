import { describe, expect, it } from 'vitest';

/**
 * The worker's half of the CI database guard — see `apps/api/test/db-suites-execute.test.ts` for the
 * reasoning.
 *
 * The suite this protects is `deadline-runner.test.ts`: two tests, and the only place anything
 * proves that pg-boss actually DELIVERS a durable timer into a real transition. Everything else
 * about the deadline logic is unit-tested against fakes, so a wiring fault between the scheduler and
 * the handler — a job payload the runner reads differently from the way dispatch writes it — is
 * invisible to every other test in this repo. Those two are also the ones that prove a missing
 * delivery receipt reaches a human and never an escalation (invariant 4b).
 */
describe('CI actually runs the durable-timer suite', () => {
  it('DATABASE_URL_TEST is set whenever CI is', () => {
    if (!process.env.CI) return; // a local run without Postgres is legitimate — that is what skipIf is for
    expect(
      process.env.DATABASE_URL_TEST,
      'CI=1 but DATABASE_URL_TEST is unset: the pg-boss deadline-runner suite would skip and the ' +
        'run would report green. Restore the job-level DATABASE_URL_TEST in .github/workflows/alpha-ci.yml.',
    ).toBeTruthy();
  });
});
