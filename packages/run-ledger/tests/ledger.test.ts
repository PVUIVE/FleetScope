import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEMO_SCENARIO,
  FileRunStore,
  MemoryRunStore,
  RunLedger,
  type RunStore,
} from '../src/index.js';

const clock = () => new Date('2026-08-29T00:00:00.000Z');
const ledger = (store: RunStore, maxReservedModelCalls?: number) =>
  new RunLedger(store, {
    now: clock,
    newId: () => 'run-test',
    ...(maxReservedModelCalls === undefined ? {} : { maxReservedModelCalls }),
  });
const input = { scenario: DEMO_SCENARIO, idempotencyKey: 'request-key-0001' } as const;

describe('RunLedger', () => {
  it('admits only the fixed scenario without starting execution', () => {
    const admitted = ledger(new MemoryRunStore()).admit(input);
    expect(admitted).toMatchObject({
      admitted: true,
      idempotent: false,
      run: { scenario: DEMO_SCENARIO, state: 'queued', executing: false, reservedModelCalls: 0 },
    });
  });
  it('is idempotent for repeated delivery', () => {
    const subject = ledger(new MemoryRunStore());
    const first = subject.admit(input);
    const second = subject.admit(input);
    expect(first).toMatchObject({ admitted: true, idempotent: false });
    expect(second).toMatchObject({ admitted: true, idempotent: true });
  });
  it('rejects concurrent active runs', () => {
    const subject = ledger(new MemoryRunStore());
    subject.admit(input);
    expect(subject.admit({ ...input, idempotencyKey: 'request-key-0002' })).toMatchObject({
      admitted: false,
      reason: 'active_run_exists',
    });
  });
  it('rejects a future worker reservation that exceeds the fixed demo budget', () => {
    expect(
      ledger(new MemoryRunStore(), 0).admit({ ...input, reservedModelCalls: 1 }),
    ).toMatchObject({ admitted: false, reason: 'budget_exhausted' });
  });
  it('allows another run only after a terminal transition', () => {
    const subject = ledger(new MemoryRunStore());
    const first = subject.admit(input);
    if (!first.admitted) throw new Error('admission failed');
    subject.transition(first.run.id, 'completed');
    expect(subject.admit({ ...input, idempotencyKey: 'request-key-0002' })).toMatchObject({
      admitted: true,
      idempotent: false,
    });
  });
  it('fails closed on malformed durable JSONL', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fleetscope-ledger-'));
    try {
      const path = join(directory, 'runs.jsonl');
      writeFileSync(path, '{"version":1,"kind":"run.admitted"}\n');
      expect(ledger(new FileRunStore(path)).admit(input)).toMatchObject({
        admitted: false,
        reason: 'durability_unavailable',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('surfaces an append failure as durability loss', () => {
    expect(ledger(new MemoryRunStore([], true)).admit(input)).toMatchObject({
      admitted: false,
      reason: 'durability_unavailable',
    });
  });
});
