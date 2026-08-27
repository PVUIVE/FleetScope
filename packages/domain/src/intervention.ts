import type { ApprovalBinding } from './approval.js';
import type {
  CaseId,
  IncidentId,
  Instant,
  InterventionId,
  PolicyVersion,
  RuntimeOperationId,
} from './ids.js';
import type { RuntimeOperation } from './session.js';

/**
 * Invariant 10: success requires authoritative Runtime evidence.
 *
 * These states are deliberately NOT collapsible. `requested` is not
 * `acknowledged`, and `acknowledged` is not `succeeded`. Never render them as
 * one "done".
 */
export const INTERVENTION_STATES = [
  'proposed',
  'authorized',
  'rejected',
  'requested',
  'acknowledged',
  'succeeded',
  'failed',
  'timed_out',
] as const;
export type InterventionState = (typeof INTERVENTION_STATES)[number];

/** Legal forward transitions. Anything else is a modelling bug. */
export const INTERVENTION_TRANSITIONS: Readonly<
  Record<InterventionState, readonly InterventionState[]>
> = {
  proposed: ['authorized', 'rejected'],
  authorized: ['requested'],
  rejected: [],
  requested: ['acknowledged', 'failed', 'timed_out'],
  acknowledged: ['succeeded', 'failed', 'timed_out'],
  succeeded: [],
  failed: [],
  timed_out: [],
};

export interface Intervention {
  readonly interventionId: InterventionId;
  readonly caseId: CaseId;
  readonly incidentId: IncidentId;
  readonly policyVersion: PolicyVersion;
  readonly actionTemplate: string;
  readonly operation: RuntimeOperation;
  readonly target: string;
  /** Exact parameters the Control Adapter will receive when present on a new proposal. */
  readonly parameters?: Readonly<Record<string, string>>;
  /** Exact evidence prefix the action was proposed against when present on a new proposal. */
  readonly boundCaseSequence?: number;
  /** True when policy required operator authorization for this action. */
  readonly approvalRequired?: boolean;
  /** Present only when policy validated a specific operator approval. */
  readonly approvalBinding?: ApprovalBinding;
  readonly state: InterventionState;
  readonly proposedAt: Instant;
  /** Present only once Runtime has acknowledged; this is the authoritative handle. */
  readonly runtimeOperationId?: RuntimeOperationId;
  /** A retry is a NEW intervention linked back to the original, never a re-run. */
  readonly retryOf?: InterventionId;
}

export function isLegalInterventionTransition(
  from: InterventionState,
  to: InterventionState,
): boolean {
  return INTERVENTION_TRANSITIONS[from].includes(to);
}
