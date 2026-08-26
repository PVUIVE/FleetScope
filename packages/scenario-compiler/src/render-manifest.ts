/**
 * The Render Manifest — the only correct bridge between the canonical Case and
 * the renderer's timeline.
 *
 * # Why this exists
 *
 * It is tempting to position the renderer cursor arithmetically:
 *
 *     fraction = caseSequence / lastCaseSequence          ← WRONG
 *
 * That is only correct if every Canonical Event produces exactly one renderer
 * item, and none does reliably. `usage.recorded` produces none. `tool.requested`
 * produces one. An allowed `gateway.routed` produces several — the route chip,
 * the delegation spawn, and the child agent's birth. The ratio therefore drifts
 * from the truth by however many events happened to compile to a different
 * number of items than one, and the drift is silent.
 *
 * The manifest records what actually happened during compilation, so both
 * directions are lookups rather than estimates:
 *
 *     caseSequence → manifest → renderer entry range → renderer fraction
 *     renderer entry index → manifest → the Canonical Event that produced it
 *
 * # What owns what
 *
 * FleetScope owns `eventCursor`, `caseHighWaterMark`, and therefore the
 * canonical unread count. The renderer owns `rendererEntryIndex` and its own
 * transport. The manifest is the translation table between them; neither side
 * is authoritative for the other's unit.
 */

export const RENDER_MANIFEST_VERSION = '1.0.0';

/** Which platform capability or FleetScope concern a renderer item speaks for. */
export const RENDER_DOMAINS = [
  'case',
  'registry',
  'runtime',
  'memory',
  'identity',
  'gateway',
  'armor',
  'agent',
  'tool',
  'incident',
  'policy',
  'approval',
  'intervention',
  'usage',
] as const;
export type RenderDomain = (typeof RENDER_DOMAINS)[number];

/**
 * The semantic result of the decision behind a renderer item.
 *
 * These are NOT interchangeable and must never collapse into a generic failure.
 * A renderer may draw `denied`, `blocked` and `failed` with the same error
 * styling if it has no richer vocabulary — but the Decision Evidence rail reads
 * from this field, so it says "Identity denied", never "Tool failed".
 */
export const RENDER_OUTCOMES = [
  /** The action completed as requested. */
  'succeeded',
  /** Completed, with content modified by policy. Success, not failure. */
  'sanitized',
  /** Screened and allowed, with a finding recorded. Success, not failure. */
  'flagged',
  /** An authorization or routing policy said no. Not a crash. */
  'denied',
  /** Model Armor refused the content. Not a crash. */
  'blocked',
  /** Genuine execution failure of the thing that was attempted. */
  'failed',
  /** Requested, not yet resolved. */
  'pending',
  /** A recorded fact with no pass/fail character. */
  'informational',
] as const;
export type RenderOutcome = (typeof RENDER_OUTCOMES)[number];

export interface RenderManifestEntry {
  readonly eventId: string;
  readonly caseSequence: number;

  /**
   * Inclusive renderer entry range this Canonical Event produced.
   *
   * When the event produced NOTHING, `rendererEntryEnd === rendererEntryStart - 1`
   * and `rendererEntryCount` is 0. `rendererEntryStart` still names the position
   * the event would have occupied, so a cursor lookup lands somewhere sensible
   * instead of failing.
   */
  readonly rendererEntryStart: number;
  readonly rendererEntryEnd: number;
  readonly rendererEntryCount: number;

  /** Position of this event's first renderer entry over `[0, count-1]`. */
  readonly rendererFraction: number;

  readonly domain: RenderDomain;
  readonly outcome: RenderOutcome;
  /** Operator-safe label. Never model reasoning, never raw vendor content. */
  readonly label: string;

  /** The Canonical Events this item is evidence for. Always includes `eventId`. */
  readonly evidenceEventIds: readonly string[];
}

export interface RenderManifest {
  readonly manifestVersion: string;
  readonly caseId: string;
  /** Which RendererAdapter produced the artifact this manifest describes. */
  readonly adapterId: string;
  /** Total renderer timeline entries. The denominator for every fraction. */
  readonly rendererEntryCount: number;
  readonly firstCaseSequence: number;
  readonly lastCaseSequence: number;
  readonly entries: readonly RenderManifestEntry[];
}

/** Fraction of a renderer index over a timeline of `count` entries. */
export function fractionForEntryIndex(entryIndex: number, count: number): number {
  if (count <= 1) return 0;
  const clamped = Math.min(Math.max(entryIndex, 0), count - 1);
  return clamped / (count - 1);
}

/**
 * caseSequence → renderer fraction.
 *
 * Exact hit wins. Otherwise the nearest event AT OR BEFORE the target is used,
 * because a cursor parked on an event that produced nothing visible belongs at
 * the last thing that WAS visible — moving it forward would show the operator
 * evidence they have not yet reached. Falls back to the first entry that
 * produced anything when the target precedes the whole Case.
 */
export function rendererFractionForCaseSequence(
  manifest: RenderManifest,
  caseSequence: number,
): number | null {
  const entry = manifestEntryForCaseSequence(manifest, caseSequence);
  // Computed from the CURRENT total rather than read off the entry: appending to
  // a live Case grows the denominator, so the compile-time fraction goes stale
  // the moment the Case does.
  return entry === null
    ? null
    : fractionForEntryIndex(entry.rendererEntryStart, manifest.rendererEntryCount);
}

export function manifestEntryForCaseSequence(
  manifest: RenderManifest,
  caseSequence: number,
): RenderManifestEntry | null {
  let best: RenderManifestEntry | null = null;
  for (const entry of manifest.entries) {
    if (entry.rendererEntryCount === 0) continue;
    if (entry.caseSequence > caseSequence) break;
    best = entry;
  }
  if (best !== null) return best;
  return manifest.entries.find((e) => e.rendererEntryCount > 0) ?? null;
}

/**
 * renderer entry index → the Canonical Event that produced it.
 *
 * The reverse direction, used when the operator scrubs the Cockpit and the
 * FleetScope Event Cursor has to follow.
 */
export function manifestEntryForRendererIndex(
  manifest: RenderManifest,
  rendererEntryIndex: number,
): RenderManifestEntry | null {
  let best: RenderManifestEntry | null = null;
  for (const entry of manifest.entries) {
    if (entry.rendererEntryCount === 0) continue;
    if (entry.rendererEntryStart > rendererEntryIndex) break;
    best = entry;
  }
  return best;
}

/**
 * Structural checks a per-entry shape cannot express. An empty array means the
 * manifest is internally consistent; anything else is a compiler bug.
 */
export function validateRenderManifest(manifest: RenderManifest): string[] {
  const problems: string[] = [];
  let expectedNextStart = 0;
  let previousCaseSequence = -1;

  for (const [index, entry] of manifest.entries.entries()) {
    const at = `entry[${index}] ${entry.eventId}`;

    if (entry.caseSequence <= previousCaseSequence) {
      problems.push(`${at}: caseSequence ${entry.caseSequence} does not increase`);
    }
    previousCaseSequence = entry.caseSequence;

    const count = entry.rendererEntryEnd - entry.rendererEntryStart + 1;
    if (count !== entry.rendererEntryCount) {
      problems.push(
        `${at}: rendererEntryCount ${entry.rendererEntryCount} disagrees with its range`,
      );
    }
    if (count < 0) problems.push(`${at}: renderer range is inverted by more than one`);

    if (entry.rendererEntryStart !== expectedNextStart) {
      problems.push(
        `${at}: rendererEntryStart ${entry.rendererEntryStart} leaves a hole after ${expectedNextStart}`,
      );
    }
    expectedNextStart = entry.rendererEntryStart + count;

    if (!entry.evidenceEventIds.includes(entry.eventId)) {
      problems.push(`${at}: evidenceEventIds does not include its own eventId`);
    }

    const computed = fractionForEntryIndex(entry.rendererEntryStart, manifest.rendererEntryCount);
    if (Math.abs(entry.rendererFraction - computed) > 1e-9) {
      problems.push(
        `${at}: stored rendererFraction ${entry.rendererFraction} disagrees with the computed ${computed}`,
      );
    }
  }

  if (expectedNextStart !== manifest.rendererEntryCount) {
    problems.push(
      `manifest: entries account for ${expectedNextStart} renderer items but rendererEntryCount is ${manifest.rendererEntryCount}`,
    );
  }

  return problems;
}
