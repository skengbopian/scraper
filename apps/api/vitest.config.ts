import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * The DB suites (`db-invariants`, `prisma-integration`) TRUNCATE and re-seed ONE shared
     * Postgres database, so they must not run concurrently: a parallel run races on the fixed
     * fixture ids and the loser's `beforeAll` throws. Vitest reports a failed `beforeAll` as
     * "skipped" rather than "failed", so this raced silently — 6 tests reported as skipped while
     * the suite was actually broken. Serialised here; the whole file set runs in ~4s.
     */
    fileParallelism: false,
  },
});
