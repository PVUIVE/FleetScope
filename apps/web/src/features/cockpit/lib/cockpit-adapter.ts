import {
  manifestEntryForCaseSequence,
  manifestEntryForRendererIndex,
  fractionForEntryIndex,
  type RenderManifest,
  type RenderManifestEntry,
} from '@fleetscope/scenario-compiler';

/**
 * The JS/TS boundary around the Fleet Cockpit WASM module.
 *
 * WHY THIS FILE EXISTS: nothing else in the frontend may touch raw generated
 * WASM bindings. The generated API changes shape whenever the Rust ABI does;
 * that churn stops here.
 *
 * # The rule this file enforces
 *
 * A cursor position is NEVER computed as `caseSequence / lastCaseSequence`. One
 * Canonical Event compiles to zero renderer entries (`usage.recorded`), one
 * (`tool.requested`), or several (an allowed `gateway.routed`), so the ratio is
 * wrong by an amount nothing measures. Every translation is a Render Manifest
 * lookup, in both directions.
 */

/** The browser ABI `crates/fleet-cockpit-web` exports. */
export interface CockpitAbi {
  /** Load a compiled Case. Replaces whatever is showing. */
  fleetscope_load(main: string, subagentsJson: string, manifestJson: string): void;
  /** Append compiled evidence at the live edge without moving a historical cursor. */
  fleetscope_append(mainTail: string, subagentsJson: string, manifestEntriesJson: string): void;
  /** Seek by renderer fraction. The scrubber's unit, not FleetScope's. */
  fleetscope_seek(fraction: number): void;
  /**
   * Seek to a Canonical Event, resolved through the manifest inside the wasm.
   *
   * A plain `number`, deliberately: the Rust export takes `u32`, because a `u64`
   * would marshal as a BigInt and a plain number call would throw at the call
   * site — failing the seek while the DOM cursor moved anyway.
   */
  fleetscope_seek_case_sequence(caseSequence: number): boolean;
  fleetscope_go_live(): void;
  fleetscope_snapshot(): string;
  /** The manifest entry the renderer cursor rests on, as JSON, or `"null"`. */
  fleetscope_current_event(): string;
  fleetscope_select?(nodeId: string): void;
}

/**
 * What the renderer reports about itself.
 *
 * Renderer units only. `caseSequence` and the canonical unread count are
 * FleetScope's — see `@fleetscope/domain`'s `CaseCursorState`.
 */
export interface CockpitSnapshot {
  readonly rendererEntryIndex: number;
  readonly rendererEntryCount: number;
  readonly atEdge: boolean;
  readonly transport: 'idle' | 'playing' | 'paused' | 'history' | 'live';
  readonly selectedNodeId?: string;
}

export interface CockpitAdapter {
  readonly available: boolean;
  /** Why the Cockpit is unavailable, for honest UI copy. Null when available. */
  readonly unavailableReason: string | null;
  load(main: string, subagentsJson: string, manifestJson: string): void;
  append(mainTail: string, subagentsJson: string, manifestEntriesJson: string): void;
  /** Seek by canonical Case sequence — the authoritative unit. */
  seekToCaseSequence(caseSequence: number): boolean;
  /** Seek by renderer fraction. Only the scrubber should call this. */
  seekToFraction(fraction: number): void;
  goLive(): void;
  snapshot(): CockpitSnapshot | null;
  /** The Canonical Event the renderer cursor rests on. */
  currentEvent(): RenderManifestEntry | null;
  select(nodeId: string): void;
}

const UNAVAILABLE_REASON =
  'The Fleet Cockpit renderer did not load. Recorded evidence is still complete in the evidence rail, the Case Workspace and the Audit view.';

/**
 * A no-op adapter used when the renderer is absent. It never throws: a missing
 * Cockpit must degrade the expert surface, not break the Case Workspace, and it
 * must say so rather than draw a fake graph.
 */
function disabledAdapter(reason: string): CockpitAdapter {
  return {
    available: false,
    unavailableReason: reason,
    load: () => {},
    append: () => {},
    seekToCaseSequence: () => false,
    seekToFraction: () => {},
    goLive: () => {},
    snapshot: () => null,
    currentEvent: () => null,
    select: () => {},
  };
}

export function wrapAbi(abi: CockpitAbi): CockpitAdapter {
  return {
    available: true,
    unavailableReason: null,
    load: (main, subagentsJson, manifestJson) =>
      abi.fleetscope_load(main, subagentsJson, manifestJson),
    append: (mainTail, subagentsJson, manifestEntriesJson) =>
      abi.fleetscope_append(mainTail, subagentsJson, manifestEntriesJson),
    seekToCaseSequence: (caseSequence) => abi.fleetscope_seek_case_sequence(caseSequence),
    seekToFraction: (fraction) => {
      if (!Number.isFinite(fraction)) return;
      abi.fleetscope_seek(Math.min(1, Math.max(0, fraction)));
    },
    goLive: () => abi.fleetscope_go_live(),
    snapshot: () => {
      try {
        return JSON.parse(abi.fleetscope_snapshot()) as CockpitSnapshot;
      } catch {
        return null;
      }
    },
    currentEvent: () => {
      try {
        return JSON.parse(abi.fleetscope_current_event()) as RenderManifestEntry | null;
      } catch {
        return null;
      }
    },
    select: (nodeId) => abi.fleetscope_select?.(nodeId),
  };
}

const REQUIRED_EXPORTS: (keyof CockpitAbi)[] = [
  'fleetscope_load',
  'fleetscope_append',
  'fleetscope_seek',
  'fleetscope_seek_case_sequence',
  'fleetscope_go_live',
  'fleetscope_snapshot',
  'fleetscope_current_event',
];

/**
 * Resolve the Cockpit adapter for the current browser session.
 *
 * The mount script publishes the wasm exports on `globalThis.fleetscopeCockpit`
 * after instantiating the module. An incomplete ABI is reported by name rather
 * than failing at the first call site.
 */
export function createCockpit(scope: typeof globalThis = globalThis): CockpitAdapter {
  const candidate = (scope as { fleetscopeCockpit?: unknown }).fleetscopeCockpit;
  if (candidate === undefined || candidate === null) return disabledAdapter(UNAVAILABLE_REASON);

  const abi = candidate as Partial<CockpitAbi>;
  const missing = REQUIRED_EXPORTS.filter((name) => typeof abi[name] !== 'function');
  if (missing.length > 0) {
    return disabledAdapter(`Cockpit ABI is incomplete; missing: ${missing.join(', ')}`);
  }
  return wrapAbi(abi as CockpitAbi);
}

// ── Manifest translation, for callers that need it outside the wasm ──────────

/**
 * caseSequence → renderer fraction, through the manifest.
 *
 * Used when the shell must position something itself — a DOM scrubber, say —
 * rather than delegating to `fleetscope_seek_case_sequence`. Returns null when
 * the Case rendered nothing at all.
 */
export function rendererFractionFor(manifest: RenderManifest, caseSequence: number): number | null {
  const entry = manifestEntryForCaseSequence(manifest, caseSequence);
  return entry === null
    ? null
    : fractionForEntryIndex(entry.rendererEntryStart, manifest.rendererEntryCount);
}

/** renderer entry index → the Canonical Event that produced it. */
export function canonicalEventFor(
  manifest: RenderManifest,
  rendererEntryIndex: number,
): RenderManifestEntry | null {
  return manifestEntryForRendererIndex(manifest, rendererEntryIndex);
}
