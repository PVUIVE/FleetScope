/**
 * @fleetscope/platform-adapters — boundaries, not integrations.
 *
 * This package defines the seven Gemini Enterprise Agent Platform adapter
 * interfaces and their mode contract. It contains NO live implementation and no
 * fabricated platform response: where an API is unavailable, the boundary stays
 * an interface plus recorded fixture evidence.
 */
export * from './mode.js';
export * from './capability-truth.js';
export * from './registry/index.js';
export * from './runtime/index.js';
export * from './memory/index.js';
export * from './identity/index.js';
export * from './gateway/index.js';
export * from './armor/index.js';
export * from './observability/index.js';
