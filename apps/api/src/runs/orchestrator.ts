import {
  CONTROLLED_FAULT_CLASS,
  recoverFixedRead,
  type ReadRetryAdapter,
} from '@fleetscope/recovery';
import type { CanonicalEvent } from '@fleetscope/event-schema';
import type { Run, RunLedger } from '@fleetscope/run-ledger';

/**
 * One local run, from admission to a terminal state.
 *
 * The orchestrator owns sequencing and nothing else. It cannot execute an agent,
 * reach a model, or perform a read: the worker is a port and the recovery path
 * is Warden's. That is what lets the production build mount this code while
 * still reporting, truthfully, that no worker exists.
 *
 * Terminal states, and what each one actually means:
 *
 *   completed   the worker delegated AND, if a Controlled Fault occurred, the
 *               Runtime reported the authorized retry as applied
 *   incomplete  nothing false happened, but the proof is missing — no worker, or
 *               delegation was never observed
 *   failed      something observed went wrong and was reported as such
 */

export type WorkerState = 'completed' | 'incomplete' | 'failed';

export interface WorkerRun {
  readonly state: WorkerState;
  /** 'delegated' only when a delegated agent was actually observed. */
  readonly delegation: 'delegated' | 'unknown';
  /** Evidence the worker observed. Empty when it never ran. */
  readonly events: readonly CanonicalEvent[];
  readonly reason: string | null;
}

/**
 * The worker port.
 *
 * `available: false` is a first-class answer, not an error: a local FleetScope
 * without a Python/ADK worker is the normal case, and it must say so rather
 * than fail in a way that looks like a bug.
 */
export interface WorkerPort {
  readonly available: boolean;
  execute(run: Run): Promise<WorkerRun>;
}

export interface OrchestrationDependencies {
  readonly ledger: RunLedger;
  readonly worker: WorkerPort;
  /** Present only where a recovery may be executed. Absent means "cannot recover". */
  readonly adapter?: ReadRetryAdapter;
  readonly now?: () => string;
}

export interface RunReport {
  readonly runId: string;
  readonly state: WorkerState;
  readonly delegation: 'delegated' | 'unknown';
  readonly recovery: 'not_required' | 'recovered' | 'not_recovered' | 'unavailable';
  readonly reason: string | null;
}

const hasControlledFault = (events: readonly CanonicalEvent[]): boolean =>
  events.some(
    (event) =>
      event.type === 'tool.failed' &&
      event.payloadRedacted['errorClass'] === CONTROLLED_FAULT_CLASS,
  );

/**
 * Advance one admitted run to a terminal state, recording every step.
 *
 * The ledger is written before and after the work, so a crash mid-run leaves a
 * run that is visibly unfinished rather than one that looks like it never
 * started.
 */
export async function executeRun(
  run: Run,
  dependencies: OrchestrationDependencies,
): Promise<RunReport> {
  const { ledger, worker } = dependencies;
  const at = dependencies.now ?? (() => new Date().toISOString());

  if (!worker.available) {
    ledger.transition(run.id, 'incomplete', 'worker_unavailable');
    return {
      runId: run.id,
      state: 'incomplete',
      delegation: 'unknown',
      recovery: 'unavailable',
      reason: 'worker_unavailable',
    };
  }

  ledger.transition(run.id, 'executing', null);
  const observed = await worker.execute(run);

  if (observed.state === 'failed') {
    ledger.transition(run.id, 'failed', observed.reason);
    return {
      runId: run.id,
      state: 'failed',
      delegation: observed.delegation,
      recovery: 'not_required',
      reason: observed.reason,
    };
  }

  let recovery: RunReport['recovery'] = 'not_required';
  let reason = observed.reason;

  if (hasControlledFault(observed.events)) {
    if (dependencies.adapter === undefined) {
      recovery = 'unavailable';
      reason = 'control_adapter_unavailable';
    } else {
      const recovered = await recoverFixedRead(
        { events: observed.events, target: run.scenario, at: at() },
        dependencies.adapter,
      );
      recovery = recovered.recovered ? 'recovered' : 'not_recovered';
      if (!recovered.recovered) reason = recovered.reason;
    }
  }

  // A run is complete only when the worker delegated and any fault it hit was
  // actually recovered. Anything less is incomplete, never a quiet success.
  const complete =
    observed.state === 'completed' &&
    observed.delegation === 'delegated' &&
    recovery !== 'not_recovered' &&
    recovery !== 'unavailable';

  ledger.transition(run.id, complete ? 'completed' : 'incomplete', complete ? null : reason);
  return {
    runId: run.id,
    state: complete ? 'completed' : 'incomplete',
    delegation: observed.delegation,
    recovery,
    reason: complete ? null : reason,
  };
}

/** The production worker: honestly absent until a real ADK worker is wired in. */
export const UNAVAILABLE_WORKER: WorkerPort = {
  available: false,
  async execute(): Promise<WorkerRun> {
    throw new Error('no worker is available');
  },
};
