import type { MemoryRecord } from '@fleetscope/domain';
import type { AdapterDescriptor, AdapterResponse } from '../mode.js';

/**
 * Memory Bank stores provenance-bearing DATA. A recalled record is never an
 * instruction, and a Case may not read outside its authorized scope.
 */
export interface MemoryBankAdapter {
  readonly descriptor: AdapterDescriptor;
  /**
   * External content may only be written after a Model Armor decision allowed
   * or sanitized it; `screenedInputId` records which decision authorized this.
   */
  write(input: {
    readonly scope: string;
    readonly summary: string;
    readonly sensitivity: MemoryRecord['sensitivity'];
    readonly screenedInputId?: string;
  }): Promise<AdapterResponse<MemoryRecord>>;

  /** Reads outside `scope` must be refused and recorded as `memory.rejected`. */
  recall(input: {
    readonly scope: string;
    readonly query: string;
  }): Promise<AdapterResponse<readonly MemoryRecord[]>>;
}
