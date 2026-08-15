import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Same reason as apps/api: this suite resets and re-imports one shared Postgres, so a parallel
    // run races on the fixed slugs and the loser's beforeEach throws — which vitest reports as
    // "skipped" rather than "failed", i.e. silently.
    fileParallelism: false,
    server: {
      deps: {
        /**
         * Run the COMPILED CLI as plain Node, not through Vite's transform.
         *
         * `src/validate.ts` loads the playbook validator from `tools/spec-audit` by file:// URL —
         * deliberately, so the importer validates through the same entry point CI does. Vite
         * statically rewrites dynamic imports and then fails to resolve that URL (this repo's path
         * contains a space, so the href is percent-encoded and Vite's resolver does not decode it).
         * The result was a suite that could only pass against a mocked loader — i.e. one that tested
         * something other than the thing that ships.
         */
        external: [/[\\/]dist[\\/]/],
      },
    },
  },
});
