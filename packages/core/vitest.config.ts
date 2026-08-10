import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/**'], thresholds: { lines: 80, functions: 80, branches: 75 } },
  },
});
