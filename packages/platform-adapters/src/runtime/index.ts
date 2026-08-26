import type { RuntimeOperation, SessionState } from '@fleetscope/domain';
import type { AdapterDescriptor, AdapterResponse } from '../mode.js';

/**
 * Agent Runtime owns execution and is the ONLY authority on whether a requested
 * control actually happened. Acknowledgement and terminal result are separate
 * facts and are never collapsed (Invariant 10).
 */
export interface RuntimeAcknowledgement {
  readonly runtimeOperationId: string;
  readonly accepted: boolean;
  readonly acknowledgedAt: string;
}

export interface RuntimeResult {
  readonly runtimeOperationId: string;
  readonly state: SessionState;
  readonly terminal: boolean;
  readonly observedAt: string;
}

export interface AgentRuntimeAdapter {
  readonly descriptor: AdapterDescriptor;
  start(input: {
    readonly caseId: string;
    readonly agentVersionRef: string;
    readonly memoryScope: string;
  }): Promise<AdapterResponse<RuntimeAcknowledgement>>;

  resume(input: {
    readonly caseId: string;
    readonly sessionId: string;
    readonly trigger: string;
  }): Promise<AdapterResponse<RuntimeAcknowledgement>>;

  /**
   * The Control Adapter's only door into Runtime. MUST be idempotent for an
   * interventionId: redelivery returns the original acknowledgement rather than
   * acting twice.
   */
  control(input: {
    readonly caseId: string;
    readonly interventionId: string;
    readonly operation: RuntimeOperation;
    readonly target: string;
  }): Promise<AdapterResponse<RuntimeAcknowledgement>>;

  /** Read the authoritative result. Never infer success from request intent. */
  observe(runtimeOperationId: string): Promise<AdapterResponse<RuntimeResult | null>>;
}
