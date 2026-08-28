import { z } from 'zod';

/**
 * The FleetScope ADK wire format.
 *
 * This is what `examples/fleetscope_adk` (a Google ADK `BasePlugin`) posts to
 * the local collector. It is deliberately a THIN, explicit record of what the
 * official ADK callbacks actually hand over — not a mirror of ADK's internal
 * types, which would couple FleetScope to a version.
 *
 * Rules the shape encodes:
 *
 *   - every field except `kind`, `seq` and `at` is optional, because ADK does
 *     not report all of them on every callback;
 *   - an absent field stays absent all the way to the UI, where it renders as
 *     "Unknown". It is never defaulted to 0 or to an empty string;
 *   - no field carries a prompt, a completion, or model reasoning. The plugin
 *     does not send them, and the Canonicalizer would redact them if it did.
 */
export const ADK_EVENT_KINDS = [
  'session.start',
  'agent.start',
  'agent.end',
  'model.start',
  'model.end',
  'model.error',
  'tool.start',
  'tool.end',
  'tool.error',
  'session.end',
] as const;

export type AdkEventKind = (typeof ADK_EVENT_KINDS)[number];

export const adkWireEventSchema = z
  .object({
    kind: z.enum(ADK_EVENT_KINDS),
    /** Emitter-assigned, strictly increasing per session. Drives the dedupe key. */
    seq: z.int().nonnegative(),
    /** When the framework observed it, ISO-8601 with an explicit offset. */
    at: z.string().min(1),

    invocationId: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
    parentAgent: z.string().min(1).optional(),

    model: z.string().min(1).optional(),
    tool: z.string().min(1).optional(),
    /** Pairs a start with its end. ADK's function-call id where one exists. */
    callId: z.string().min(1).optional(),

    error: z.boolean().optional(),
    errorClass: z.string().min(1).optional(),
    /** Short, operator-safe. Never a completion, never reasoning. */
    summary: z.string().optional(),
    finishReason: z.string().min(1).optional(),

    inputTokens: z.int().nonnegative().optional(),
    outputTokens: z.int().nonnegative().optional(),

    /** Tool arguments/results. Passed through the redaction boundary as-is. */
    args: z.record(z.string(), z.unknown()).optional(),
    result: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type AdkWireEvent = z.infer<typeof adkWireEventSchema>;

export const adkIngestSchema = z
  .object({
    framework: z.string().min(1).default('google-adk'),
    frameworkVersion: z.string().min(1).optional(),
    sessionId: z.string().min(1),
    /** The ADK app name. Becomes the session's display name when present. */
    appName: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    events: z.array(adkWireEventSchema).min(1),
  })
  .strict();

export type AdkIngest = z.infer<typeof adkIngestSchema>;

export function parseAdkIngest(input: unknown) {
  return adkIngestSchema.safeParse(input);
}
