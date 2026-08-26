import type { IdentityDecision } from '@fleetscope/domain';
import type { AdapterDescriptor, AdapterResponse } from '../mode.js';

/**
 * Invariant 4. The protected resource adapter authorizes INDEPENDENTLY — holding
 * an identity token is not authorization, and browser state can never grant it.
 */
export interface AgentIdentityAdapter {
  readonly descriptor: AdapterDescriptor;
  authorize(input: {
    readonly caseId: string;
    readonly agentVersionRef: string;
    readonly requestedRole: string;
    readonly audience: string;
    readonly resource: string;
  }): Promise<AdapterResponse<IdentityDecision>>;
}

/**
 * The protected ERP boundary. Read-only in the MVP unless the rules require a
 * write. Synthetic inventory is acceptable ONLY while the identity enforcement
 * path is real and the UI labels the adapter as synthetic.
 */
export interface ProtectedResourceAdapter {
  readonly descriptor: AdapterDescriptor;
  read(input: {
    readonly resource: string;
    readonly identity: IdentityDecision;
  }): Promise<AdapterResponse<{ readonly allowed: boolean; readonly summary: string }>>;
}
