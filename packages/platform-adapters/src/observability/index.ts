import type { SourceEvent } from '@fleetscope/event-schema';
import type { AdapterDescriptor, AdapterResponse } from '../mode.js';

/**
 * Agent Observability supplies spans and audit records. A span is NOT hidden
 * chain-of-thought, and a missing span is reported as a gap rather than invented.
 */
export interface AgentObservabilityAdapter {
  readonly descriptor: AdapterDescriptor;
  collectSourceEvents(input: {
    readonly caseId: string;
    readonly sinceSourceTime?: string;
  }): Promise<AdapterResponse<readonly SourceEvent[]>>;

  /** Sampling/redaction gaps stay explicit in the projected state. */
  reportGaps(caseId: string): Promise<AdapterResponse<readonly string[]>>;
}
