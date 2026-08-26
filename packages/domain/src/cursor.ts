import type { CaseId, EventId } from './ids.js';

/**
 * The FleetScope Event Cursor — and who owns what.
 *
 * FleetScope owns the cursor, the Case high-water mark, and therefore the
 * canonical unread count. The renderer owns its own entry index and transport.
 * They are different units and the Render Manifest translates between them.
 *
 * It is tempting to let the renderer answer "how many new events?" — it has a
 * timeline and it knows how much of it is unfolded. That number is wrong. One
 * Canonical Event may compile to zero renderer entries or to several, so a
 * renderer-side count is neither the number of events nor a fixed multiple of
 * it. Worse, it would make a rendering decision authoritative over the audit
 * spine: change how a `gateway.routed` draws and the operator's "+3 new events"
 * badge changes with it, having observed nothing new.
 *
 * So: `canonicalUnread` is derived here, from accepted Canonical Events after
 * the cursor, and nowhere else.
 *
 * # No side effects
 *
 * Moving the cursor changes only what is projected. It executes no tool, calls
 * no model, and never mutates evidence. Everything in this module is a pure
 * function of its arguments.
 */
export interface CaseCursorState {
  readonly caseId: CaseId;
  /** The selected position. Held fixed while the operator inspects history. */
  readonly eventCursor: number;
  /** The highest accepted caseSequence FleetScope has. */
  readonly caseHighWaterMark: number;
  /** True when the cursor is following the high-water mark. */
  readonly atEdge: boolean;
  /** Accepted Canonical Events after the cursor. Zero while at the edge. */
  readonly canonicalUnread: number;
}

export function createCaseCursor(
  caseId: CaseId,
  caseSequences: readonly number[],
): CaseCursorState {
  const highWater = caseSequences.length === 0 ? -1 : Math.max(...caseSequences);
  return {
    caseId,
    eventCursor: highWater,
    caseHighWaterMark: highWater,
    atEdge: true,
    canonicalUnread: 0,
  };
}

/**
 * Count accepted events strictly after the cursor.
 *
 * Takes the actual sequence list rather than subtracting two numbers: a Case
 * whose sequences are dense today may not be tomorrow, and an arithmetic
 * difference would quietly start over-reporting.
 */
export function canonicalUnreadFor(caseSequences: readonly number[], eventCursor: number): number {
  return caseSequences.reduce((count, sequence) => (sequence > eventCursor ? count + 1 : count), 0);
}

/**
 * Park the cursor on a specific Canonical Event. Any move off the high-water
 * mark leaves live mode and starts accruing unread.
 */
export function seekCursor(
  state: CaseCursorState,
  caseSequences: readonly number[],
  caseSequence: number,
): CaseCursorState {
  const atEdge = caseSequence >= state.caseHighWaterMark;
  return {
    ...state,
    eventCursor: caseSequence,
    atEdge,
    canonicalUnread: atEdge ? 0 : canonicalUnreadFor(caseSequences, caseSequence),
  };
}

/**
 * Accept newly canonicalized events.
 *
 * While the cursor is historical its position is deliberately untouched — new
 * evidence must never yank an investigator's view forward. The high-water mark
 * and the unread count move instead.
 */
export function acceptEvents(
  state: CaseCursorState,
  caseSequences: readonly number[],
): CaseCursorState {
  const highWater =
    caseSequences.length === 0 ? state.caseHighWaterMark : Math.max(...caseSequences);
  if (state.atEdge) {
    return { ...state, eventCursor: highWater, caseHighWaterMark: highWater, canonicalUnread: 0 };
  }
  return {
    ...state,
    caseHighWaterMark: highWater,
    canonicalUnread: canonicalUnreadFor(caseSequences, state.eventCursor),
  };
}

/**
 * Return to the live edge.
 *
 * The caller must have projected every accepted event first. Ordering matters:
 * moving the cursor before the projection catches up would show an edge that
 * omits accepted evidence, which is exactly the "skipped event" failure the
 * replay guarantee forbids.
 */
export function returnToLive(
  state: CaseCursorState,
  caseSequences: readonly number[],
): CaseCursorState {
  const highWater =
    caseSequences.length === 0 ? state.caseHighWaterMark : Math.max(...caseSequences);
  return {
    ...state,
    eventCursor: highWater,
    caseHighWaterMark: highWater,
    atEdge: true,
    canonicalUnread: 0,
  };
}

/** How the cursor should be labelled. Historical evidence must never read live. */
export type CursorMode = 'live' | 'historical';

export const cursorMode = (state: CaseCursorState): CursorMode =>
  state.atEdge ? 'live' : 'historical';

/**
 * The replay disclosure shown wherever historical evidence is displayed.
 *
 * These four values are the entire reconstruction claim: given the same stream
 * revision, event prefix and projector version, FleetScope rebuilds the same
 * Observable Case State — and the state hash is how you check. Nothing here
 * claims to reconstruct hidden reasoning, unrecorded external reality, or a tool
 * side effect.
 */
export interface ReplayDisclosure {
  readonly streamRevision: string;
  readonly projectorVersion: string;
  readonly eventCursor: number;
  readonly stateHash: string;
  readonly cursorEventId: EventId | null;
}
