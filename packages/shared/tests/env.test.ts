import { describe, expect, it } from 'vitest';
import { assertLiveModeEnabled, LiveModeDisabledError, parseConfig } from '../src/index.js';

const unwrap = (source: Record<string, string | undefined>) => {
  const result = parseConfig(source);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error.join('; ')}`);
  return result.value;
};

describe('parseConfig', () => {
  it('defaults to recorded-only on an empty environment', () => {
    const config = unwrap({});
    expect(config.liveMode).toBe(false);
    expect(config.appEnv).toBe('development');
    expect(config.defaultCaseId).toBe('CASE-1042');
    expect(config.port).toBe(8080);
  });

  it('fails closed for any LIVE_MODE value that is not exactly "true"', () => {
    for (const raw of ['false', 'TRUE', '1', 'yes', '', ' true', undefined]) {
      expect(unwrap({ LIVE_MODE: raw }).liveMode).toBe(false);
    }
  });

  it('enables live mode only with its full prerequisites', () => {
    const config = unwrap({
      LIVE_MODE: 'true',
      GEMINI_MODEL: 'gemini-2.5-flash',
      GEMINI_API_KEY: 'not-a-real-key',
    });
    expect(config.liveMode).toBe(true);
  });

  it('rejects live mode without a model or a credential', () => {
    const result = parseConfig({ LIVE_MODE: 'true' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('LIVE_MODE=true requires GEMINI_MODEL');
    expect(result.error).toContain('LIVE_MODE=true requires GEMINI_API_KEY');
  });

  it('names the missing variable and never a value', () => {
    // A configuration error must not be the thing that prints a credential.
    const result = parseConfig({ LIVE_MODE: 'true', GEMINI_API_KEY: 'super-secret-value' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.join(' ')).not.toContain('super-secret-value');
  });

  it('reports invalid numeric and enum values', () => {
    const result = parseConfig({ APP_ENV: 'staging', GEMINI_MAX_OUTPUT_TOKENS: 'lots' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveLength(2);
  });

  it('applies the documented budget guardrail defaults', () => {
    const config = unwrap({});
    expect(config.gemini.maxInputTokens).toBe(2000);
    expect(config.gemini.maxOutputTokens).toBe(300);
    expect(config.gemini.maxCallsPerCase).toBe(2);
    expect(config.gemini.temperature).toBe(0);
  });
});

describe('assertLiveModeEnabled', () => {
  it('throws when live mode is disabled', () => {
    const config = unwrap({});
    expect(() => assertLiveModeEnabled(config, 'gemini.generate')).toThrow(LiveModeDisabledError);
  });

  it('passes when live mode is fully configured', () => {
    const config = unwrap({
      LIVE_MODE: 'true',
      GEMINI_MODEL: 'gemini-2.5-flash',
      GEMINI_API_KEY: 'not-a-real-key',
    });
    expect(() => assertLiveModeEnabled(config, 'gemini.generate')).not.toThrow();
  });
});
