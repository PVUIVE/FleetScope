import type { CanonicalEvent } from '@fleetscope/event-schema';
import type { ViewerCategory, ViewerEvent, ViewerEventType, ViewerStatus } from './viewer-event.js';

/**
 * Canonical Events → ViewerEvents.
 *
 * Pure: no clock, no environment, no I/O. The same canonical prefix always
 * projects to the same rows, which is what lets the timeline be rebuilt from
 * any prefix during historical inspection without re-running anything.
 */

/** Canonical type → Viewer type. Absent means the row is internal-only. */
const VIEWER_TYPE_OF: Readonly<Record<string, ViewerEventType>> = {
  'runtime.started': 'session.started',
  'runtime.completed': 'session.completed',
  'runtime.failed': 'error',

  'agent.started': 'agent.started',
  'agent.completed': 'agent.completed',
  'agent.failed': 'error',

  'model.requested': 'model.started',
  'model.responded': 'model.completed',
  'model.failed': 'error',

  'tool.requested': 'tool.started',
  'tool.succeeded': 'tool.completed',
  'tool.failed': 'tool.failed',
};

const CATEGORY_OF: Readonly<Record<ViewerEventType, ViewerCategory>> = {
  'session.started': 'session',
  'session.completed': 'session',
  'agent.started': 'agent',
  'agent.completed': 'agent',
  'model.started': 'model',
  'model.completed': 'model',
  'tool.started': 'tool',
  'tool.completed': 'tool',
  'tool.failed': 'error',
  'agent.handoff': 'handoff',
  error: 'error',
};

const STATUS_OF: Readonly<Partial<Record<ViewerEventType, ViewerStatus>>> = {
  'session.started': 'running',
  'session.completed': 'completed',
  'agent.started': 'running',
  'agent.completed': 'completed',
  'model.started': 'running',
  'model.completed': 'completed',
  'tool.started': 'running',
  'tool.completed': 'completed',
  'tool.failed': 'failed',
  error: 'failed',
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * A payload string is admitted to the viewer only when it is short and carries
 * no redaction marker. Anything else is dropped rather than shown as noise.
 */
function safeSummary(value: unknown): string | null {
  const text = str(value);
  if (text === null || text.includes('«redacted»') || text.includes('[redacted]')) return null;
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/** Milliseconds between two ISO instants, or null when either is unusable. */
function elapsed(fromIso: string | undefined, toIso: string): number | null {
  if (fromIso === undefined) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const delta = to - from;
  return delta < 0 ? null : delta;
}

export function projectViewerEvents(events: readonly CanonicalEvent[]): ViewerEvent[] {
  const ordered = [...events].sort((a, b) => a.caseSequence - b.caseSequence);

  // Start times, so a completion can report a real duration. A pairing that
  // never opened yields `null` — an unobserved duration is never invented.
  const openedAt = new Map<string, string>();
  const rows: ViewerEvent[] = [];

  for (const event of ordered) {
    const p = event.payloadRedacted;
    const c = event.correlations;
    const agentId = c['agentInstanceId'] ?? null;
    const parentAgentId = c['parentAgentInstanceId'] ?? null;
    const sessionId = event.sessionId ?? event.caseId;

    const base = {
      id: event.eventId,
      sessionId,
      sequence: event.caseSequence,
      timestamp: event.sourceTime,
      agentId,
      parentAgentId,
      sourceEventId: event.eventId,
      canonicalType: event.type,
    } as const;

    // A delegation is the single most useful row in the whole timeline, and it
    // has no canonical type of its own: it IS a spawn that names a parent.
    if (event.type === 'agent.spawned') {
      if (parentAgentId === null) continue;
      rows.push({
        ...base,
        type: 'agent.handoff',
        category: 'handoff',
        label: `${parentAgentId} → ${agentId ?? 'agent'}`,
        status: null,
        durationMs: null,
        model: null,
        toolName: null,
        summary: safeSummary(p['role']),
        errorClass: null,
      });
      continue;
    }

    const type = VIEWER_TYPE_OF[event.type];
    if (type === undefined) continue;

    const toolName = safeSummary(p['tool']);
    const model = safeSummary(p['model']);
    const errorClass = safeSummary(p['errorClass']);

    const pairKey = event.type.startsWith('tool.')
      ? `tool:${c['toolCallId'] ?? event.eventId}`
      : event.type.startsWith('model.')
        ? `model:${c['modelCallId'] ?? event.eventId}`
        : event.type.startsWith('agent.')
          ? `agent:${agentId ?? event.eventId}`
          : `session:${sessionId}`;

    if (type === 'tool.started' || type === 'model.started' || type === 'agent.started') {
      openedAt.set(pairKey, event.sourceTime);
    }
    const durationMs =
      type === 'tool.started' || type === 'model.started' || type === 'agent.started'
        ? null
        : elapsed(openedAt.get(pairKey), event.sourceTime);

    rows.push({
      ...base,
      type,
      category: CATEGORY_OF[type],
      label: labelFor(event, { toolName, model, errorClass, agentId }),
      status: STATUS_OF[type] ?? null,
      durationMs,
      model,
      toolName,
      summary:
        safeSummary(p['resultSummary']) ??
        safeSummary(p['state']) ??
        safeSummary(p['finishReason']),
      errorClass: type === 'error' || type === 'tool.failed' ? (errorClass ?? 'unrecorded') : null,
    });
  }

  return rows;
}

function labelFor(
  event: CanonicalEvent,
  parts: {
    toolName: string | null;
    model: string | null;
    errorClass: string | null;
    agentId: string | null;
  },
): string {
  const agent = parts.agentId ?? 'agent';
  switch (event.type) {
    case 'runtime.started':
      return 'Session started';
    case 'runtime.completed':
      return 'Session completed';
    case 'runtime.failed':
      return `Session failed · ${parts.errorClass ?? 'unrecorded'}`;
    case 'agent.started':
      return `${agent} started`;
    case 'agent.completed':
      return `${agent} completed`;
    case 'agent.failed':
      return `${agent} failed · ${parts.errorClass ?? 'unrecorded'}`;
    case 'model.requested':
      return parts.model ?? 'Model request';
    case 'model.responded':
      return parts.model ?? 'Model response';
    case 'model.failed':
      return `${parts.model ?? 'Model'} failed · ${parts.errorClass ?? 'unrecorded'}`;
    case 'tool.requested':
      return parts.toolName ?? 'Tool call';
    case 'tool.succeeded':
      return parts.toolName ?? 'Tool result';
    case 'tool.failed':
      return `${parts.toolName ?? 'Tool'} failed · ${parts.errorClass ?? 'unrecorded'}`;
    default:
      return event.type;
  }
}
