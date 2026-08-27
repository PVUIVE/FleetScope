import type {
  ActionIntent,
  ApprovalBinding,
  PolicyDecision,
  PolicyDisposition,
} from '@fleetscope/domain';
import { policyVersion as toPolicyVersion } from '@fleetscope/domain';
import type { DetectedIncident, SuggestedActionClass } from './detector.js';
import { validateApprovalBinding } from './approval.js';

/**
 * The Policy Engine.
 *
 * Deterministic, versioned, and the ONLY place a disposition is chosen. Given an
 * Incident Candidate and its context it returns exactly one of:
 *
 *     observe · recommend · approval_required · auto_act
 *
 * # Model advice has no authority here
 *
 * A model may contribute advice, and FleetScope records it. It is untrusted
 * advisory DATA: it cannot raise a disposition, it cannot introduce an action
 * template, and a malformed or unallowlisted suggestion is rejected outright
 * with the rejection recorded. The strongest thing advice can do is be ignored
 * more visibly. That is Invariant 11 in executable form.
 *
 * # Why the ceiling rules come first
 *
 * The disposition is computed as "the strongest thing policy would allow",
 * capped by every applicable ceiling. Writing it the other way round — start at
 * auto_act and look for reasons to stop — means a missing rule fails OPEN.
 */

export const POLICY_VERSION = 'warden-policy@1.2.0';

/**
 * How visible the effect of an action is outside FleetScope.
 *
 * This, not the incident's severity, is what decides whether a human must be in
 * the loop. A critical incident whose only remedy is an idempotent read is safer
 * to act on than a warning whose remedy writes to a vendor record.
 */
export const SIDE_EFFECT_CLASSES = [
  /** Changes nothing anywhere. Reading, re-reading, observing. */
  'none',
  /** Repeatable without accumulating effect. A bounded retry of a read. */
  'idempotent_read',
  /** Changes FleetScope's own state only. */
  'internal_write',
  /** Changes a system outside FleetScope. Never auto-acted. */
  'external_write',
] as const;
export type SideEffectClass = (typeof SIDE_EFFECT_CLASSES)[number];

/**
 * The action templates FleetScope may ever request. A closed allow-list: an
 * action that is not here cannot be proposed, however it was suggested.
 */
export const ACTION_TEMPLATES: Readonly<
  Record<string, { readonly sideEffect: SideEffectClass; readonly operation: string }>
> = {
  retry_idempotent_read: { sideEffect: 'idempotent_read', operation: 'retry' },
  cancel_runaway_session: { sideEffect: 'internal_write', operation: 'cancel' },
  reroute_delegation: { sideEffect: 'internal_write', operation: 'reroute' },
  erp_activate_vendor: { sideEffect: 'external_write', operation: 'resume' },
};

export interface AuthorizationContext {
  /** Full operator authority, never a boolean capability. */
  readonly operatorApproval?: ApprovalBinding;
  /** The exact action policy is being asked to authorize. */
  readonly proposedAction?: ActionIntent;
  /** Interventions already attempted for this incident. */
  readonly attemptsUsed: number;
  readonly attemptBudget: number;
}

/** Untrusted advisory data. Never authority. */
export interface ModelAdvice {
  readonly model: string;
  readonly responseRef: string;
  /** What the model suggested. Validated against the allow-list before use. */
  readonly suggestedActionTemplate: string;
  readonly summary: string;
}

export interface PolicyInput {
  readonly incident: DetectedIncident;
  readonly authorization: AuthorizationContext;
  /** Present only when a model was consulted. Optional by design. */
  readonly advice?: ModelAdvice;
}

export interface PolicyEvaluation extends PolicyDecision {
  readonly sideEffectClass: SideEffectClass;
  /** Present only when policy validated this exact operator binding. */
  readonly approvalBinding?: ApprovalBinding;
  /** Why the advice was not used, when it was not. Recorded, never hidden. */
  readonly adviceRejectedReason?: string;
  /** Whether the advice, if any, influenced the outcome. Always false today. */
  readonly adviceInfluencedDisposition: boolean;
}

const DISPOSITION_RANK: Readonly<Record<PolicyDisposition, number>> = {
  observe: 0,
  recommend: 1,
  approval_required: 2,
  auto_act: 3,
};

const weakest = (a: PolicyDisposition, b: PolicyDisposition): PolicyDisposition =>
  DISPOSITION_RANK[a] <= DISPOSITION_RANK[b] ? a : b;

/** The strongest disposition an incident class may ever reach. */
function ceilingForIncident(incident: DetectedIncident): PolicyDisposition {
  switch (incident.incidentClass) {
    case 'repeated_tool_failure':
      return 'auto_act';
    case 'no_progress_loop':
      return 'approval_required';
    case 'usage_threshold_breach':
      return 'approval_required';
    // Advisory only, always. A drift detector cannot distinguish a successfully
    // defended attack from a partially successful one, so it never acts.
    case 'context_drift':
      return 'observe';
  }
}

/** The strongest disposition a side-effect class may ever reach. */
function ceilingForSideEffect(sideEffect: SideEffectClass): PolicyDisposition {
  switch (sideEffect) {
    case 'none':
    case 'idempotent_read':
      return 'auto_act';
    case 'internal_write':
      return 'approval_required';
    // An externally visible write is never auto-acted, whatever the incident.
    case 'external_write':
      return 'approval_required';
  }
}

function templateForActionClass(actionClass: SuggestedActionClass): string | null {
  switch (actionClass) {
    case 'retry_idempotent_read':
      return 'retry_idempotent_read';
    case 'none':
    case 'observe_only':
    case 'escalate_to_operator':
      return null;
  }
}

/**
 * Validate model advice.
 *
 * Returns the reason it was rejected, or null when it is well-formed. Note that
 * even well-formed advice does not change the disposition — see `evaluate`.
 */
export function rejectionReasonFor(advice: ModelAdvice): string | null {
  if (typeof advice.suggestedActionTemplate !== 'string' || advice.suggestedActionTemplate === '') {
    return 'advice carried no action template';
  }
  if (!Object.hasOwn(ACTION_TEMPLATES, advice.suggestedActionTemplate)) {
    return `advice suggested "${advice.suggestedActionTemplate}", which is not an allowlisted action template`;
  }
  if (typeof advice.model !== 'string' || advice.model === '') {
    return 'advice named no model';
  }
  if (typeof advice.responseRef !== 'string' || advice.responseRef === '') {
    return 'advice carried no verifiable response reference';
  }
  return null;
}

export function evaluate(input: PolicyInput, evaluatedAt: string): PolicyEvaluation {
  const { incident, authorization, advice } = input;

  const template = templateForActionClass(incident.suggestedActionClass);
  const sideEffect: SideEffectClass =
    template === null ? 'none' : (ACTION_TEMPLATES[template]?.sideEffect ?? 'external_write');

  // Advice is validated for the record whether or not it could matter.
  const adviceRejectedReason = advice === undefined ? null : rejectionReasonFor(advice);

  let disposition: PolicyDisposition = 'auto_act';
  const reasons: string[] = [];
  let approvalBinding: ApprovalBinding | undefined;

  const incidentCeiling = ceilingForIncident(incident);
  if (DISPOSITION_RANK[incidentCeiling] < DISPOSITION_RANK[disposition]) {
    reasons.push(`${incident.incidentClass} may reach at most ${incidentCeiling}`);
  }
  disposition = weakest(disposition, incidentCeiling);

  const sideEffectCeiling = ceilingForSideEffect(sideEffect);
  if (DISPOSITION_RANK[sideEffectCeiling] < DISPOSITION_RANK[disposition]) {
    reasons.push(`a ${sideEffect} action may reach at most ${sideEffectCeiling}`);
  }
  disposition = weakest(disposition, sideEffectCeiling);

  if (template === null) {
    reasons.push('no allowlisted action addresses this incident class');
    disposition = weakest(
      disposition,
      incident.suggestedActionClass === 'escalate_to_operator' ? 'recommend' : 'observe',
    );
  }

  // The attempt budget is a hard stop, not a preference. Exhausting it escalates
  // rather than trying again, because "the same action, once more" is exactly
  // what a budget exists to prevent.
  if (authorization.attemptsUsed >= authorization.attemptBudget) {
    reasons.push(
      `attempt budget exhausted (${authorization.attemptsUsed}/${authorization.attemptBudget}) — escalating`,
    );
    disposition = weakest(disposition, 'approval_required');
  }

  // A human approval only satisfies an approval requirement after it is matched
  // against the exact action intent. A recorded boolean would fail open if any
  // parameter, target, evidence prefix, decision, expiry, or approver changed.
  if (disposition === 'approval_required' && template !== null) {
    const approval = validateApprovalBinding(
      authorization.operatorApproval,
      authorization.proposedAction ?? {
        caseId: incident.caseId,
        actionTemplate: template,
        target: '',
        parameters: {},
        boundCaseSequence: -1,
      },
      evaluatedAt,
    );
    if (approval.ok) {
      reasons.push('operator approval was verified against the exact action and evidence prefix');
      approvalBinding = authorization.operatorApproval;
      disposition = 'auto_act';
    } else if (
      authorization.operatorApproval !== undefined ||
      authorization.proposedAction !== undefined
    ) {
      reasons.push(`operator approval is not executable: ${approval.detail}`);
    }
  }

  return {
    incidentId: incident.incidentId,
    policyVersion: toPolicyVersion(POLICY_VERSION),
    disposition,
    ...(template !== null ? { actionTemplate: template } : {}),
    evaluatedAt,
    rationale:
      reasons.length === 0
        ? `${incident.incidentClass}: an allowlisted ${sideEffect} action is permitted without operator approval`
        : reasons.join('; '),
    sideEffectClass: sideEffect,
    ...(approvalBinding !== undefined ? { approvalBinding } : {}),
    ...(adviceRejectedReason !== null ? { adviceRejectedReason } : {}),
    // Always false. Advice is recorded as evidence and never raises a
    // disposition; if this ever needs to become true it is a governance change,
    // not a code change.
    adviceInfluencedDisposition: false,
  };
}
