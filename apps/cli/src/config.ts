import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { configPath, defaultStorePath, fleetscopeDir } from './paths.js';

/**
 * Local configuration.
 *
 * Four knobs, and no credentials. FleetScope never needs a model key: the
 * developer's own agent process holds that, calls Gemini itself, and reports
 * what happened. Storing one here would create a secret this tool has no reason
 * to hold — see docs/local-agent-viewer.md.
 */
export interface LocalConfig {
  readonly port: number;
  readonly storage: string;
  readonly adapter: 'google-adk';
  /** Extra payload field names to redact, on top of the default policy. */
  readonly redactFields: readonly string[];
}

export const DEFAULT_PORT = 4317;

export function defaultConfig(): LocalConfig {
  return {
    port: DEFAULT_PORT,
    storage: defaultStorePath(),
    adapter: 'google-adk',
    redactFields: [],
  };
}

/**
 * Read the config, falling back to defaults.
 *
 * A malformed file is reported and then ignored rather than fatal: a developer
 * mid-demo needs the viewer to start, and the defaults are always usable.
 */
export function readConfig(): { config: LocalConfig; problem: string | null } {
  const fallback = defaultConfig();
  let raw: string;
  try {
    raw = readFileSync(configPath(), 'utf8');
  } catch {
    return { config: fallback, problem: null };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LocalConfig>;
    return {
      config: {
        port: typeof parsed.port === 'number' ? parsed.port : fallback.port,
        storage: typeof parsed.storage === 'string' ? parsed.storage : fallback.storage,
        adapter: 'google-adk',
        redactFields: Array.isArray(parsed.redactFields)
          ? parsed.redactFields.filter((field): field is string => typeof field === 'string')
          : [],
      },
      problem: null,
    };
  } catch (error) {
    return { config: fallback, problem: (error as Error).message };
  }
}

export function writeConfig(config: LocalConfig): string {
  mkdirSync(fleetscopeDir(), { recursive: true });
  const path = configPath();
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return path;
}
