import { z } from 'zod';
import { EVENT_TYPES } from './event-types.js';
import { actorRefSchema, correlationsSchema } from './canonical-event.js';

/**
 * A Source Event is a raw fact from Runtime, Registry, Memory Bank, Identity,
 * Gateway, Model Armor, the tool gateway, a usage meter, or the control plane.
 *
 * It carries NO sequence numbers: ordering is assigned at canonicalization, not
 * claimed by the emitter. Source Events may be duplicated, late, or out of order.
 */
export const sourceEventSchema = z
  .object({
    /** Emitter-supplied dedupe key. Redelivery of the same key is idempotent. */
    dedupeKey: z.string().min(1),
    caseId: z.string().min(1),
    sessionId: z.string().min(1).nullable(),
    type: z.enum(EVENT_TYPES),
    sourceTime: z.string().min(1),
    actor: actorRefSchema,
    correlations: correlationsSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type SourceEvent = z.infer<typeof sourceEventSchema>;

export function parseSourceEvent(input: unknown) {
  return sourceEventSchema.safeParse(input);
}
