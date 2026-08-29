import { dirname, join } from 'node:path';
import { FileRunStore, RunLedger } from '@fleetscope/run-ledger';
import type { ReadRetryAdapter } from '@fleetscope/recovery';
import { UNAVAILABLE_WORKER, type WorkerPort } from './orchestrator.js';

export interface RunDependencies {
  readonly ledger: RunLedger;
  /** The execution port. Absent capability is reported, never simulated. */
  readonly worker: WorkerPort;
  /** Present only where an authorized recovery may actually be executed. */
  readonly adapter?: ReadRetryAdapter;
}

/** The run ledger is local durable state, colocated with the local session DB. */
export function createRunDependencies(
  storagePath: string,
  options: { readonly worker?: WorkerPort } = {},
): RunDependencies {
  return {
    ledger: new RunLedger(new FileRunStore(join(dirname(storagePath), 'fleetscope-runs.jsonl'))),
    // Without an explicitly configured worker the honest answer is
    // "unavailable" — never a stub that pretends to run agents.
    worker: options.worker ?? UNAVAILABLE_WORKER,
  };
}
