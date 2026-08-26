import type { AgentVersion } from '@fleetscope/domain';
import type { AdapterDescriptor, AdapterResponse } from '../mode.js';

/**
 * Agent Registry is the authority for publication, version, and capability
 * metadata. FleetScope MUST NOT invent an approval state or a version digest.
 */
export interface AgentRegistryAdapter {
  readonly descriptor: AdapterDescriptor;
  listCatalog(): Promise<AdapterResponse<readonly AgentVersion[]>>;
  /**
   * Re-resolved at launch so a stale UI selection cannot launch a different
   * version than the operator saw (Invariant 2).
   */
  resolveVersion(ref: string): Promise<AdapterResponse<AgentVersion | null>>;
}
