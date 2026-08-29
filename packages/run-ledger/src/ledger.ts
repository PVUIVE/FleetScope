import { randomUUID } from 'node:crypto';
import { DEMO_SCENARIO, isTerminal, type DemoScenario, type Run, type RunState } from './record.js';
import type { RunStore } from './store.js';

const idempotencyKey = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export interface RunLedgerOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly maxReservedModelCalls?: number;
}
export interface AdmitInput {
  readonly scenario: DemoScenario;
  readonly idempotencyKey: string;
  readonly reservedModelCalls?: number;
}
export type Admission =
  | { readonly admitted: true; readonly run: Run; readonly idempotent: boolean }
  | {
      readonly admitted: false;
      readonly reason:
        | 'invalid_idempotency_key'
        | 'active_run_exists'
        | 'budget_exhausted'
        | 'durability_unavailable';
      readonly detail: string;
    };
export type Lookup =
  { readonly ok: true; readonly run: Run | null } | { readonly ok: false; readonly reason: string };

export class RunLedger {
  private readonly now: () => Date;
  private readonly newId: () => string;
  readonly maxReservedModelCalls: number;

  constructor(
    private readonly store: RunStore,
    options: RunLedgerOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => `run-${randomUUID()}`);
    this.maxReservedModelCalls = options.maxReservedModelCalls ?? 6;
  }

  capability(): {
    readonly durability: 'ready' | 'unavailable';
    readonly reason: string | null;
    readonly activeRunId: string | null;
    readonly maxReservedModelCalls: number;
  } {
    const loaded = this.snapshot();
    if (!loaded.ok)
      return {
        durability: 'unavailable',
        reason: loaded.reason,
        activeRunId: null,
        maxReservedModelCalls: this.maxReservedModelCalls,
      };
    const active = [...loaded.runs.values()].find((run) => !isTerminal(run.state)) ?? null;
    return {
      durability: 'ready',
      reason: null,
      activeRunId: active?.id ?? null,
      maxReservedModelCalls: this.maxReservedModelCalls,
    };
  }

  get(id: string): Lookup {
    const loaded = this.snapshot();
    return loaded.ok
      ? { ok: true, run: loaded.runs.get(id) ?? null }
      : { ok: false, reason: loaded.reason };
  }

  active(): Lookup {
    const loaded = this.snapshot();
    if (!loaded.ok) return { ok: false, reason: loaded.reason };
    return {
      ok: true,
      run: [...loaded.runs.values()].find((run) => !isTerminal(run.state)) ?? null,
    };
  }

  admit(input: AdmitInput): Admission {
    if (!idempotencyKey.test(input.idempotencyKey))
      return {
        admitted: false,
        reason: 'invalid_idempotency_key',
        detail: 'Idempotency-Key must be 8–128 safe characters.',
      };
    const loaded = this.snapshot();
    if (!loaded.ok)
      return { admitted: false, reason: 'durability_unavailable', detail: loaded.reason };
    const existing = [...loaded.runs.values()].find(
      (run) => run.idempotencyKey === input.idempotencyKey,
    );
    if (existing !== undefined) return { admitted: true, run: existing, idempotent: true };
    const reservedModelCalls = input.reservedModelCalls ?? 0;
    if (
      !Number.isInteger(reservedModelCalls) ||
      reservedModelCalls < 0 ||
      reservedModelCalls > this.maxReservedModelCalls
    )
      return {
        admitted: false,
        reason: 'budget_exhausted',
        detail: 'Reserved model-call budget exceeds the fixed demo limit.',
      };
    if ([...loaded.runs.values()].some((run) => !isTerminal(run.state)))
      return {
        admitted: false,
        reason: 'active_run_exists',
        detail: 'Only one fixed demo run may be active.',
      };
    const now = this.now().toISOString();
    const run: Run = {
      id: this.newId(),
      scenario: input.scenario,
      idempotencyKey: input.idempotencyKey,
      state: 'queued',
      executing: false,
      reservedModelCalls,
      createdAt: now,
      updatedAt: now,
      reason: 'worker_unavailable',
    };
    const appended = this.store.append({ version: 1, kind: 'run.admitted', at: now, run });
    return appended.ok
      ? { admitted: true, run, idempotent: false }
      : { admitted: false, reason: 'durability_unavailable', detail: appended.reason };
  }

  transition(id: string, state: RunState, reason: string | null = null): Lookup {
    const found = this.get(id);
    if (!found.ok || found.run === null || isTerminal(found.run.state)) return found;
    const run: Run = {
      ...found.run,
      state,
      executing: state === 'executing',
      updatedAt: this.now().toISOString(),
      reason,
    };
    const appended = this.store.append({ version: 1, kind: 'run.state', at: run.updatedAt, run });
    return appended.ok ? { ok: true, run } : { ok: false, reason: appended.reason };
  }

  private snapshot():
    | { readonly ok: true; readonly runs: ReadonlyMap<string, Run> }
    | { readonly ok: false; readonly reason: string } {
    const loaded = this.store.load();
    if (!loaded.ok) return loaded;
    const runs = new Map<string, Run>();
    for (const record of loaded.records) runs.set(record.run.id, record.run);
    return { ok: true, runs };
  }
}

export { DEMO_SCENARIO };
