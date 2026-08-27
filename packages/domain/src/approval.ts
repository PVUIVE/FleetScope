import type { CaseId, Instant } from './ids.js';

/** A concrete control action, including the evidence prefix it would act against. */
export interface ActionIntent {
  readonly caseId: CaseId;
  readonly actionTemplate: string;
  readonly target: string;
  readonly parameters: Readonly<Record<string, string>>;
  /** The exact Case evidence prefix the action was reviewed against. */
  readonly boundCaseSequence: number;
}

export const APPROVAL_DECISIONS = ['pending', 'approved', 'rejected', 'expired'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/**
 * Operator authority for one exact ActionIntent.
 *
 * This is deliberately data, not a boolean. Policy and the Control Adapter
 * boundary both recompute whether it still applies before it grants authority.
 */
export interface ApprovalBinding extends ActionIntent {
  readonly expiresAt: Instant;
  readonly decision: ApprovalDecision;
  readonly approver: string | null;
}
