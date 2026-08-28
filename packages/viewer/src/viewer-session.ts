import type { CanonicalEvent } from '@fleetscope/event-schema';
import type { ViewerEvent, ViewerStatus } from './viewer-event.js';

/**
 * A Session is one local agent execution — one ADK invocation the developer
 * started and FleetScope observed.
 *
 * Every field is derived from recorded evidence. A value FleetScope never
 * observed is `null` and renders as "Unknown". It is never 0.
 */
export interface ViewerSession {
  readonly sessionId: string;
  readonly name: string;
  readonly framework: string;
  readonly status: ViewerStatus;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  readonly eventCount: number;
  readonly rootAgent: string | null;
  readonly models: readonly string[];
  readonly errorCount: number;
  readonly toolCallCount: number;
  readonly handoffCount: number;
  /** Only when the framework actually reported usage. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export interface ViewerAgent {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly status: ViewerStatus;
  /** Label of the last thing this agent did. Null before it acts. */
  readonly lastAction: string | null;
  readonly errorCount: number;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly depth: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Summarize a session from its canonical stream and its projected rows.
 *
 * `running` is the honest default: a session with no terminal event has not
 * finished, and reporting it as completed would be a lie the developer acts on.
 */
export function summarizeSession(
  sessionId: string,
  name: string,
  framework: string,
  events: readonly CanonicalEvent[],
  rows: readonly ViewerEvent[],
): ViewerSession {
  const ordered = [...events].sort((a, b) => a.caseSequence - b.caseSequence);

  const startedAt = ordered[0]?.sourceTime ?? null;
  const terminal = ordered.findLast(
    (e) => e.type === 'runtime.completed' || e.type === 'runtime.failed',
  );
  const endedAt = terminal?.sourceTime ?? null;

  const failed =
    terminal?.type === 'runtime.failed' || ordered.some((e) => e.type === 'agent.failed');
  const status: ViewerStatus = terminal === undefined ? 'running' : failed ? 'failed' : 'completed';

  const models = [
    ...new Set(
      ordered
        .filter((e) => e.type.startsWith('model.'))
        .map((e) => str(e.payloadRedacted['model']))
        .filter((m): m is string => m !== null),
    ),
  ].sort();

  const rootAgent =
    str(
      ordered.find(
        (e) => e.type === 'agent.spawned' && e.correlations['parentAgentInstanceId'] === undefined,
      )?.correlations['agentInstanceId'],
    ) ?? str(ordered.find((e) => e.type === 'agent.started')?.correlations['agentInstanceId']);

  // Usage is summed only over events that actually carried it. A session where
  // no event reported usage keeps `null`, not 0.
  const sumUsage = (key: string): number | null => {
    let total: number | null = null;
    for (const event of ordered) {
      const value = num(event.payloadRedacted[key]);
      if (value !== null) total = (total ?? 0) + value;
    }
    return total;
  };

  const durationMs =
    startedAt === null || endedAt === null
      ? null
      : Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));

  return {
    sessionId,
    name,
    framework,
    status,
    startedAt,
    endedAt,
    durationMs: Number.isFinite(durationMs as number) ? durationMs : null,
    eventCount: ordered.length,
    rootAgent,
    models,
    errorCount: rows.filter((r) => r.type === 'error' || r.type === 'tool.failed').length,
    toolCallCount: rows.filter((r) => r.type === 'tool.started').length,
    handoffCount: rows.filter((r) => r.type === 'agent.handoff').length,
    inputTokens: sumUsage('inputTokens'),
    outputTokens: sumUsage('outputTokens'),
  };
}

/**
 * The agent hierarchy, in depth-first parent-before-child order.
 *
 * Parentage comes from `parentAgentInstanceId` on the spawn. An agent whose
 * parent was never recorded is treated as a root rather than dropped, so a
 * partial stream still shows every agent that ran.
 */
export function buildAgentTree(
  events: readonly CanonicalEvent[],
  rows: readonly ViewerEvent[],
): ViewerAgent[] {
  const ordered = [...events].sort((a, b) => a.caseSequence - b.caseSequence);

  interface Draft {
    id: string;
    name: string;
    parentId: string | null;
    status: ViewerStatus;
    lastAction: string | null;
    errorCount: number;
    firstSequence: number;
    lastSequence: number;
  }
  const drafts = new Map<string, Draft>();

  const touch = (id: string, sequence: number): Draft => {
    const existing = drafts.get(id);
    if (existing !== undefined) {
      existing.lastSequence = Math.max(existing.lastSequence, sequence);
      return existing;
    }
    const draft: Draft = {
      id,
      name: id,
      parentId: null,
      status: 'running',
      lastAction: null,
      errorCount: 0,
      firstSequence: sequence,
      lastSequence: sequence,
    };
    drafts.set(id, draft);
    return draft;
  };

  for (const event of ordered) {
    const id = event.correlations['agentInstanceId'];
    if (id === undefined) continue;
    const draft = touch(id, event.caseSequence);

    if (event.type === 'agent.spawned') {
      draft.parentId = event.correlations['parentAgentInstanceId'] ?? null;
      draft.name = str(event.payloadRedacted['role']) ?? id;
    }
    if (event.type === 'agent.completed') draft.status = 'completed';
    if (event.type === 'agent.failed') draft.status = 'failed';
  }

  for (const row of rows) {
    if (row.agentId === null) continue;
    const draft = drafts.get(row.agentId);
    if (draft === undefined) continue;
    draft.lastAction = row.label;
    if (row.type === 'error' || row.type === 'tool.failed') draft.errorCount += 1;
  }

  // An agent that never completed but whose descendants failed still reads as
  // running; only its own recorded outcome changes its status.
  const roots = [...drafts.values()]
    .filter((d) => d.parentId === null || !drafts.has(d.parentId))
    .sort((a, b) => a.firstSequence - b.firstSequence);

  const out: ViewerAgent[] = [];
  const visit = (draft: Draft, depth: number): void => {
    out.push({ ...draft, depth });
    const children = [...drafts.values()]
      .filter((d) => d.parentId === draft.id)
      .sort((a, b) => a.firstSequence - b.firstSequence);
    for (const child of children) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  return out;
}
