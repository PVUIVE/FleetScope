import { describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@fleetscope/event-schema';
import {
  ALLOWLISTED_READ,
  CONTROLLED_FAULT_CLASS,
  ControlledFaultRead,
  createReadRetryAdapter,
  type ReadOutcome,
  type ReadPort,
} from '@fleetscope/recovery';
import { DEMO_SCENARIO, MemoryRunStore, RunLedger, type Run } from '@fleetscope/run-ledger';
import {
  UNAVAILABLE_WORKER,
  executeRun,
  type WorkerPort,
  type WorkerRun,
} from '../src/runs/orchestrator.js';

const AT = '2026-08-29T00:00:00.000Z';

const admit = (): { ledger: RunLedger; run: Run } => {
  const ledger = new RunLedger(new MemoryRunStore(), {
    now: () => new Date(AT),
    newId: () => 'run-e',
  });
  const admitted = ledger.admit({ scenario: DEMO_SCENARIO, idempotencyKey: 'orchestration-0001' });
  if (!admitted.admitted) throw new Error('admission failed');
  return { ledger, run: admitted.run };
};

const faultEvent = (): CanonicalEvent => ({
  eventId: 'evt-fault-001',
  caseId: 'CASE-E',
  caseSequence: 1,
  sessionId: 'session-e',
  sessionSequence: 1,
  schemaVersion: '1.0.0',
  type: 'tool.failed',
  sourceTime: AT,
  acceptedTime: AT,
  actor: { kind: 'agent', id: DEMO_SCENARIO },
  correlations: { caseId: 'CASE-E', toolCallId: 'tc-1' },
  payloadRedacted: { tool: 'repository.metadata.read', errorClass: CONTROLLED_FAULT_CLASS },
});

const worker = (result: WorkerRun): WorkerPort => ({
  available: true,
  async execute(): Promise<WorkerRun> {
    return result;
  },
});

const delegated = (events: readonly CanonicalEvent[] = []): WorkerRun => ({
  state: 'completed',
  delegation: 'delegated',
  events,
  reason: null,
});

/** A read that stays in-process: no network, no credential, no cost. */
const adapterFor = async (outcome: ReadOutcome) => {
  const port: ReadPort = {
    async get() {
      return outcome;
    },
  };
  const read = new ControlledFaultRead(port);
  await read.get({ method: 'GET', url: ALLOWLISTED_READ.url });
  return createReadRetryAdapter(read, { now: () => AT });
};

describe('executeRun', () => {
  it('reports an absent worker as incomplete, never as success', async () => {
    const { ledger, run } = admit();
    const report = await executeRun(run, { ledger, worker: UNAVAILABLE_WORKER });
    expect(report).toMatchObject({
      state: 'incomplete',
      recovery: 'unavailable',
      reason: 'worker_unavailable',
    });
    expect(ledger.get(run.id)).toMatchObject({
      ok: true,
      run: { state: 'incomplete', executing: false },
    });
  });

  it('completes only when delegation happened and no fault needed recovery', async () => {
    const { ledger, run } = admit();
    const report = await executeRun(run, { ledger, worker: worker(delegated()), now: () => AT });
    expect(report).toMatchObject({
      state: 'completed',
      delegation: 'delegated',
      recovery: 'not_required',
    });
    expect(ledger.get(run.id)).toMatchObject({ ok: true, run: { state: 'completed' } });
  });

  it('completes a run whose Controlled Fault was actually recovered', async () => {
    const { ledger, run } = admit();
    const adapter = await adapterFor({ ok: true, summary: 'metadata read' });
    const report = await executeRun(run, {
      ledger,
      worker: worker(delegated([faultEvent()])),
      adapter,
      now: () => AT,
    });
    expect(report).toMatchObject({ state: 'completed', recovery: 'recovered' });
    expect(adapter.attempts).toHaveLength(1);
  });

  it('refuses to complete when the authorized retry did not apply', async () => {
    const { ledger, run } = admit();
    const adapter = await adapterFor({
      ok: false,
      errorClass: 'upstream_timeout',
      controlledFault: false,
    });
    const report = await executeRun(run, {
      ledger,
      worker: worker(delegated([faultEvent()])),
      adapter,
      now: () => AT,
    });
    expect(report).toMatchObject({ state: 'incomplete', recovery: 'not_recovered' });
    expect(ledger.get(run.id)).toMatchObject({ ok: true, run: { state: 'incomplete' } });
  });

  it('cannot recover a fault when no Control Adapter is available', async () => {
    const { ledger, run } = admit();
    const report = await executeRun(run, {
      ledger,
      worker: worker(delegated([faultEvent()])),
      now: () => AT,
    });
    expect(report).toMatchObject({
      state: 'incomplete',
      recovery: 'unavailable',
      reason: 'control_adapter_unavailable',
    });
  });

  it('reports unobserved delegation as incomplete', async () => {
    const { ledger, run } = admit();
    const report = await executeRun(run, {
      ledger,
      worker: worker({
        state: 'incomplete',
        delegation: 'unknown',
        events: [],
        reason: 'delegation_not_observed',
      }),
      now: () => AT,
    });
    expect(report).toMatchObject({
      state: 'incomplete',
      delegation: 'unknown',
      reason: 'delegation_not_observed',
    });
  });

  it('records the run evidence through the collector', async () => {
    const { ledger, run } = admit();
    const batches: { sessionId: string; events: unknown[] }[] = [];
    const report = await executeRun(run, {
      ledger,
      worker: worker({
        ...delegated(),
        wire: [
          { kind: 'session.start', seq: 0, at: AT, agent: DEMO_SCENARIO },
          { kind: 'session.end', seq: 1, at: AT, agent: DEMO_SCENARIO },
        ],
      }),
      events: {
        ingest(batch) {
          batches.push({ sessionId: batch.sessionId, events: [...batch.events] });
          return { accepted: batch.events.length };
        },
      },
      now: () => AT,
    });
    expect(report).toMatchObject({ state: 'completed', persisted: 2 });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.sessionId).toBe(run.id);
  });

  it('reports zero persisted rather than recording evidence the collector would reject', async () => {
    const { ledger, run } = admit();
    const report = await executeRun(run, {
      ledger,
      worker: worker({ ...delegated(), wire: [{ kind: 'telepathy', seq: 0, at: AT }] }),
      events: { ingest: () => ({ accepted: 99 }) },
      now: () => AT,
    });
    expect(report.persisted).toBe(0);
  });

  it('reports an observed worker failure as failed', async () => {
    const { ledger, run } = admit();
    const report = await executeRun(run, {
      ledger,
      worker: worker({ state: 'failed', delegation: 'unknown', events: [], reason: 'timeout' }),
      now: () => AT,
    });
    expect(report).toMatchObject({ state: 'failed', reason: 'timeout' });
    expect(ledger.get(run.id)).toMatchObject({ ok: true, run: { state: 'failed' } });
  });
});
