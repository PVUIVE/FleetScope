import type { RenderManifestEntry, ZoetropeScene } from '@fleetscope/scenario-compiler';

/**
 * What changed between two compiles of the same growing session.
 *
 * The Scenario Compiler is deterministic and append-only in its emission: given
 * a canonical stream, the renderer lines it produces for the first N events are
 * byte-identical whether it was handed N events or N+5. So the correct way to
 * grow a live scene is to recompile the whole stream and take the SUFFIX —
 * which is exactly what this computes.
 *
 * The alternative (an incremental compiler that keeps its own state across
 * calls) would be a second implementation of the emission rules, free to drift
 * from the one the tests cover. This has one implementation and a subtraction.
 */
export interface SceneDelta {
  readonly mainTail: string;
  readonly subagents: readonly { agentId: string; meta: string; transcript: string }[];
  readonly entries: readonly RenderManifestEntry[];
  readonly isEmpty: boolean;
}

const lines = (text: string): string[] => text.split('\n').filter((line) => line.trim() !== '');

export function sceneDelta(previous: ZoetropeScene | null, next: ZoetropeScene): SceneDelta {
  if (previous === null) {
    return {
      mainTail: next.main,
      subagents: [...next.subagents],
      entries: [...next.manifest.entries],
      isEmpty: next.manifest.rendererEntryCount === 0,
    };
  }

  const beforeMain = lines(previous.main).length;
  const mainTail = lines(next.main).slice(beforeMain).join('\n');

  const previousSubagents = new Map(previous.subagents.map((sub) => [sub.agentId, sub]));
  const subagents: { agentId: string; meta: string; transcript: string }[] = [];
  for (const sub of next.subagents) {
    const before = previousSubagents.get(sub.agentId);
    const transcript = lines(sub.transcript)
      .slice(before === undefined ? 0 : lines(before.transcript).length)
      .join('\n');
    // A meta is sent ONCE, with the agent's first lines. Re-sending it would
    // register the same subagent twice in the renderer's timeline.
    const meta = before === undefined ? sub.meta : '';
    if (transcript === '' && meta === '') continue;
    subagents.push({ agentId: sub.agentId, meta, transcript });
  }

  const entries = next.manifest.entries.slice(previous.manifest.entries.length);

  return {
    mainTail,
    subagents,
    entries: [...entries],
    isEmpty: mainTail === '' && subagents.length === 0 && entries.length === 0,
  };
}
