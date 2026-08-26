import { beforeEach, describe, expect, it } from 'vitest';
import { parseConfig, type FleetScopeConfig } from '@fleetscope/shared';
import { createApp } from '../src/app.js';
import { admitLiveRequest, liveCallsUsed, resetLiveCallCounters } from '../src/live/guard.js';

const config = (source: Record<string, string> = {}): FleetScopeConfig => {
  const result = parseConfig(source);
  if (!result.ok) throw new Error(result.error.join('; '));
  return result.value;
};

const recorded = config();
const live = config({
  LIVE_MODE: 'true',
  GEMINI_MODEL: 'gemini-2.5-flash',
  GEMINI_API_KEY: 'not-a-real-key',
});

beforeEach(resetLiveCallCounters);

describe('GET /health', () => {
  it('answers without any credential or live configuration', async () => {
    const res = await createApp(recorded, 'silent').request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', liveMode: false });
  });
});

describe('GET /capability', () => {
  it('hides the model name when live mode is off, so nothing reads as a claim', async () => {
    const res = await createApp(recorded, 'silent').request('/capability');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.liveMode).toBe(false);
    expect(body.model).toBeNull();
    expect(body.allowlistedSteps).toBeInstanceOf(Array);
    expect((body.allowlistedSteps as unknown[]).length).toBeGreaterThan(0);
  });

  it('discloses the model only when live mode is on', async () => {
    const res = await createApp(live, 'silent').request('/capability');
    expect(((await res.json()) as Record<string, unknown>).model).toBe('gemini-2.5-flash');
  });

  it('publishes the budget guardrails', async () => {
    const body = (await (
      await createApp(recorded, 'silent').request('/capability')
    ).json()) as Record<string, unknown>;
    expect(body.limits).toEqual({
      maxCallsPerCase: 2,
      maxInputTokens: 2000,
      maxOutputTokens: 300,
    });
  });
});

describe('POST /live/decision — LIVE_MODE=false guard', () => {
  it('refuses every request and names the recorded fallback', async () => {
    const res = await createApp(recorded, 'silent').request('/live/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: 'CASE-1042', stepId: 'warden-incident-advice' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('live_mode_disabled');
    expect(body.fallback).toBe('recorded');
  });

  it('does not consume the call budget when refused', async () => {
    await createApp(recorded, 'silent').request('/live/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: 'CASE-1042', stepId: 'warden-incident-advice' }),
    });
    expect(liveCallsUsed('CASE-1042')).toBe(0);
  });

  it('validates the request shape', async () => {
    const res = await createApp(recorded, 'silent').request('/live/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /live/decision — LIVE_MODE=true', () => {
  it('rejects a step that is not allowlisted', async () => {
    const res = await createApp(live, 'silent').request('/live/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: 'CASE-1042', stepId: 'anything-i-want' }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as Record<string, unknown>).error).toBe('step_not_allowlisted');
  });

  it('falls back to recorded rather than fabricating a platform response', async () => {
    // With no credential the bounded call cannot happen. The endpoint records
    // the attempt as evidence and tells the client to serve recorded — it never
    // invents a result and labels it live.
    const res = await createApp(live, 'silent', { apiKey: null }).request('/live/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: 'CASE-1042', stepId: 'warden-incident-advice' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['mode']).toBe('recorded');
    expect(body['fellBackToRecorded']).toBe(true);
    expect(body['modelReference']).toBeUndefined();
  });

  it('exposes no free-form prompt surface', async () => {
    const app = createApp(live, 'silent');
    for (const path of ['/prompt', '/generate', '/chat', '/v1/completions']) {
      expect((await app.request(path, { method: 'POST' })).status).toBe(404);
    }
  });
});

describe('admitLiveRequest', () => {
  it('enforces the per-Case call budget', () => {
    expect(admitLiveRequest(live, 'CASE-1042', 'warden-incident-advice').admitted).toBe(true);
    expect(admitLiveRequest(live, 'CASE-1042', 'warden-incident-advice').admitted).toBe(true);
    const third = admitLiveRequest(live, 'CASE-1042', 'warden-incident-advice');
    expect(third.admitted).toBe(false);
    if (third.admitted) return;
    expect(third.rejection.reason).toBe('call_budget_exhausted');
  });

  it('counts budget per Case, not globally', () => {
    admitLiveRequest(live, 'CASE-1042', 'warden-incident-advice');
    expect(liveCallsUsed('CASE-1042')).toBe(1);
    expect(liveCallsUsed('CASE-9999')).toBe(0);
  });

  it('checks live mode before resolving the step', () => {
    const result = admitLiveRequest(recorded, 'CASE-1042', 'not-a-real-step');
    expect(result.admitted).toBe(false);
    if (result.admitted) return;
    expect(result.rejection.reason).toBe('live_mode_disabled');
  });
});
