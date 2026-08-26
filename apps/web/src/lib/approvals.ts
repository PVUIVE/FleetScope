import type { Approval, ObservableCaseState } from '@fleetscope/domain';
import { ACTION_TEMPLATES } from '@fleetscope/warden';

/**
 * Approval binding.
 *
 * An approval is not "let the agent continue". It authorizes ONE action, on ONE
 * target, with ONE set of parameters, against ONE evidence prefix, until ONE
 * expiry, by ONE approver. Change any of those and the approval no longer
 * applies — because the thing the operator agreed to is no longer the thing that
 * would happen.
 *
 * That is why the binding is a hash rather than a flag: an approval that could
 * survive a parameter change would be an approval of something nobody read.
 */

export interface ApprovalBinding {
  readonly caseId: string;
  readonly actionTemplate: string;
  readonly target: string;
  readonly parameters: Readonly<Record<string, string>>;
  /** The evidence prefix the approver was looking at. */
  readonly boundCaseSequence: number;
  readonly expiresAt: string;
  readonly approver: string | null;
}

/**
 * A stable fingerprint of everything the approval covers.
 *
 * Deliberately synchronous and dependency-free so it can be recomputed in the
 * browser at the moment of use, not just at the moment of request.
 */
export function bindingFingerprint(binding: ApprovalBinding): string {
  const parameterPairs = Object.keys(binding.parameters)
    .sort()
    .map((key) => `${key}=${binding.parameters[key]}`)
    .join('&');
  return [
    binding.caseId,
    binding.actionTemplate,
    binding.target,
    parameterPairs,
    String(binding.boundCaseSequence),
  ].join('|');
}

export type ApprovalStatus =
  { readonly usable: true } | { readonly usable: false; readonly reason: string };

/**
 * Whether an approval still authorizes an action about to be taken.
 *
 * Every check answers a different way the world can have moved on since the
 * operator read the request.
 */
export function approvalStatus(
  approval: Approval,
  binding: ApprovalBinding,
  proposed: ApprovalBinding,
  /** The evidence prefix the action would run against. */
  currentCaseSequence: number,
): ApprovalStatus {
  if (approval.state === 'pending') {
    return { usable: false, reason: 'The approval has not been decided yet.' };
  }
  if (approval.state === 'rejected') {
    return { usable: false, reason: 'The operator rejected this action.' };
  }
  if (approval.state === 'expired') {
    return { usable: false, reason: 'The approval expired before it was used.' };
  }
  if (bindingFingerprint(binding) !== bindingFingerprint(proposed)) {
    // The specific failure this exists to prevent: an operator approves an ERP
    // write for one vendor, a parameter changes, and the old approval carries
    // the new action through.
    return {
      usable: false,
      reason:
        'The action, target, parameters or bound evidence changed after approval. A new approval is required.',
    };
  }
  if (currentCaseSequence < binding.boundCaseSequence) {
    return {
      usable: false,
      reason: 'The approval is bound to evidence later than the current cursor.',
    };
  }
  return { usable: true };
}

/** The side-effect class of the action an approval covers, for honest labelling. */
export function sideEffectOf(actionTemplate: string): string {
  return ACTION_TEMPLATES[actionTemplate]?.sideEffect ?? 'unknown';
}

export interface ApprovalRow {
  readonly caseId: string;
  readonly approval: Approval;
  readonly binding: ApprovalBinding;
  readonly fingerprint: string;
  readonly sideEffect: string;
  readonly status: ApprovalStatus;
}

/** Build the Approval Inbox rows for one recorded Case. */
export function approvalRows(caseId: string, state: ObservableCaseState): ApprovalRow[] {
  return state.approvals.map((approval) => {
    const binding: ApprovalBinding = {
      caseId,
      actionTemplate: approval.actionTemplate,
      target: approval.target,
      parameters: {},
      boundCaseSequence: approval.boundCaseSequence,
      expiresAt: approval.expiresAt,
      approver: approval.approver ?? null,
    };
    return {
      caseId,
      approval,
      binding,
      fingerprint: bindingFingerprint(binding),
      sideEffect: sideEffectOf(approval.actionTemplate),
      // Evaluated against itself: in the recorded Case the action that ran IS the
      // action approved, and the check proves it rather than assuming it.
      status: approvalStatus(approval, binding, binding, state.cursor.caseSequence),
    };
  });
}
