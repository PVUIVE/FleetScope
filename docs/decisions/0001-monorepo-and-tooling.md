# 0001 — pnpm workspaces, source-consumed packages

Status: accepted · 2026-08-26

## Context

Six days. The repository was empty apart from documentation and an orphaned
Next.js `node_modules` with no manifest.

## Decision

- **pnpm workspaces**, no Nx and no Turborepo.
- Internal packages export **TypeScript source** (`"exports": "./src/index.ts"`),
  with no per-package build step.
- One root `vitest.config.ts` with `unit` and `replay` projects; no per-package
  test config.
- ESLint (correctness) + Prettier (formatting), with no overlap between them.

## Reason

Build orchestration is not a product feature. Source-consumed packages remove an
entire class of stale-`dist` bugs and cut the edit→test loop to zero build steps.
Vite (Astro) and `tsx` (api, scripts) both transform workspace TypeScript
directly, so nothing needs compiling before it runs.

## Tradeoff

These packages are not independently publishable, and any external consumer would
have to transpile them. Acceptable: nothing here is published. If that changes,
add `tsup` to the two packages that need it — not to all of them.
