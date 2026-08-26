import type { AgentInstanceId, AgentVersionRef, CaseId, Instant, SessionId } from './ids.js';

/** An immutable registered version. Registry owns this; FleetScope never invents one. */
export interface AgentVersion {
  readonly ref: AgentVersionRef;
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly owner: string;
  readonly purpose: string;
  readonly capabilities: readonly string[];
  readonly tools: readonly string[];
  readonly allowedCallers: readonly string[];
  readonly approvalState: 'approved' | 'deprecated' | 'unapproved';
  readonly publishedAt: Instant;
  /**
   * Risk class is FleetScope business metadata, not a Registry field.
   * Kept explicitly separate so the UI can label its provenance.
   */
  readonly fleetscopeRiskClass?: 'low' | 'medium' | 'high';
  /**
   * Protected systems this version may reach. Also FleetScope metadata: the
   * Registry records capabilities, and which real system a capability touches is
   * a FleetScope mapping. Labelled as such wherever it is shown.
   */
  readonly fleetscopeProtectedSystems?: readonly string[];
}

export const AGENT_INSTANCE_STATES = [
  'spawned',
  'started',
  'waiting',
  'completed',
  'failed',
  'cancelled',
] as const;
export type AgentInstanceState = (typeof AGENT_INSTANCE_STATES)[number];

/** A running agent within one Session. Distinct from the AgentVersion it runs. */
export interface AgentInstance {
  readonly agentInstanceId: AgentInstanceId;
  readonly caseId: CaseId;
  readonly sessionId: SessionId;
  readonly agentVersionRef: AgentVersionRef;
  readonly role: string;
  readonly parent?: AgentInstanceId;
  readonly state: AgentInstanceState;
  readonly toolCallCount: number;
  /** Unknown MUST stay unknown — never render an unknown value as zero. */
  readonly outputTokens?: number;
  readonly estimatedCostUsd?: number;
}

/**
 * Three identity kinds that must never be collapsed into one.
 * Invariant 4: protected access requires independent identity authorization.
 */
export type IdentityKind = 'agent' | 'user' | 'service';

export interface ActorRef {
  readonly kind: IdentityKind;
  readonly id: string;
  readonly agentVersionRef?: AgentVersionRef;
  readonly role?: string;
}
