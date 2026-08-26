import type { AgentVersionRef, CaseId, Instant, SessionId } from './ids.js';

/**
 * Invariant 1: the Case is the root correlation.
 * Invariant 2: a running Case stays bound to the Agent Version it launched with,
 *              regardless of later Registry publications.
 *
 * A Case is NOT a trace and NOT a single invocation. It spans several Sessions.
 */
export const CASE_MILESTONES = [
  'review',
  'negotiation',
  'compliance',
  'logistics',
  'activation',
] as const;
export type CaseMilestone = (typeof CASE_MILESTONES)[number];

export const CASE_STATES = [
  'active',
  'waiting',
  'approval_required',
  'completed',
  'failed',
  'cancelled',
] as const;
export type CaseState = (typeof CASE_STATES)[number];

/**
 * How the evidence backing a surface was produced. Every FleetScope surface
 * must be able to label its mode honestly (docs/design/budget-demo.md).
 */
export const EXECUTION_MODES = ['recorded', 'live', 'synthetic', 'simulated'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export interface Case {
  readonly caseId: CaseId;
  readonly title: string;
  readonly vendor: string;
  readonly owner: string;
  /** Bound at launch. Immutable for the life of the Case. */
  readonly agentVersionRef: AgentVersionRef;
  /** Memory Bank scope; a Case MUST NOT read outside it. */
  readonly memoryScope: string;
  readonly createdAt: Instant;
  readonly sessions: readonly SessionId[];
  readonly executionMode: ExecutionMode;
}
