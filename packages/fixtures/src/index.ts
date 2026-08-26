/**
 * @fleetscope/fixtures — recorded Case evidence.
 *
 * Recorded fixtures are first-class PRODUCT assets: they are what the public,
 * zero-backend demo actually renders. They are not test leftovers.
 *
 * This entry point is runtime-agnostic (types + the manifest shape). Use
 * `@fleetscope/fixtures/node` for filesystem loading in Node; the browser build
 * imports the JSON/JSONL assets directly through Vite so nothing here needs `fs`.
 */
export * from './types.js';
export * from './registry.js';
