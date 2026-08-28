import { describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@fleetscope/event-schema';
import { buildAgentTree, projectViewerEvents, summarizeSession } from '../src/index.js';

/**
 * The Viewer Projection is what the browser reads. Two properties matter more
 * than any other and are asserted throughout: an unobserved value stays absent
 * (never 0), and the projection is a pure function of the canonical prefix.
 */
const SESSION = 'ses_test';

let sequence = 0;
function event(
  type: CanonicalEvent['type'],
  correlations: Record<string, string>,
  payload: Record<string, unknown> = {},
  sourceTime = `2026-08-28T10:00:0${sequence % 10}.000Z`,
): CanonicalEvent {
  const caseSequence = sequence++;
  return {
    eventId: `evt-${caseSequence}`,
    caseId: SESSION,
    caseSequence,
    sessionId: SESSION,
    sessionSequence: caseSequence,
    schemaVersion: '1.0.0',
    type,
    sourceTime,
    acceptedTime: sourceTime,
    actor: { kind: 'agent', id: correlations['agentInstanceId'] ?? 'root' },
    correlations: { ...correlations, framework: 'google-adk' },
    payloadRedacted: payload,
  };
}

function goldenRun(): CanonicalEvent[] {
  sequence = 0;
  const root = { agentInstanceId: 'root' };
  const child = { agentInstanceId: 'child', parentAgentInstanceId: 'root' };
  return [
    event('runtime.started', root, {}, '2026-08-28T10:00:00.000Z'),
    event('agent.spawned', root, { role: 'root' }, '2026-08-28T10:00:00.100Z'),
    event('agent.started', root, {}, '2026-08-28T10:00:00.100Z'),
    event(
      'model.requested',
      { ...root, modelCallId: 'm1' },
      { model: 'gemini-x' },
      '2026-08-28T10:00:00.200Z',
    ),
    event(
      'model.responded',
      { ...root, modelCallId: 'm1' },
      { model: 'gemini-x', inputTokens: 100, outputTokens: 20 },
      '2026-08-28T10:00:01.700Z',
    ),
    event(
      'tool.requested',
      { ...root, toolCallId: 't1' },
      { tool: 'vendor_lookup' },
      '2026-08-28T10:00:01.800Z',
    ),
    event(
      'tool.succeeded',
      { ...root, toolCallId: 't1' },
      { tool: 'vendor_lookup', resultSummary: 'found' },
      '2026-08-28T10:00:02.090Z',
    ),
    event('agent.spawned', child, { role: 'logistics' }, '2026-08-28T10:00:02.600Z'),
    event('agent.started', child, {}, '2026-08-28T10:00:02.600Z'),
    event(
      'tool.requested',
      { ...child, toolCallId: 't2' },
      { tool: 'inventory_lookup' },
      '2026-08-28T10:00:03.100Z',
    ),
    event(
      'tool.failed',
      { ...child, toolCallId: 't2' },
      { tool: 'inventory_lookup', errorClass: 'timeout' },
      '2026-08-28T10:00:03.580Z',
    ),
    event('agent.completed', child, {}, '2026-08-28T10:00:03.900Z'),
    event('agent.completed', root, {}, '2026-08-28T10:00:03.950Z'),
    event('runtime.completed', root, { state: 'completed' }, '2026-08-28T10:00:04.000Z'),
  ];
}

describe('viewer projection', () => {
  const events = goldenRun();
  const rows = projectViewerEvents(events);

  it('maps the canonical families onto the small viewer vocabulary', () => {
    expect(rows.map((row) => row.type)).toEqual([
      'session.started',
      'agent.started',
      'model.started',
      'model.completed',
      'tool.started',
      'tool.completed',
      'agent.handoff',
      'agent.started',
      'tool.started',
      'tool.failed',
      'agent.completed',
      'agent.completed',
      'session.completed',
    ]);
  });

  it('drops the ROOT spawn but keeps a spawn that names a parent as a handoff', () => {
    const handoffs = rows.filter((row) => row.type === 'agent.handoff');
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]?.parentAgentId).toBe('root');
    expect(handoffs[0]?.agentId).toBe('child');
  });

  it('derives durations by pairing a start with its own end', () => {
    const model = rows.find((row) => row.type === 'model.completed');
    expect(model?.durationMs).toBe(1500);
    const tool = rows.find((row) => row.type === 'tool.completed');
    expect(tool?.durationMs).toBe(290);
    const failure = rows.find((row) => row.type === 'tool.failed');
    expect(failure?.durationMs).toBe(480);
  });

  it('leaves a duration null when the start was never observed', () => {
    sequence = 40;
    const orphan = projectViewerEvents([
      event('tool.succeeded', { agentInstanceId: 'a', toolCallId: 'zz' }, { tool: 'x' }),
    ]);
    // The alternative — reporting 0 — would tell a developer the call was
    // instantaneous, which is a different and false claim.
    expect(orphan[0]?.durationMs).toBeNull();
  });

  it('never leaks a redacted value into a label or summary', () => {
    sequence = 50;
    const redacted = projectViewerEvents([
      event(
        'tool.succeeded',
        { agentInstanceId: 'a', toolCallId: 'r' },
        {
          tool: '«redacted»',
          resultSummary: '«redacted»',
        },
      ),
    ]);
    expect(redacted[0]?.toolName).toBeNull();
    expect(redacted[0]?.summary).toBeNull();
    expect(redacted[0]?.label).not.toContain('redacted');
  });

  it('is a pure function of the prefix, so any prefix re-derives identically', () => {
    for (let cut = 1; cut <= events.length; cut += 1) {
      const prefix = projectViewerEvents(events.slice(0, cut));
      expect(prefix).toEqual(rows.slice(0, prefix.length));
    }
  });

  it('is independent of the order events are handed to it', () => {
    expect(projectViewerEvents([...events].reverse())).toEqual(rows);
  });
});

describe('session summary', () => {
  const events = goldenRun();
  const rows = projectViewerEvents(events);

  it('reports what the recording contains', () => {
    const summary = summarizeSession(SESSION, 'Demo', 'google-adk', events, rows);
    expect(summary.status).toBe('completed');
    expect(summary.eventCount).toBe(events.length);
    expect(summary.rootAgent).toBe('root');
    expect(summary.models).toEqual(['gemini-x']);
    expect(summary.errorCount).toBe(1);
    expect(summary.toolCallCount).toBe(2);
    expect(summary.handoffCount).toBe(1);
    expect(summary.durationMs).toBe(4000);
    expect(summary.inputTokens).toBe(100);
    expect(summary.outputTokens).toBe(20);
  });

  it('calls an unfinished session running, never completed', () => {
    const partial = events.slice(0, 6);
    const summary = summarizeSession(
      SESSION,
      'Demo',
      'google-adk',
      partial,
      projectViewerEvents(partial),
    );
    expect(summary.status).toBe('running');
    expect(summary.endedAt).toBeNull();
    expect(summary.durationMs).toBeNull();
  });

  it('keeps token usage null when nothing reported any', () => {
    sequence = 60;
    const bare = [event('runtime.started', { agentInstanceId: 'a' })];
    const summary = summarizeSession(
      SESSION,
      'Demo',
      'google-adk',
      bare,
      projectViewerEvents(bare),
    );
    expect(summary.inputTokens).toBeNull();
    expect(summary.outputTokens).toBeNull();
  });

  it('reports failed when the runtime failed', () => {
    sequence = 70;
    const failed = [
      event('runtime.started', { agentInstanceId: 'a' }, {}, '2026-08-28T11:00:00.000Z'),
      event(
        'runtime.failed',
        { agentInstanceId: 'a' },
        { errorClass: 'boom' },
        '2026-08-28T11:00:01.000Z',
      ),
    ];
    const summary = summarizeSession(
      SESSION,
      'Demo',
      'google-adk',
      failed,
      projectViewerEvents(failed),
    );
    expect(summary.status).toBe('failed');
  });
});

describe('agent tree', () => {
  const events = goldenRun();
  const rows = projectViewerEvents(events);
  const tree = buildAgentTree(events, rows);

  it('is parent-before-child with a depth for each agent', () => {
    expect(tree.map((agent) => [agent.id, agent.depth, agent.parentId])).toEqual([
      ['root', 0, null],
      ['child', 1, 'root'],
    ]);
  });

  it('attributes a failure to the agent that actually ran it', () => {
    expect(tree.find((agent) => agent.id === 'root')?.errorCount).toBe(0);
    expect(tree.find((agent) => agent.id === 'child')?.errorCount).toBe(1);
  });

  it('leaves an agent running until its own outcome is recorded', () => {
    const partial = events.slice(0, 10);
    const running = buildAgentTree(partial, projectViewerEvents(partial));
    expect(running.every((agent) => agent.status === 'running')).toBe(true);
  });

  it('treats an agent whose parent was never recorded as a root, not a dropped node', () => {
    sequence = 80;
    const orphan = [
      event(
        'agent.spawned',
        { agentInstanceId: 'x', parentAgentInstanceId: 'ghost' },
        { role: 'x' },
      ),
    ];
    const tree = buildAgentTree(orphan, projectViewerEvents(orphan));
    expect(tree.map((agent) => agent.id)).toEqual(['x']);
    expect(tree[0]?.depth).toBe(0);
  });
});
