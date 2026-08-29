import { describe, expect, it } from 'vitest';
import { DEMO_SCENARIO, type Run } from '@fleetscope/run-ledger';
import { createProcessWorker, type SpawnedWorker } from '../src/runs/worker-process.js';

const AT = '2026-08-29T00:00:00.000Z';

const run: Run = {
  id: 'run-f',
  scenario: DEMO_SCENARIO,
  idempotencyKey: 'worker-process-0001',
  state: 'queued',
  executing: false,
  reservedModelCalls: 0,
  createdAt: AT,
  updatedAt: AT,
  reason: null,
};

/** The worker's real wire shape, sanitized exactly as its bridge emits it. */
const wireEvents = [
  {
    kind: 'session.start',
    seq: 0,
    at: AT,
    agent: 'dependency_onboarding',
    invocationId: 'run-f:call-1',
  },
  {
    kind: 'agent.start',
    seq: 1,
    at: AT,
    agent: 'dependency_onboarding',
    invocationId: 'run-f:call-1',
  },
  {
    kind: 'agent.start',
    seq: 2,
    at: AT,
    agent: 'security_review',
    parentAgent: 'dependency_onboarding',
    invocationId: 'run-f:call-1',
  },
  {
    kind: 'session.end',
    seq: 3,
    at: AT,
    agent: 'dependency_onboarding',
    invocationId: 'run-f:call-1',
  },
];

const worker = (reply: Partial<SpawnedWorker> & { readonly stdout: string }) =>
  createProcessWorker({
    enabled: true,
    newCorrelationId: () => 'call-1',
    async spawn(): Promise<SpawnedWorker> {
      return { code: reply.code ?? 0, stdout: reply.stdout, stderr: reply.stderr ?? '' };
    },
  });

describe('the process-backed worker port', () => {
  it('is unavailable until it is explicitly enabled', () => {
    expect(createProcessWorker({ enabled: false }).available).toBe(false);
    expect(
      createProcessWorker({
        enabled: true,
        async spawn() {
          return { code: 0, stdout: '{}', stderr: '' };
        },
      }).available,
    ).toBe(true);
  });

  it('canonicalizes the worker run through the product pipeline', async () => {
    const result = await worker({
      stdout: JSON.stringify({
        state: 'completed',
        delegation: 'delegated',
        reason: null,
        events: wireEvents,
      }),
    }).execute(run);

    expect(result).toMatchObject({ state: 'completed', delegation: 'delegated' });
    expect(result.events.map((event) => event.type)).toEqual([
      'runtime.started',
      'agent.spawned',
      'agent.started',
      'agent.spawned',
      'agent.started',
      'runtime.completed',
    ]);
    // Canonical identity is assigned by the product, not by the worker.
    expect(result.events.every((event) => /^evt-[0-9a-f]{16}$/.test(event.eventId))).toBe(true);
    expect(result.events.map((event) => event.caseSequence)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('reports unobserved delegation rather than assuming it', async () => {
    const result = await worker({
      stdout: JSON.stringify({
        state: 'incomplete',
        delegation: 'unknown',
        reason: 'delegation_not_observed',
        events: [],
      }),
    }).execute(run);
    expect(result).toMatchObject({
      state: 'incomplete',
      delegation: 'unknown',
      reason: 'delegation_not_observed',
    });
  });

  it('refuses a reply it cannot trust', async () => {
    expect(await worker({ stdout: 'not json' }).execute(run)).toMatchObject({
      state: 'failed',
      reason: 'worker_reply_invalid',
    });
    expect(
      await worker({ stdout: JSON.stringify({ state: 'made_up' }) }).execute(run),
    ).toMatchObject({
      state: 'failed',
      reason: 'worker_reply_invalid',
    });
  });

  it('rejects events that are not the accepted wire shape', async () => {
    const result = await worker({
      stdout: JSON.stringify({
        state: 'completed',
        delegation: 'delegated',
        events: [{ kind: 'telepathy', seq: 0, at: AT, prompt: 'secret' }],
      }),
    }).execute(run);
    expect(result).toMatchObject({ state: 'failed', reason: 'worker_events_invalid' });
    expect(result.events).toEqual([]);
  });

  it('never reports completed when the process itself failed', async () => {
    const result = await worker({
      code: 1,
      stdout: JSON.stringify({ state: 'completed', delegation: 'delegated', events: wireEvents }),
    }).execute(run);
    expect(result.state).toBe('failed');
  });

  it('reports a spawn failure as a failed run', async () => {
    const port = createProcessWorker({
      enabled: true,
      async spawn(): Promise<SpawnedWorker> {
        throw new Error('python is not installed');
      },
    });
    expect(await port.execute(run)).toMatchObject({ state: 'failed', delegation: 'unknown' });
  });
});
