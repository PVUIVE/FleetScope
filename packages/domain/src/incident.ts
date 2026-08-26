import type { CaseId, EventId, IncidentId, Instant, PolicyVersion } from './ids.js';

export const INCIDENT_CLASSES = [
  'repeated_tool_failure',
  'no_progress_loop',
  'usage_threshold_breach',
  /** Advisory only in the MVP. MUST NOT auto-act. */
  'context_drift',
] as const;
export type IncidentClass = (typeof INCIDENT_CLASSES)[number];

/** A finding that something may need attention. It is not proof and grants no authority. */
export interface IncidentCandidate {
  readonly incidentId: IncidentId;
  readonly caseId: CaseId;
  readonly incidentClass: IncidentClass;
  readonly detectorId: string;
  readonly detectorVersion: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly confidence?: number;
  readonly evidenceEventIds: readonly EventId[];
  readonly openedAt: Instant;
  readonly state: 'open' | 'updated' | 'resolved' | 'escalated';
}

/** Exactly one disposition per evaluation. */
export const POLICY_DISPOSITIONS = [
  'observe',
  'recommend',
  'approval_required',
  'auto_act',
] as const;
export type PolicyDisposition = (typeof POLICY_DISPOSITIONS)[number];

export interface PolicyDecision {
  readonly incidentId: IncidentId;
  readonly policyVersion: PolicyVersion;
  readonly disposition: PolicyDisposition;
  readonly actionTemplate?: string;
  readonly evaluatedAt: Instant;
  readonly rationale: string;
}
