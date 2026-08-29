import type { Intervention } from '@fleetscope/domain';
import type { ControlAck, ControlAdapter, ControlResult } from '@fleetscope/warden';
import { ALLOWLISTED_READ, checkAllowlisted, type ReadPort } from './read.js';

/**
 * The Control Adapter for the fixed demo's one recovery action.
 *
 * Warden reserves the Intervention id BEFORE calling `request`, so the external
 * read below happens at most once per Intervention even under redelivery. The
 * adapter reports what the read actually returned; it never upgrades "I asked"
 * into "it worked" — `observe` is the only source of an authoritative outcome.
 */
export interface ReadRetryAdapter extends ControlAdapter {
  /** External read attempts this adapter actually performed. */
  readonly attempts: readonly string[];
}

export function createReadRetryAdapter(
  read: ReadPort,
  options: { readonly mode?: ControlAdapter['mode']; readonly now?: () => string } = {},
): ReadRetryAdapter {
  const now = options.now ?? (() => new Date().toISOString());
  const attempts: string[] = [];
  const results = new Map<string, ControlResult>();

  return {
    mode: options.mode ?? 'synthetic',
    attempts,

    async request(intervention: Intervention): Promise<ControlAck> {
      const request = { method: ALLOWLISTED_READ.method, url: ALLOWLISTED_READ.url } as const;
      const rejection = checkAllowlisted(request);
      if (rejection !== null) throw new Error(`refused: ${rejection}`);

      const runtimeOperationId = `op-${intervention.interventionId}`;
      attempts.push(runtimeOperationId);
      const outcome = await read.get(request);
      results.set(runtimeOperationId, {
        runtimeOperationId,
        outcome: outcome.ok ? 'applied' : 'failed',
        observedAt: now(),
        ...(outcome.ok ? { detail: outcome.summary } : { detail: outcome.errorClass }),
      });
      return { runtimeOperationId, acknowledgedAt: now() };
    },

    async observe(runtimeOperationId: string): Promise<ControlResult> {
      const result = results.get(runtimeOperationId);
      // An unobservable operation is not a successful one.
      if (result === undefined) throw new Error('the retry read reported no result');
      return result;
    },
  };
}
