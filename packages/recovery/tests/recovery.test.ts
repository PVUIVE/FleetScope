import { describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@fleetscope/event-schema';
import { Warden } from '@fleetscope/warden';
import {
  ALLOWLISTED_READ,
  ATTEMPT_BUDGET,
  CONTROLLED_FAULT_CLASS,
  ControlledFaultRead,
  checkAllowlisted,
  createReadRetryAdapter,
  recoverFixedRead,
  type ReadOutcome,
  type ReadPort,
} from '../src/index.js';

const AT = '2026-08-29T00:00:00.000Z';
const TOOL = 'repository.metadata.read';

/** A read that never leaves the process. No network, no credential, no cost. */
const fakeRead = (
  outcome: ReadOutcome = { ok: true, summary: 'metadata read' },
): ReadPort & { calls: number } => {
  const port = {
    calls: 0,
    async get(): Promise<ReadOutcome> {
      port.calls += 1;
      return outcome;
    },
  };
  return port;
};

const faultEvent = (): CanonicalEvent => ({
  eventId: 'evt-fault-001',
  caseId: 'CASE-D',
  caseSequence: 1,
  sessionId: 'session-d',
  sessionSequence: 1,
  schemaVersion: '1.0.0',
  type: 'tool.failed',
  sourceTime: AT,
  acceptedTime: AT,
  actor: { kind: 'agent', id: 'dependency_onboarding' },
  correlations: { caseId: 'CASE-D', toolCallId: 'tc-1' },
  payloadRedacted: { tool: TOOL, errorClass: CONTROLLED_FAULT_CLASS, controlledFault: true },
});

describe('the fixed allowlisted read', () => {
  it('permits only the exact GET target', () => {
    expect(checkAllowlisted({ method: 'GET', url: ALLOWLISTED_READ.url })).toBeNull();
    expect(checkAllowlisted({ method: 'GET', url: 'https://example.invalid/anything' })).toContain(
      'url',
    );
  });

  it('injects exactly one labelled Controlled Fault, then passes through', async () => {
    const inner = fakeRead();
    const read = new ControlledFaultRead(inner);
    const request = { method: 'GET', url: ALLOWLISTED_READ.url } as const;

    const first = await read.get(request);
    expect(first).toMatchObject({
      ok: false,
      errorClass: CONTROLLED_FAULT_CLASS,
      controlledFault: true,
    });
    expect(inner.calls).toBe(0);

    expect(await read.get(request)).toMatchObject({ ok: true });
    expect(inner.calls).toBe(1);
  });
});

describe('recoverFixedRead', () => {
  it('recovers only after the Runtime reports an applied retry', async () => {
    const read = new ControlledFaultRead(fakeRead());
    await read.get({ method: 'GET', url: ALLOWLISTED_READ.url });
    const adapter = createReadRetryAdapter(read, { now: () => AT });

    const result = await recoverFixedRead(
      { events: [faultEvent()], target: 'dependency_onboarding', at: AT },
      adapter,
    );
    expect(result).toMatchObject({ recovered: true, detail: 'metadata read' });
    expect(adapter.attempts).toHaveLength(1);
  });

  it('performs exactly one external read even under Intervention redelivery', async () => {
    const read = new ControlledFaultRead(fakeRead());
    await read.get({ method: 'GET', url: ALLOWLISTED_READ.url });
    const adapter = createReadRetryAdapter(read, { now: () => AT });
    const warden = new Warden(adapter);
    const input = { events: [faultEvent()], target: 'dependency_onboarding', at: AT };

    for (let delivery = 0; delivery < 5; delivery += 1) {
      expect(await recoverFixedRead(input, adapter, warden)).toMatchObject({ recovered: true });
    }
    expect(adapter.attempts).toHaveLength(1);
  });

  it('never claims recovery when the retry read fails', async () => {
    const read = new ControlledFaultRead(
      fakeRead({ ok: false, errorClass: 'upstream_timeout', controlledFault: false }),
    );
    await read.get({ method: 'GET', url: ALLOWLISTED_READ.url });
    const adapter = createReadRetryAdapter(read, { now: () => AT });

    expect(
      await recoverFixedRead(
        { events: [faultEvent()], target: 'dependency_onboarding', at: AT },
        adapter,
      ),
    ).toMatchObject({
      recovered: false,
      reason: 'runtime_reported_failure',
      interventionState: 'failed',
    });
  });

  it('refuses a second attempt instead of retrying again', async () => {
    const read = new ControlledFaultRead(fakeRead());
    const adapter = createReadRetryAdapter(read, { now: () => AT });

    const result = await recoverFixedRead(
      {
        events: [faultEvent()],
        target: 'dependency_onboarding',
        at: AT,
        attemptsUsed: ATTEMPT_BUDGET,
      },
      adapter,
    );
    expect(result).toMatchObject({ recovered: false, reason: 'not_authorized' });
    expect(adapter.attempts).toEqual([]);
  });

  it('does nothing at all when no controlled fault was observed', async () => {
    const adapter = createReadRetryAdapter(new ControlledFaultRead(fakeRead()), { now: () => AT });
    expect(
      await recoverFixedRead({ events: [], target: 'dependency_onboarding', at: AT }, adapter),
    ).toMatchObject({
      recovered: false,
      reason: 'no_incident_detected',
    });
    expect(adapter.attempts).toEqual([]);
  });
});
