import type { ActionIntent, ApprovalBinding } from '@fleetscope/domain';

export type ApprovalBindingFailureReason =
  | 'missing_approval'
  | 'decision_not_approved'
  | 'missing_approver'
  | 'case_mismatch'
  | 'action_mismatch'
  | 'target_mismatch'
  | 'parameters_mismatch'
  | 'evidence_prefix_mismatch'
  | 'invalid_expiry'
  | 'invalid_evaluation_time'
  | 'expired';

export type ApprovalBindingValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ApprovalBindingFailureReason; readonly detail: string };

function sameParameters(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Verify that an operator approved exactly the action about to execute.
 *
 * This deliberately fails closed: malformed times, missing approvers, a later
 * evidence prefix, or any changed action field invalidate the authorization.
 */
export function validateApprovalBinding(
  approval: ApprovalBinding | undefined,
  intent: ActionIntent,
  evaluatedAt: string,
): ApprovalBindingValidation {
  if (approval === undefined) {
    return { ok: false, reason: 'missing_approval', detail: 'no operator approval is attached' };
  }
  if (approval.decision !== 'approved') {
    return {
      ok: false,
      reason: 'decision_not_approved',
      detail: `approval decision is "${approval.decision}", not "approved"`,
    };
  }
  if (typeof approval.approver !== 'string' || approval.approver.trim() === '') {
    return { ok: false, reason: 'missing_approver', detail: 'approved binding names no approver' };
  }
  if (approval.caseId !== intent.caseId) {
    return { ok: false, reason: 'case_mismatch', detail: 'approval is bound to another Case' };
  }
  if (approval.actionTemplate !== intent.actionTemplate) {
    return { ok: false, reason: 'action_mismatch', detail: 'approval action template changed' };
  }
  if (approval.target !== intent.target) {
    return { ok: false, reason: 'target_mismatch', detail: 'approval target changed' };
  }
  if (!sameParameters(approval.parameters, intent.parameters)) {
    return { ok: false, reason: 'parameters_mismatch', detail: 'approval parameters changed' };
  }
  if (approval.boundCaseSequence !== intent.boundCaseSequence) {
    return {
      ok: false,
      reason: 'evidence_prefix_mismatch',
      detail: 'approval is bound to a different Case evidence prefix',
    };
  }

  const expiry = timestamp(approval.expiresAt);
  if (expiry === null) {
    return {
      ok: false,
      reason: 'invalid_expiry',
      detail: 'approval expiry is not a valid timestamp',
    };
  }
  const at = timestamp(evaluatedAt);
  if (at === null) {
    return {
      ok: false,
      reason: 'invalid_evaluation_time',
      detail: 'approval evaluation time is not a valid timestamp',
    };
  }
  if (at >= expiry) {
    return { ok: false, reason: 'expired', detail: 'approval expired before execution' };
  }
  return { ok: true };
}
