import type { AgentInstance } from './agent.js';
import type { Case, CaseMilestone, CaseState } from './case.js';
import type { DecisionEvidence } from './evidence.js';
import type { IncidentCandidate, PolicyDecision } from './incident.js';
import type { Intervention } from './intervention.js';
import type { MemoryRecord } from './memory.js';
import type { PlatformBadge } from './platform.js';
import type { Session } from './session.js';
import type { ApprovalId, CaseId, EventId, Instant, ProjectorVersion } from './ids.js';

/** The selected Canonical Event position. Moving it causes no side effects. */
export interface EventCursor {
  readonly caseId: CaseId;
  readonly caseSequence: number;
  readonly atEdge: boolean;
}

export interface Approval {
  readonly approvalId: ApprovalId;
  readonly caseId: CaseId;
  readonly actionTemplate: string;
  readonly target: string;
  readonly requestedAt: Instant;
  readonly expiresAt: Instant;
  /** The exact evidence prefix this approval is bound to. */
  readonly boundCaseSequence: number;
  readonly state: 'pending' | 'approved' | 'rejected' | 'expired';
  readonly approver?: string;
}

export interface UsageTotals {
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly toolCalls: number;
}

/**
 * Everything derivable from a Canonical Event prefix — and nothing else.
 * Not hidden chain-of-thought, not unrecorded external reality.
 */
export interface ObservableCaseState {
  readonly caseId: CaseId;
  readonly projectorVersion: ProjectorVersion;
  readonly cursor: EventCursor;

  readonly caseRecord: Case | null;
  readonly caseState: CaseState;
  readonly currentMilestone: CaseMilestone | null;
  readonly completedMilestones: readonly CaseMilestone[];

  readonly sessions: readonly Session[];
  readonly agents: readonly AgentInstance[];
  readonly memoryRecords: readonly MemoryRecord[];
  readonly platformBadges: readonly PlatformBadge[];
  readonly incidents: readonly IncidentCandidate[];
  readonly policyDecisions: readonly PolicyDecision[];
  readonly interventions: readonly Intervention[];
  readonly approvals: readonly Approval[];
  readonly usage: UsageTotals;

  /** Decision Evidence indexed by the event that produced it. */
  readonly evidenceByEventId: Readonly<Record<EventId, DecisionEvidence>>;

  /**
   * Screened inputs whose Armor decision was `blocked`. Invariant 3 requires
   * that no downstream memory/tool event references any of these as usable
   * content; the projector records violations rather than hiding them.
   */
  readonly blockedInputIds: readonly string[];
  readonly invariantViolations: readonly string[];

  readonly lastAcceptedAt: Instant | null;
}
