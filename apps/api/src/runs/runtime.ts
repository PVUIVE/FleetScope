import { dirname, join } from 'node:path';
import { FileRunStore, RunLedger } from '@fleetscope/run-ledger';

export interface RunDependencies {
  readonly ledger: RunLedger;
}

/** The run ledger is local durable state, colocated with the local session DB. */
export function createRunDependencies(storagePath: string): RunDependencies {
  return {
    ledger: new RunLedger(new FileRunStore(join(dirname(storagePath), 'fleetscope-runs.jsonl'))),
  };
}
