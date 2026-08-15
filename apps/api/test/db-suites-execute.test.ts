import { describe, expect, it } from 'vitest';

/**
 * The guard on the guard: under CI, the database suites must RUN.
 *
 * Four suites in this package gate themselves on `DATABASE_URL_TEST` with `describe.skipIf` — auth
 * policy (19), the ops queue (28), the database invariants (14), the Prisma adapter (5). That is the
 * right default for a laptop with no Postgres, and it was a silent hole in CI for months: vitest
 * reports a skipped describe as a pass, so the workflow was green while 66 tests in this package had
 * never executed. Two of them, run for the first time on a fresh database, failed 23 of 28.
 *
 * A skip condition is only honest if something asserts when it must not fire. This is that
 * something. It cannot check that the suites passed — only that the environment which makes them run
 * was provided — but that is the exact failure being guarded: an env var quietly dropped from the
 * workflow, restoring a green tick over 66 unrun tests.
 *
 * The variable is set at job level in `.github/workflows/alpha-ci.yml`, so this one assertion covers
 * every step of the recursive run. `apps/worker` carries its own copy for its own two suites.
 */
describe('CI actually runs the database suites', () => {
  it('DATABASE_URL_TEST is set whenever CI is', () => {
    if (!process.env.CI) return; // a local run without Postgres is legitimate — that is what skipIf is for
    expect(
      process.env.DATABASE_URL_TEST,
      'CI=1 but DATABASE_URL_TEST is unset: the auth-policy, ops, db-invariant and Prisma suites ' +
        'would all skip, and vitest would report the run as green. Restore the postgres service and ' +
        'the job-level DATABASE_URL_TEST in .github/workflows/alpha-ci.yml.',
    ).toBeTruthy();
  });
});
