import {
  CURRENT_SCHEMA_VERSION,
  parseSourceEvent,
  validateCanonicalStream,
  type CanonicalEvent,
  type SourceEvent,
} from '@fleetscope/event-schema';
import { canonicalJson, sha256Hex } from '@fleetscope/shared';
import { DEFAULT_REDACTION_POLICY, redactPayload, type RedactionPolicy } from './redaction.js';

/**
 * The Canonicalizer.
 *
 * Source Events are untrusted, unordered, and may be delivered more than once.
 * Canonical Events are none of those things. Everything that turns the first
 * into the second happens here, in this order:
 *
 *   schema validation
 *        ↓
 *   sensitive-field classification
 *        ↓
 *   REDACTION / DIGEST        ← the primary boundary; nothing downstream re-does it
 *        ↓
 *   deduplication (by dedupeKey)
 *        ↓
 *   deterministic total ordering
 *        ↓
 *   caseSequence / sessionSequence assignment
 *        ↓
 *   Canonical Event
 *
 * PURITY. This module reads no clock, no environment, no filesystem and no
 * network. Arrival order is not an input to the result: the same SET of Source
 * Events produces byte-identical Canonical Events whatever order they arrive in.
 * That is what makes replay reproducible rather than merely repeatable.
 */

export const CANONICALIZER_VERSION = '1.0.0';

export interface CanonicalizeOptions {
  readonly policy?: RedactionPolicy;
  /**
   * When FleetScope accepted the event into the canonical order.
   *
   * Defaults to the Source Event's own `sourceTime` so the pipeline stays pure.
   * A live ingest passes the real receipt time explicitly — it must be recorded
   * on the Source Event by whoever received it, never read from a clock here.
   */
  readonly acceptedTimeFor?: (event: SourceEvent) => string;
  /** Ingestion timestamp, when the receiving edge recorded one. */
  readonly ingestionTimeFor?: (event: SourceEvent) => string | undefined;
  /**
   * Override the derived Canonical Event id.
   *
   * Exists for RECORDED fixtures, which carry blessed ids that other artifacts
   * — expected-state hashes, evidence manifests, the render manifest — already
   * reference. Live ingest never passes this: `deriveEventId` is the rule, and a
   * fixture pinning its own ids is the documented exception.
   */
  readonly eventIdFor?: (event: SourceEvent) => string;
}

export type RejectionReason =
  | 'schema_invalid'
  | 'wrong_case'
  | 'duplicate_key_conflicting_payload'
  /** Appending only: the event predates evidence that already has a sequence. */
  | 'late_arrival_before_high_water';

export interface Rejection {
  readonly dedupeKey: string;
  readonly reason: RejectionReason;
  readonly detail: string;
}

export interface CanonicalizeResult {
  readonly caseId: string;
  readonly accepted: readonly CanonicalEvent[];
  /** dedupeKeys seen more than once and collapsed. Idempotent redelivery. */
  readonly duplicatesCollapsed: readonly string[];
  readonly rejected: readonly Rejection[];
  /** Problems from the structural stream check. Empty for a well-formed result. */
  readonly streamProblems: readonly string[];
  /**
   * Identifies the exact canonical byte sequence this projection ran against.
   * Recomputed from the accepted events, so a changed fixture changes it.
   */
  readonly streamRevision: string;
  readonly redactionPolicyVersion: string;
  readonly redactionCount: number;
}

/**
 * Deterministic Canonical Event id.
 *
 * Derived from (caseId, dedupeKey) alone — never from arrival index — so the
 * same logical fact carries the same id no matter when or how often it arrives.
 */
export function deriveEventId(caseId: string, dedupeKey: string): string {
  return `evt-${sha256Hex(canonicalJson({ caseId, dedupeKey })).slice(0, 16)}`;
}

/**
 * The canonical total order.
 *
 * `sourceTime` first because it is what the owning system asserts happened;
 * `dedupeKey` breaks ties, and it is unique per logical fact, so the comparator
 * is total. Neither input depends on arrival, which is the whole point.
 */
function compareSourceEvents(a: SourceEvent, b: SourceEvent): number {
  const timeA = Date.parse(a.sourceTime);
  const timeB = Date.parse(b.sourceTime);
  if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) return timeA - timeB;
  if (a.sourceTime !== b.sourceTime) return a.sourceTime < b.sourceTime ? -1 : 1;
  return a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0;
}

export function canonicalize(
  inputs: readonly unknown[],
  caseId: string,
  options: CanonicalizeOptions = {},
): CanonicalizeResult {
  const policy = options.policy ?? DEFAULT_REDACTION_POLICY;
  const acceptedTimeFor = options.acceptedTimeFor ?? ((event: SourceEvent) => event.sourceTime);
  // Defaults to whatever the emitter recorded. The Canonicalizer itself reads no
  // clock — an ingest time is a fact the receiving edge observed and passed in.
  const ingestionTimeFor =
    options.ingestionTimeFor ?? ((event: SourceEvent) => event.ingestionTime);
  const eventIdFor =
    options.eventIdFor ?? ((event: SourceEvent) => deriveEventId(caseId, event.dedupeKey));

  const rejected: Rejection[] = [];
  const duplicatesCollapsed: string[] = [];

  // ── 1. Schema validation ────────────────────────────────────────────────
  const valid: SourceEvent[] = [];
  for (const [index, input] of inputs.entries()) {
    const parsed = parseSourceEvent(input);
    if (!parsed.success) {
      const key =
        typeof (input as { dedupeKey?: unknown } | null)?.dedupeKey === 'string'
          ? (input as { dedupeKey: string }).dedupeKey
          : `<input[${index}]>`;
      rejected.push({
        dedupeKey: key,
        reason: 'schema_invalid',
        detail: parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          .join('; '),
      });
      continue;
    }
    if (parsed.data.caseId !== caseId) {
      rejected.push({
        dedupeKey: parsed.data.dedupeKey,
        reason: 'wrong_case',
        detail: `event belongs to ${parsed.data.caseId}, not ${caseId}`,
      });
      continue;
    }
    valid.push(parsed.data);
  }

  // ── 2. Deduplication ────────────────────────────────────────────────────
  //
  // Redelivery of the same logical fact is idempotent, so the FIRST occurrence
  // in canonical order wins — not the first to arrive, which would make the
  // result order-dependent. A redelivery whose payload DIFFERS is a real
  // conflict: the winner is still deterministic, but the disagreement is
  // recorded rather than silently discarded.
  const ordered = [...valid].sort(compareSourceEvents);
  const byKey = new Map<string, SourceEvent>();
  for (const event of ordered) {
    const existing = byKey.get(event.dedupeKey);
    if (existing === undefined) {
      byKey.set(event.dedupeKey, event);
      continue;
    }
    duplicatesCollapsed.push(event.dedupeKey);
    if (canonicalJson(existing) !== canonicalJson(event)) {
      rejected.push({
        dedupeKey: event.dedupeKey,
        reason: 'duplicate_key_conflicting_payload',
        detail: 'redelivery carried a different payload; the canonical-order first wins',
      });
    }
  }

  // ── 3. Redaction, then sequence assignment ──────────────────────────────
  const deduped = [...byKey.values()].sort(compareSourceEvents);
  const sessionCursors = new Map<string, number>();
  const accepted: CanonicalEvent[] = [];
  let redactionCount = 0;

  for (const [index, source] of deduped.entries()) {
    const redaction = redactPayload(source.payload, policy);
    redactionCount += redaction.redactions.length;

    let sessionSequence: number | null = null;
    if (source.sessionId !== null) {
      const next = (sessionCursors.get(source.sessionId) ?? -1) + 1;
      sessionCursors.set(source.sessionId, next);
      sessionSequence = next;
    }

    const ingestionTime = ingestionTimeFor(source);

    accepted.push({
      eventId: eventIdFor(source),
      caseId,
      caseSequence: index,
      sessionId: source.sessionId,
      sessionSequence,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      type: source.type,
      sourceTime: source.sourceTime,
      ...(ingestionTime !== undefined ? { ingestionTime } : {}),
      acceptedTime: acceptedTimeFor(source),
      actor: source.actor,
      correlations: source.correlations,
      payloadRedacted: redaction.payloadRedacted,
      // The digest exists to correlate a REDACTED payload with the original that
      // can no longer be shown. A payload with nothing redacted is already
      // published in full, so a digest of it discloses nothing and proves
      // nothing that the payload does not — it is omitted rather than carried as
      // noise on every event.
      ...(redaction.redactions.length > 0 ? { payloadDigest: redaction.payloadDigest } : {}),
    });
  }

  return {
    caseId,
    accepted,
    duplicatesCollapsed: duplicatesCollapsed.sort(),
    rejected,
    streamProblems: validateCanonicalStream(accepted),
    streamRevision: streamRevisionOf(accepted),
    redactionPolicyVersion: policy.policyVersion,
    redactionCount,
  };
}

/**
 * The stream revision: sha256 over the canonically serialized accepted events.
 *
 * Two FleetScope deployments that report the same stream revision are looking at
 * the same evidence, byte for byte. It is one of the three inputs the replay
 * claim names (stream revision, event prefix, projector version).
 */
export function streamRevisionOf(events: readonly CanonicalEvent[]): string {
  return `sha256:${sha256Hex(canonicalJson(events))}`;
}

export interface AppendResult {
  /** Only the newly accepted events, in canonical order. */
  readonly appended: readonly CanonicalEvent[];
  /** The existing stream plus the appended events. */
  readonly stream: readonly CanonicalEvent[];
  readonly duplicatesCollapsed: readonly string[];
  readonly rejected: readonly Rejection[];
  readonly streamProblems: readonly string[];
  readonly streamRevision: string;
}

/**
 * Canonicalize new Source Events onto an EXISTING canonical stream.
 *
 * Appending is not the same operation as canonicalizing from scratch, and
 * conflating them would be a correctness bug: a fresh `canonicalize` reassigns
 * every `caseSequence` from zero, which would renumber evidence that has already
 * been projected, hashed, referenced by a Render Manifest and shown to an
 * operator. Sequences already issued are facts; this function continues them.
 *
 * A late event — one whose `sourceTime` precedes the stream's high-water mark —
 * is REJECTED rather than inserted. Inserting it would require renumbering
 * everything after it, invalidating every downstream artifact. Recording the
 * refusal is honest; silently reordering settled evidence is not.
 */
export function canonicalizeAppend(
  existing: readonly CanonicalEvent[],
  inputs: readonly unknown[],
  caseId: string,
  options: CanonicalizeOptions = {},
): AppendResult {
  const ordered = [...existing].sort((a, b) => a.caseSequence - b.caseSequence);
  const highWaterSequence = ordered.at(-1)?.caseSequence ?? -1;
  const highWaterSourceTime = ordered.reduce(
    (latest, event) => (event.sourceTime > latest ? event.sourceTime : latest),
    '',
  );
  const knownEventIds = new Set(ordered.map((event) => event.eventId));
  const sessionCursors = new Map<string, number>();
  for (const event of ordered) {
    if (event.sessionId !== null && event.sessionSequence !== null) {
      sessionCursors.set(
        event.sessionId,
        Math.max(sessionCursors.get(event.sessionId) ?? -1, event.sessionSequence),
      );
    }
  }

  // Reuse the whole validate → redact → order pipeline, then re-stamp the
  // sequences so a fresh run and an append cannot diverge in their handling of
  // schema, redaction, dedupe or ordering.
  const fresh = canonicalize(inputs, caseId, options);

  const rejected: Rejection[] = [...fresh.rejected];
  const appended: CanonicalEvent[] = [];
  let nextSequence = highWaterSequence + 1;

  for (const candidate of fresh.accepted) {
    if (knownEventIds.has(candidate.eventId)) {
      // Already in the stream. Redelivery is idempotent, not an error.
      continue;
    }
    if (highWaterSourceTime !== '' && candidate.sourceTime < highWaterSourceTime) {
      rejected.push({
        dedupeKey: candidate.eventId,
        reason: 'late_arrival_before_high_water',
        detail: `sourceTime ${candidate.sourceTime} precedes the stream high-water mark ${highWaterSourceTime}; accepting it would renumber settled evidence`,
      });
      continue;
    }

    let sessionSequence: number | null = null;
    if (candidate.sessionId !== null) {
      sessionSequence = (sessionCursors.get(candidate.sessionId) ?? -1) + 1;
      sessionCursors.set(candidate.sessionId, sessionSequence);
    }

    appended.push({ ...candidate, caseSequence: nextSequence, sessionSequence });
    nextSequence += 1;
  }

  const stream = [...ordered, ...appended];
  return {
    appended,
    stream,
    duplicatesCollapsed: fresh.duplicatesCollapsed,
    rejected,
    streamProblems: validateCanonicalStream(stream),
    streamRevision: streamRevisionOf(stream),
  };
}
