/**
 * Load the generated wasm-bindgen glue.
 *
 * It is a build artifact in `/public` — outside Vite's module graph and outside
 * TypeScript's view of the project. A direct `import()` from a bundled module
 * does NOT work in dev: Vite rewrites the request to `/wasm/cockpit.js?import`
 * and then refuses it, because a file in `/public` is copied verbatim and never
 * transformed. The import therefore has to originate from a script element the
 * bundler never sees, which is what this does.
 */
export function loadRendererGlue(): Promise<void> {
  const scope = globalThis as Record<string, unknown>;
  if (scope['fleetscopeCockpit'] !== undefined) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const done = (event: Event): void => {
      const detail = (event as CustomEvent).detail as { ok: boolean; message?: string };
      if (detail.ok) resolve();
      else reject(new Error(detail.message ?? 'the renderer module failed to load'));
    };
    window.addEventListener('fleetscope:glue', done, { once: true });

    const loader = document.createElement('script');
    loader.type = 'module';
    loader.textContent = [
      "import('/wasm/cockpit.js')",
      '  .then(async (module) => {',
      '    await module.default();',
      '    globalThis.fleetscopeCockpit = module;',
      "    window.dispatchEvent(new CustomEvent('fleetscope:glue', { detail: { ok: true } }));",
      '  })',
      '  .catch((error) => {',
      "    window.dispatchEvent(new CustomEvent('fleetscope:glue', {",
      '      detail: { ok: false, message: String((error && error.message) || error) },',
      '    }));',
      '  });',
    ].join('\n');
    document.head.append(loader);
  });
}
