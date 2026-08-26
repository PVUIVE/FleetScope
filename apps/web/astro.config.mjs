import { defineConfig } from 'astro/config';

/**
 * Static output by default.
 *
 * The public/demo path must render from bundled recorded evidence with ZERO
 * backend availability, so there is no adapter and no SSR here. The optional
 * bounded API is reached from the browser only, and only when live mode is on.
 */
export default defineConfig({
  output: 'static',
  // No separate landing page in the MVP: procurement users open on Cases.
  redirects: { '/': '/cases' },
  build: { format: 'directory' },
  vite: {
    // Workspace packages are consumed as TypeScript source (no per-package build
    // step) — six days, no build orchestration. Vite must transform them.
    ssr: { noExternal: [/^@fleetscope\//] },
    optimizeDeps: { exclude: ['@fleetscope/fixtures'] },
  },
});
