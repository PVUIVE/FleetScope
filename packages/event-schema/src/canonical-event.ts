import { z } from 'zod';
import { EVENT_TYPES } from './event-types.js';

/**
 * The Canonical Event envelope.
 *
 * A Canonical Event is immutable, schema-versioned, and the ONLY input to
 * deterministic projection. It is distinct from a Source Event: Source Events
 * may arrive late, duplicated, or out of order and carry no replay authority.
 *
 * Zod is the single source of truth here. `schemas/canonical-event.schema.json`
 * is GENERATED from it (`pnpm schema:emit`) and must never be hand-edited.
 */

export const CURRENT_SCHEMA_VERSION = '1.0.0';

const instant = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
    'must be an ISO-8601 instant with an explicit offset',
  );

export const actorRefSchema = z.object({
  kind: z.enum(['agent', 'user', 'service']),
  id: z.string().min(1),
  agentVersionRef: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
});

/**
 * Correlation keys are an open map because platform services differ in what
 * they can supply, but every value must be a plain string so the whole envelope
 * stays canonically serializable.
 */
export const correlationsSchema = z.record(z.string().min(1), z.string());

export const canonicalEventSchema = z
  .object({
    eventId: z.string().min(1),

    // ── Case correlation (Invariant 1: the Case is the root) ──
    caseId: z.string().min(1),
    caseSequence: z.int().nonnegative(),

    // ── Session correlation. A Case spans several Sessions. ──
    sessionId: z.string().min(1).nullable(),
    sessionSequence: z.int().nonnegative().nullable(),

    schemaVersion: z.string().min(1),
    type: z.enum(EVENT_TYPES),

    /** When the owning system says it happened. */
    sourceTime: instant,
    /** When FleetScope received it. Absent for compiled fixtures. */
    ingestionTime: instant.optional(),
    /** When it entered the canonical total order. This drives replay. */
    acceptedTime: instant,

    actor: actorRefSchema,
    correlations: correlationsSchema,

    /** Payloads are redacted BEFORE persistence. Raw secrets never land here. */
    payloadRedacted: z.record(z.string(), z.unknown()),
    /** Digest of the pre-redaction payload, for correlation without disclosure. */
    payloadDigest: z.string().optional(),
  })
  .strict()
  .superRefine((event, ctx) => {
    // Case-level events (case.created, milestone changes) legitimately have no
    // Session; everything else must be anchored to one. The two nullable fields
    // must agree — a sequence without a Session is meaningless.
    const hasSession = event.sessionId !== null;
    const hasSequence = event.sessionSequence !== null;
    if (hasSession !== hasSequence) {
      ctx.addIssue({
        code: 'custom',
        message: 'sessionId and sessionSequence must both be present or both be null',
        path: ['sessionSequence'],
      });
    }
  });

export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;

export function parseCanonicalEvent(input: unknown) {
  return canonicalEventSchema.safeParse(input);
}

/**
 * Structural checks that a per-event schema cannot express.
 * Returns human-readable problems; an empty array means the stream is well-formed.
 */
export function validateCanonicalStream(events: readonly CanonicalEvent[]): string[] {
  const problems: string[] = [];
  const seenEventIds = new Set<string>();
  const sessionCursors = new Map<string, number>();
  let previousCaseSequence = -1;

  for (const [index, event] of events.entries()) {
    const at = `event[${index}] ${event.eventId}`;

    if (seenEventIds.has(event.eventId)) {
      problems.push(`${at}: duplicate eventId`);
    }
    seenEventIds.add(event.eventId);

    if (event.caseSequence <= previousCaseSequence) {
      problems.push(
        `${at}: caseSequence ${event.caseSequence} is not strictly greater than ${previousCaseSequence}`,
      );
    }
    previousCaseSequence = Math.max(previousCaseSequence, event.caseSequence);

    if (event.sessionId !== null && event.sessionSequence !== null) {
      const previous = sessionCursors.get(event.sessionId) ?? -1;
      if (event.sessionSequence <= previous) {
        problems.push(
          `${at}: sessionSequence ${event.sessionSequence} is not strictly greater than ${previous} for ${event.sessionId}`,
        );
      }
      sessionCursors.set(event.sessionId, Math.max(previous, event.sessionSequence));
    }

    if (event.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      problems.push(`${at}: unsupported schemaVersion ${event.schemaVersion}`);
    }
  }

  const caseIds = new Set(events.map((e) => e.caseId));
  if (caseIds.size > 1) {
    problems.push(`stream mixes several Cases: ${[...caseIds].sort().join(', ')}`);
  }

  return problems;
}
