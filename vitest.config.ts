import { defineConfig } from 'vitest/config';

/**
 * Two projects so `pnpm test:replay` can run determinism/replay proofs alone in CI
 * without paying for the rest of the suite.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/tests/**/*.test.ts', 'apps/api/tests/**/*.test.ts'],
          exclude: ['packages/projector/tests/**', 'packages/fixtures/tests/**'],
        },
      },
      {
        test: {
          name: 'replay',
          include: [
            'packages/projector/tests/**/*.test.ts',
            'packages/fixtures/tests/**/*.test.ts',
          ],
        },
      },
    ],
  },
});
