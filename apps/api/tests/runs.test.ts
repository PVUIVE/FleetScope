import { describe, expect, it } from 'vitest';
import { MemoryRunStore, RunLedger } from '@fleetscope/run-ledger';
import { parseConfig, type FleetScopeConfig } from '@fleetscope/shared';
import { createApp } from '../src/app.js';
import type { RunDependencies } from '../src/runs/runtime.js';

const config = (): FleetScopeConfig => {
  const parsed = parseConfig({});
  if (!parsed.ok) throw new Error(parsed.error.join('; '));
  return parsed.value;
};
const runs = (store = new MemoryRunStore()): RunDependencies => ({
  ledger: new RunLedger(store, {
    now: () => new Date('2026-08-29T00:00:00.000Z'),
    newId: () => 'run-api',
  }),
});
const request = (app: ReturnType<typeof createApp>, path: string, key = 'api-request-key-0001') =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ scenario: 'dependency_onboarding' }),
  });

describe('Phase B2 /runs controller', () => {
  it('reports the worker and durable capability truthfully', async () => {
    const response = await createApp(config(), 'silent', undefined, undefined, runs()).request(
      '/runs/capability',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      scenario: 'dependency_onboarding',
      worker: 'unavailable',
      durability: 'ready',
    });
  });
  it('admits only one fixed-scenario run, is idempotent, and exposes status', async () => {
    const app = createApp(config(), 'silent', undefined, undefined, runs());
    const first = await request(app, '/runs');
    expect(first.status).toBe(201);
    const body = (await first.json()) as {
      run: { id: string; executing: boolean; state: string };
      worker: string;
    };
    expect(body).toMatchObject({
      worker: 'unavailable',
      run: { executing: false, state: 'queued' },
    });
    expect((await request(app, '/runs')).status).toBe(200);
    expect((await request(app, '/runs', 'api-request-key-0002')).status).toBe(409);
    expect((await app.request(`/runs/${body.run.id}`)).status).toBe(200);
    expect(await (await app.request('/runs/active')).json()).toMatchObject({
      run: { id: body.run.id },
    });
  });
  it('rejects arbitrary body, scenario, or missing header', async () => {
    const app = createApp(config(), 'silent', undefined, undefined, runs());
    expect(
      (
        await app.request('/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scenario: 'dependency_onboarding' }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request('/runs', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Idempotency-Key': 'api-request-key-0001',
          },
          body: JSON.stringify({ scenario: 'anything_else', prompt: 'nope' }),
        })
      ).status,
    ).toBe(400);
  });
  it('rejects non-loopback mutation and reports durability loss', async () => {
    const app = createApp(config(), 'silent', undefined, undefined, runs());
    expect(
      (
        await app.request('http://192.0.2.1/runs', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Idempotency-Key': 'api-request-key-0001',
          },
          body: JSON.stringify({ scenario: 'dependency_onboarding' }),
        })
      ).status,
    ).toBe(403);
    const unavailable = createApp(
      config(),
      'silent',
      undefined,
      undefined,
      runs(new MemoryRunStore([], true)),
    );
    expect((await request(unavailable, '/runs')).status).toBe(503);
  });
});
