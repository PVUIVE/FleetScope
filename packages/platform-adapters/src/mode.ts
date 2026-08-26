/**
 * Adapter mode is ALWAYS explicit.
 *
 *   recorded  — replays bundled canonical evidence. Zero network, zero cost.
 *   synthetic — deterministic local behavior with real FleetScope-side policy,
 *               standing in for a system we do not have (e.g. the ERP).
 *   live      — calls the actual platform service. Requires LIVE_MODE=true.
 *
 * A `synthetic` or `recorded` response MUST NEVER be labelled or surfaced as a
 * real platform response. That is the one rule in this package that has no
 * exceptions: it is the difference between a demo and a lie.
 */
export const ADAPTER_MODES = ['recorded', 'synthetic', 'live'] as const;
export type AdapterMode = (typeof ADAPTER_MODES)[number];

export interface AdapterDescriptor {
  readonly service: string;
  readonly mode: AdapterMode;
  /** Human-readable label the UI must show alongside any evidence it produces. */
  readonly displayLabel: string;
  /**
   * Real platform API this adapter talks to, or null when none exists yet.
   * `null` in live mode is a configuration error, not a fallback.
   */
  readonly upstream: string | null;
}

/** Every adapter response carries the descriptor that produced it. */
export interface AdapterResponse<T> {
  readonly adapter: AdapterDescriptor;
  readonly value: T;
  readonly observedAt: string;
}

export class UnsupportedAdapterModeError extends Error {
  constructor(service: string, mode: AdapterMode) {
    super(`${service} has no ${mode} implementation. Available modes must be declared explicitly.`);
    this.name = 'UnsupportedAdapterModeError';
  }
}
