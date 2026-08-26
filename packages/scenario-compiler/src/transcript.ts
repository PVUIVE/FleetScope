/**
 * The Cockpit transcript shape.
 *
 * ⚠ UNRESOLVED BOUNDARY — see docs/decisions/0002-cockpit-renderer-boundary.md.
 *
 * The Fleet Cockpit is planned to reuse a pinned MIT-licensed Rust/WASM
 * visualization core whose transcript format is Claude-conversation-shaped. That
 * upstream is NOT yet vendored and its exact schema is therefore not yet known.
 *
 * What is defined below is FleetScope's own interim, renderer-neutral transcript
 * — deliberately narrow, covering only what every graph/timeline renderer needs:
 * nodes, parentage, ordered work items, and pending/result pairing.
 *
 * NO FIELD HERE IS INVENTED ON THE UPSTREAM'S BEHALF. When the fork lands,
 * implement `RendererAdapter` against its real schema; the canonical FleetScope
 * domain model must not be reshaped to suit a renderer.
 */

export interface TranscriptAgentNode {
  readonly id: string;
  readonly role: string;
  readonly label: string;
  readonly parentId: string | null;
  /** Index into the transcript entries where this node first appears. */
  readonly firstEntryIndex: number;
}

/**
 * One renderable step. `pending`/`result` pairing is expressed with a shared
 * `callId` rather than nesting, because the upstream projector is documented as
 * requiring stable pending/result pairs to stay deterministic.
 */
export interface TranscriptEntry {
  readonly index: number;
  readonly agentId: string;
  readonly kind: 'spawn' | 'message' | 'tool_pending' | 'tool_result' | 'status';
  readonly label: string;
  readonly timestamp: string;
  readonly callId?: string;
  readonly toolName?: string;
  readonly isError?: boolean;
  /** Back-reference into FleetScope canonical evidence. Never dropped. */
  readonly fleetscope: {
    readonly eventId: string;
    readonly caseSequence: number;
    readonly sessionId: string | null;
    readonly eventType: string;
  };
}

export interface CockpitTranscript {
  readonly transcriptVersion: string;
  readonly caseId: string;
  readonly agents: readonly TranscriptAgentNode[];
  readonly entries: readonly TranscriptEntry[];
}

export const TRANSCRIPT_VERSION = 'fleetscope-interim-1';

export function serializeTranscriptJsonl(transcript: CockpitTranscript): string {
  const header = JSON.stringify({
    type: 'header',
    transcriptVersion: transcript.transcriptVersion,
    caseId: transcript.caseId,
    agents: transcript.agents,
  });
  const lines = transcript.entries.map((entry) => JSON.stringify({ type: 'entry', ...entry }));
  return [header, ...lines].join('\n') + '\n';
}
