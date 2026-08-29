import type { CanonicalEvent } from '@fleetscope/event-schema';
import {
  DEFAULT_DETECTOR_CONFIG,
  Warden,
  detectIncidents,
  evaluate,
  propose,
  transition,
  type DetectedIncident,
} from '@fleetscope/warden';
import type { ReadRetryAdapter } from './adapter.js';

/**
 * The fixed demo opens its incident on the FIRST labelled Controlled Fault.
 *
 * The production default needs repetition before it believes a tool is broken.
 * Here the failure is deliberately injected exactly once, so requiring three of
 * them would mean either waiting for faults FleetScope did not cause, or
 * fabricating two more. The threshold is narrowed, not the evidence.
 */
export const FIXED_DEMO_DETECTOR_CONFIG = {
  ...DEFAULT_DETECTOR_CONFIG,
  repeatedToolFailure: { ...DEFAULT_DETECTOR_CONFIG.repeatedToolFailure, threshold: 1 },
};

/** One incident, one attempt. A second retry is out of policy, not merely unused. */
export const ATTEMPT_BUDGET = 1;

export interface RecoveryInput {
  /** Observed evidence so far. Never synthesized inside this function. */
  readonly events: readonly CanonicalEvent[];
  readonly target: string;
  readonly at: string;
  readonly attemptsUsed?: number;
}

export type RecoveryResult =
  | {
      readonly recovered: true;
      readonly interventionId: string;
      readonly runtimeOperationId: string;
      readonly detail: string | null;
    }
  | {
      readonly recovered: false;
      readonly reason:
        | 'no_incident_detected'
        | 'not_authorized'
        | 'proposal_refused'
        | 'execution_refused'
        | 'runtime_reported_failure';
      readonly detail: string;
      readonly interventionState?: string;
    };

/**
 * Detect the Controlled Fault, ask the policy, and execute at most one retry.
 *
 * Every authority stays where it already lives: the detector finds the incident
 * in real evidence, the versioned policy decides, Warden owns the at-most-once
 * boundary, and the Runtime's observed result is the only thing allowed to make
 * this function report a recovery.
 */
export async function recoverFixedRead(
  input: RecoveryInput,
  adapter: ReadRetryAdapter,
  warden: Warden = new Warden(adapter),
): Promise<RecoveryResult> {
  const incident: DetectedIncident | undefined = detectIncidents(
    input.events,
    FIXED_DEMO_DETECTOR_CONFIG,
  ).find((candidate) => candidate.incidentClass === 'repeated_tool_failure');
  if (incident === undefined)
    return {
      recovered: false,
      reason: 'no_incident_detected',
      detail: 'no controlled fault was observed',
    };

  const evaluation = evaluate(
    {
      incident,
      authorization: { attemptsUsed: input.attemptsUsed ?? 0, attemptBudget: ATTEMPT_BUDGET },
    },
    input.at,
  );
  if (evaluation.disposition !== 'auto_act')
    return { recovered: false, reason: 'not_authorized', detail: evaluation.rationale };

  const proposal = propose({
    caseId: incident.caseId,
    evaluation,
    target: input.target,
    attempt: 1,
    proposedAt: input.at,
  });
  if (!proposal.ok)
    return { recovered: false, reason: 'proposal_refused', detail: proposal.failure.detail };

  const authorized = transition(proposal.intervention, 'authorized');
  if (!authorized.ok)
    return { recovered: false, reason: 'proposal_refused', detail: authorized.failure.detail };

  const executed = await warden.execute(authorized.intervention);
  if (!executed.ok)
    return { recovered: false, reason: 'execution_refused', detail: executed.failure.detail };

  const { intervention, result } = executed.outcome;
  if (intervention.state !== 'succeeded' || result?.outcome !== 'applied')
    return {
      recovered: false,
      reason: 'runtime_reported_failure',
      detail: result?.detail ?? 'the Runtime reported no applied result',
      interventionState: intervention.state,
    };

  return {
    recovered: true,
    interventionId: intervention.interventionId,
    runtimeOperationId: result.runtimeOperationId,
    detail: result.detail ?? null,
  };
}
