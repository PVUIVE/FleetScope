import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.astro/**',
      '**/target/**',
      'vendor/**',
      // The libm / critical-section shim, copied verbatim from the vendored
      // upstream. Browser JS with no build step; linting it against this
      // project's Node-flavoured environment reports only false positives.
      'crates/**/*.js',
      // Generated wasm-bindgen glue, staged by scripts/build-wasm.sh. It is a
      // build artifact, not source, and it targets the browser rather than this
      // project's lint environment.
      'apps/web/public/wasm/**',
      'packages/fixtures/cases/**',
      'packages/event-schema/schemas/**',
      // A Node entry-point shim, not project source: it runs before the tsx
      // loader is registered and is deliberately plain ESM.
      'apps/cli/bin/*.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-globals': [
        'error',
        {
          name: 'process',
          message: 'Read configuration through @fleetscope/shared config, not process.env.',
        },
      ],
    },
  },
  {
    // Config loaders, CLIs and scripts are the only places allowed to touch the environment.
    files: [
      'packages/shared/src/env.ts',
      'apps/api/src/config/**/*.ts',
      // The CLI and the server entry point ARE the process boundary: they read
      // argv, the environment and the terminal, and hand a parsed value on.
      'apps/cli/src/**/*.ts',
      'apps/api/src/server.ts',
      'packages/*/src/cli.ts',
      'packages/*/src/emit-json-schema.ts',
      'scripts/**/*.ts',
      'eslint.config.js',
      'vitest.config.ts',
    ],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    files: ['**/tests/**/*.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
);
