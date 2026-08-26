/**
 * Browser-side configuration.
 *
 * Only `PUBLIC_*` values exist here — anything else would be bundled into a
 * publicly served asset. Like the server, live mode fails closed.
 */
export interface WebConfig {
  readonly defaultCaseId: string;
  readonly liveMode: boolean;
  readonly apiBaseUrl: string | null;
}

export function webConfig(): WebConfig {
  const env = import.meta.env;
  return {
    defaultCaseId: env.PUBLIC_DEFAULT_CASE_ID ?? 'CASE-1042',
    liveMode: env.PUBLIC_LIVE_MODE === 'true',
    apiBaseUrl:
      env.PUBLIC_API_BASE_URL && env.PUBLIC_API_BASE_URL !== '' ? env.PUBLIC_API_BASE_URL : null,
  };
}
