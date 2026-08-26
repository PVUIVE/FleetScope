import { parseConfig, type FleetScopeConfig } from '@fleetscope/shared';

/**
 * The one place in apps/api that touches the environment.
 * Parsed once at boot so a misconfiguration is a startup failure, not a
 * surprise during a demo.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): FleetScopeConfig {
  const result = parseConfig(source);
  if (!result.ok) {
    throw new Error(`Invalid configuration:\n${result.error.map((p) => `  - ${p}`).join('\n')}`);
  }
  return result.value;
}

export type { FleetScopeConfig };
