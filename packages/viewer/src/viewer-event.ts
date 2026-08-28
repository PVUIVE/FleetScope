/**
 * The developer-facing event vocabulary.
 *
 * FleetScope's canonical set has 46 types because it must describe a governed
 * enterprise fleet. A developer watching one local run needs eleven. This module
 * is the Viewer Projection: canonical evidence in, a small stable vocabulary out.
 *
 * It is a projection, not a replacement. The canonical stream stays
 * authoritative, keeps its sequences, and remains what the renderer, the audit
 * export and the replay guarantee are computed from. Nothing here writes.
 */
export const VIEWER_EVENT_TYPES = [
  'session.started',
  'session.completed',
  'agent.started',
  'agent.completed',
  'model.started',
  'model.completed',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'agent.handoff',
  'error',
] as const;

export type ViewerEventType = (typeof VIEWER_EVENT_TYPES)[number];

export type ViewerStatus = 'running' | 'completed' | 'failed';

/** The visual/filter category a timeline row belongs to. */
export type ViewerCategory = 'session' | 'agent' | 'model' | 'tool' | 'handoff' | 'error';

export interface ViewerEvent {
  readonly id: string;
  readonly sessionId: string;
  /** The canonical `caseSequence`. The unit every seek and cursor uses. */
  readonly sequence: number;
  readonly timestamp: string;

  readonly type: ViewerEventType;
  readonly category: ViewerCategory;

  readonly agentId: string | null;
  readonly parentAgentId: string | null;

  readonly label: string;
  readonly status: ViewerStatus | null;

  /**
   * Wall time between the start event and this one, when BOTH were observed.
   * `null` means unknown and must render as "Unknown", never as 0.
   */
  readonly durationMs: number | null;

  readonly model: string | null;
  readonly toolName: string | null;

  /** A short, already-redacted, operator-safe summary. Never model reasoning. */
  readonly summary: string | null;
  /** Error class for a failure row. `null` when the run did not fail here. */
  readonly errorClass: string | null;

  /** The Canonical Event this row projects from. */
  readonly sourceEventId: string;
  readonly canonicalType: string;
}
