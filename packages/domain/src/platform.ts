import type { AgentVersionRef, EventId, Instant, ScreenedInputId } from './ids.js';

/**
 * The seven Gemini Enterprise Agent Platform capabilities FleetScope composes.
 * FleetScope explains these decisions; it never manufactures one.
 */
export const PLATFORM_SERVICES = [
  'registry',
  'runtime',
  'memory',
  'identity',
  'gateway',
  'armor',
  'observability',
] as const;
export type PlatformService = (typeof PLATFORM_SERVICES)[number];

/** Identity decision for a protected resource request. */
export interface IdentityDecision {
  readonly kind: 'identity';
  readonly outcome: 'allowed' | 'denied';
  readonly subjectAgentVersionRef: AgentVersionRef;
  readonly requestedRole: string;
  readonly audience: string;
  readonly resource: string;
  readonly reason?: string;
}

/** Invariant 5: agent-to-agent delegation passes through Gateway. */
export interface GatewayDecision {
  readonly kind: 'gateway';
  readonly outcome: 'routed' | 'denied';
  readonly sourceAgentVersionRef: AgentVersionRef;
  readonly destinationAgentVersionRef: AgentVersionRef;
  readonly requestedCapability: string;
  readonly routePolicyRef: string;
  readonly reason?: string;
}

/** Invariant 3: external input is screened before context, memory, or tool use. */
export interface ArmorDecision {
  readonly kind: 'armor';
  readonly outcome: 'allowed' | 'blocked' | 'sanitized' | 'flagged';
  readonly screenedInputId: ScreenedInputId;
  readonly inputDigest: string;
  readonly policyVersion: string;
  readonly findingClass?: string;
}

export interface RegistryDecision {
  readonly kind: 'registry';
  readonly outcome: 'resolved' | 'unavailable';
  readonly agentVersionRef: AgentVersionRef;
  readonly digest: string;
}

export type PlatformDecision =
  IdentityDecision | GatewayDecision | ArmorDecision | RegistryDecision;

/**
 * Every UI badge derives from evidence (Invariant 6). A badge carries the event
 * that produced it so selecting it can open the exact Decision Evidence.
 */
export interface PlatformBadge {
  readonly service: PlatformService;
  readonly label: string;
  readonly decision: PlatformDecision;
  readonly evidenceEventId: EventId;
  readonly at: Instant;
}
