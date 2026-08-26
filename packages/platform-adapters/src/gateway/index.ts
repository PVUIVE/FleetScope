import type { GatewayDecision } from '@fleetscope/domain';
import type { AdapterDescriptor, AdapterResponse } from '../mode.js';

/**
 * Invariant 5. FleetScope MUST NOT draw a "routed" edge until a recorded
 * Gateway Decision exists — the edge is evidence, not decoration.
 */
export interface AgentGatewayAdapter {
  readonly descriptor: AdapterDescriptor;
  route(input: {
    readonly caseId: string;
    readonly sourceAgentVersionRef: string;
    readonly destinationAgentVersionRef: string;
    readonly requestedCapability: string;
  }): Promise<AdapterResponse<GatewayDecision>>;
}
