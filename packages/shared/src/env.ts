import { err, ok, type Result } from './result.js';

/**
 * Central environment parsing.
 *
 * Nothing outside this file and `apps/api/src/config` may read `process.env`
 * (enforced by the `no-restricted-globals` ESLint rule). Config is parsed once,
 * validated, and passed as a value.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface FleetScopeConfig {
  readonly appEnv: 'development' | 'test' | 'production';
  /**
   * The safe default is FALSE. When false, no Gemini or platform call may occur
   * anywhere in the system (Invariant 8 / budget-demo credit guardrails).
   */
  readonly liveMode: boolean;
  readonly defaultCaseId: string;
  readonly port: number;
  readonly logLevel: 'silent' | 'info';
  readonly gcp: { readonly projectId: string | null; readonly region: string | null };
  readonly gemini: {
    readonly model: string | null;
    /**
     * The model API credential. Never logged, never echoed, and never included
     * in the `/capability` description — a deployment says whether live mode is
     * ON, never what it is holding.
     */
    readonly apiKey: string | null;
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly maxCallsPerCase: number;
    readonly temperature: number;
    readonly timeoutMs: number;
  };
}

const APP_ENVS = ['development', 'test', 'production'] as const;

/**
 * `LIVE_MODE` fails closed: only the exact string "true" enables it. A typo,
 * an empty value, or an unset variable all mean recorded-only.
 */
function parseLiveMode(raw: string | undefined): boolean {
  return raw === 'true';
}

function parseInt_(
  raw: string | undefined,
  fallback: number,
  name: string,
  problems: string[],
): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    problems.push(`${name} must be a non-negative integer, got ${JSON.stringify(raw)}`);
    return fallback;
  }
  return n;
}

function parseFloat_(
  raw: string | undefined,
  fallback: number,
  name: string,
  problems: string[],
): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    problems.push(`${name} must be a number, got ${JSON.stringify(raw)}`);
    return fallback;
  }
  return n;
}

const nullable = (raw: string | undefined): string | null =>
  raw === undefined || raw === '' ? null : raw;

export function parseConfig(source: EnvSource): Result<FleetScopeConfig, string[]> {
  const problems: string[] = [];

  const rawAppEnv = source['APP_ENV'] ?? 'development';
  if (!(APP_ENVS as readonly string[]).includes(rawAppEnv)) {
    problems.push(
      `APP_ENV must be one of ${APP_ENVS.join(' | ')}, got ${JSON.stringify(rawAppEnv)}`,
    );
  }

  const liveMode = parseLiveMode(source['LIVE_MODE']);

  const config: FleetScopeConfig = {
    appEnv: (APP_ENVS as readonly string[]).includes(rawAppEnv)
      ? (rawAppEnv as FleetScopeConfig['appEnv'])
      : 'development',
    liveMode,
    defaultCaseId: source['PUBLIC_DEFAULT_CASE_ID'] ?? 'CASE-1042',
    port: parseInt_(source['PORT'], 8080, 'PORT', problems),
    logLevel: source['API_LOG_LEVEL'] === 'silent' ? 'silent' : 'info',
    gcp: {
      projectId: nullable(source['GCP_PROJECT_ID']),
      region: nullable(source['GCP_REGION']),
    },
    gemini: {
      model: nullable(source['GEMINI_MODEL']),
      apiKey: nullable(source['GEMINI_API_KEY']),
      maxInputTokens: parseInt_(
        source['GEMINI_MAX_INPUT_TOKENS'],
        2000,
        'GEMINI_MAX_INPUT_TOKENS',
        problems,
      ),
      maxOutputTokens: parseInt_(
        source['GEMINI_MAX_OUTPUT_TOKENS'],
        300,
        'GEMINI_MAX_OUTPUT_TOKENS',
        problems,
      ),
      maxCallsPerCase: parseInt_(
        source['GEMINI_MAX_CALLS_PER_CASE'],
        2,
        'GEMINI_MAX_CALLS_PER_CASE',
        problems,
      ),
      temperature: parseFloat_(source['GEMINI_TEMPERATURE'], 0, 'GEMINI_TEMPERATURE', problems),
      timeoutMs: parseInt_(source['GEMINI_TIMEOUT_MS'], 15_000, 'GEMINI_TIMEOUT_MS', problems),
    },
  };

  // Live mode is the only state that can spend credit, so its prerequisites are
  // validated at boot rather than discovered at call time.
  if (config.liveMode) {
    if (config.gemini.model === null) problems.push('LIVE_MODE=true requires GEMINI_MODEL');
    // The message names the VARIABLE, never a value: a config error must not be
    // the thing that prints a credential into a log.
    if (config.gemini.apiKey === null) problems.push('LIVE_MODE=true requires GEMINI_API_KEY');
    if (config.gemini.maxCallsPerCase < 1) {
      problems.push('LIVE_MODE=true requires GEMINI_MAX_CALLS_PER_CASE >= 1');
    }
  }

  return problems.length > 0 ? err(problems) : ok(config);
}

/** Thrown by the live guard. Carries no configuration values. */
export class LiveModeDisabledError extends Error {
  constructor(operation: string) {
    super(`Refused "${operation}": LIVE_MODE is disabled. FleetScope is running recorded-only.`);
    this.name = 'LiveModeDisabledError';
  }
}

/**
 * The single choke point for every outbound model or platform call.
 * Call this immediately before any such call — never behind a cached boolean.
 */
export function assertLiveModeEnabled(config: FleetScopeConfig, operation: string): void {
  if (!config.liveMode) throw new LiveModeDisabledError(operation);
}
