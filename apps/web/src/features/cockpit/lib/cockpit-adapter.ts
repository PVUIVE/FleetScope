/**
 * The JS/TS boundary around the Fleet Cockpit WASM module.
 *
 * WHY THIS FILE EXISTS: nothing else in the frontend may touch raw generated
 * WASM bindings. When the pinned Rust/WASM core is vendored, its generated API
 * will change shape at least once; that churn must stop here.
 *
 * ⚠ The WASM module is NOT yet built or vendored — see
 * docs/decisions/0002-cockpit-renderer-boundary.md. `createCockpit` therefore
 * returns a DISABLED adapter that reports its unavailability honestly rather
 * than simulating a renderer. Callers must handle `available === false`.
 */

/**
 * The browser ABI FleetScope expects the Cockpit to expose. Names mirror
 * docs/design/budget-demo.md ("Minimal WASM changes"). If the vendored renderer
 * already has a better equivalent, adapt to it HERE — do not add speculative
 * exports to the Rust crate.
 */
export interface CockpitAbi {
  /** Load a compiled transcript. Replaces any currently loaded Case. */
  fleetscope_load(transcriptJsonl: string): void;
  /** Append one entry at the live edge without disturbing a historical cursor. */
  fleetscope_append(entryJson: string): void;
  /** Seek historically. 0 = first event, 1 = live edge. */
  fleetscope_seek(fraction: number): void;
  /** Return to the live edge. */
  fleetscope_go_live(): void;
  /** Current cursor/transport/selection summary as JSON. */
  fleetscope_snapshot(): string;
  /** Optional; only if the renderer supports reliable node selection. */
  fleetscope_select?(nodeId: string): void;
}

export interface CockpitSnapshot {
  readonly caseSequence: number;
  readonly atEdge: boolean;
  readonly selectedNodeId: string | null;
}

export interface CockpitAdapter {
  readonly available: boolean;
  /** Why the Cockpit is unavailable, for honest UI copy. Null when available. */
  readonly unavailableReason: string | null;
  load(transcriptJsonl: string): void;
  append(entryJson: string): void;
  /**
   * Seek by canonical Case sequence — the authoritative unit. The fraction the
   * ABI takes is derived here so no caller has to know about it.
   */
  seekToCaseSequence(caseSequence: number, lastCaseSequence: number): void;
  goLive(): void;
  snapshot(): CockpitSnapshot | null;
  select(nodeId: string): void;
}

const UNAVAILABLE_REASON =
  'The Fleet Cockpit WASM module is not vendored yet. Recorded evidence renders in the DOM surfaces meanwhile.';

/**
 * A no-op adapter used until the renderer exists. It never throws — a missing
 * Cockpit must degrade the expert surface, not break the Case Workspace.
 */
function disabledAdapter(reason: string): CockpitAdapter {
  return {
    available: false,
    unavailableReason: reason,
    load: () => {},
    append: () => {},
    seekToCaseSequence: () => {},
    goLive: () => {},
    snapshot: () => null,
    select: () => {},
  };
}

export function wrapAbi(abi: CockpitAbi): CockpitAdapter {
  return {
    available: true,
    unavailableReason: null,
    load: (transcript) => abi.fleetscope_load(transcript),
    append: (entry) => abi.fleetscope_append(entry),
    seekToCaseSequence: (caseSequence, lastCaseSequence) => {
      // Guard against a zero-length Case producing a division by zero.
      const fraction = lastCaseSequence <= 0 ? 0 : caseSequence / lastCaseSequence;
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
    select: (nodeId) => abi.fleetscope_select?.(nodeId),
  };
}

/**
 * Resolve the Cockpit adapter for the current browser session.
 *
 * Looks for the ABI on `globalThis` (where a trunk/wasm-bindgen build publishes
 * it) and returns a disabled adapter when it is absent.
 */
export function createCockpit(scope: typeof globalThis = globalThis): CockpitAdapter {
  const candidate = (scope as { fleetscopeCockpit?: unknown }).fleetscopeCockpit;
  if (candidate === undefined || candidate === null) return disabledAdapter(UNAVAILABLE_REASON);

  const abi = candidate as Partial<CockpitAbi>;
  const required: (keyof CockpitAbi)[] = [
    'fleetscope_load',
    'fleetscope_append',
    'fleetscope_seek',
    'fleetscope_go_live',
    'fleetscope_snapshot',
  ];
  const missing = required.filter((name) => typeof abi[name] !== 'function');
  if (missing.length > 0) {
    return disabledAdapter(`Cockpit ABI is incomplete; missing: ${missing.join(', ')}`);
  }

  return wrapAbi(abi as CockpitAbi);
}
