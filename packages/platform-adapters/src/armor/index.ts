import type { ArmorDecision } from '@fleetscope/domain';
import type { AdapterDescriptor, AdapterResponse } from '../mode.js';

/**
 * Invariant 3. Screening happens BEFORE agent context, memory, or tool use — a
 * decision produced after downstream use proves nothing.
 *
 * If Model Armor is unavailable, the golden path fails CLOSED for untrusted
 * external input; it does not proceed unscreened.
 */
export interface ModelArmorAdapter {
  readonly descriptor: AdapterDescriptor;
  screen(input: {
    readonly caseId: string;
    readonly channel: 'vendor_email' | 'vendor_attachment' | 'webhook';
    readonly content: string;
  }): Promise<AdapterResponse<ArmorDecision>>;
}
