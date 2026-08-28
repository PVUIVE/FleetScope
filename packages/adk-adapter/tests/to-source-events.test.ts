import { describe, expect, it } from 'vitest';
import { canonicalize } from '@fleetscope/canonicalizer';
import { parseAdkIngest, toSourceEvents, type AdkIngest } from '../src/index.js';

/**
 * The adapter is where a framework's vocabulary becomes FleetScope evidence.
 * Two rules are tested harder than the mapping itself: it fabricates nothing,
 * and its output is stable enough that redelivering a batch changes nothing.
 */
const ingest = (events: unknown[]): AdkIngest => {
  const parsed = parseAdkIngest({
    framework: 'google-adk',
    frameworkVersion: '1.20.0',
    sessionId: 'ses_x',
    appName: 'Demo',
    events,
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};

const at = (n: number): string => `2026-08-28T10:00:0${n}.000Z`;

describe('ADK wire validation', () => {
  it('refuses an unknown event kind rather than guessing', () => {
    const parsed = parseAdkIngest({
      sessionId: 's',
      events: [{ kind: 'telepathy', seq: 0, at: at(0) }],
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses a batch with no session', () => {
    expect(parseAdkIngest({ events: [{ kind: 'session.start', seq: 0, at: at(0) }] }).success).toBe(
      false,
    );
  });

  it('refuses an unknown field, so a typo is never silently dropped', () => {
    const parsed = parseAdkIngest({
      sessionId: 's',
      events: [{ kind: 'session.start', seq: 0, at: at(0), modle: 'typo' }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('ADK events → Source Events', () => {
  it('covers the whole lifecycle', () => {
    const batch = ingest([
      { kind: 'session.start', seq: 0, at: at(0), agent: 'root' },
      { kind: 'agent.start', seq: 1, at: at(1), agent: 'root' },
      { kind: 'model.start', seq: 2, at: at(2), agent: 'root', model: 'gemini-x', callId: 'm1' },
      {
        kind: 'model.end',
        seq: 3,
        at: at(3),
        agent: 'root',
        model: 'gemini-x',
        callId: 'm1',
        inputTokens: 10,
        outputTokens: 4,
      },
      { kind: 'tool.start', seq: 4, at: at(4), agent: 'root', tool: 'lookup', callId: 't1' },
      { kind: 'tool.end', seq: 5, at: at(5), agent: 'root', tool: 'lookup', callId: 't1' },
      {
        kind: 'tool.end',
        seq: 6,
        at: at(6),
        agent: 'child',
        tool: 'boom',
        callId: 't2',
        error: true,
        errorClass: 'timeout',
      },
      { kind: 'agent.start', seq: 7, at: at(7), agent: 'child', parentAgent: 'root' },
      { kind: 'agent.end', seq: 8, at: at(8), agent: 'child' },
      { kind: 'session.end', seq: 9, at: at(9), agent: 'root' },
    ]);

    const events = toSourceEvents(batch, new Set());
    expect(events.map((event) => event.type)).toEqual([
      'runtime.started',
      'agent.spawned',
      'agent.started',
      'model.requested',
      'model.responded',
      'tool.requested',
      'tool.succeeded',
      'tool.failed',
      'agent.spawned',
      'agent.started',
      'agent.completed',
      'runtime.completed',
    ]);
  });

  it('routes a failed session and a model error to their failure types', () => {
    const events = toSourceEvents(
      ingest([
        { kind: 'model.error', seq: 0, at: at(0), agent: 'a', model: 'm', errorClass: 'Timeout' },
        { kind: 'tool.error', seq: 1, at: at(1), agent: 'a', tool: 't' },
        { kind: 'session.end', seq: 2, at: at(2), agent: 'a', error: true, errorClass: 'Boom' },
      ]),
      new Set(),
    );
    expect(events.map((event) => event.type)).toEqual([
      'model.failed',
      'tool.failed',
      'runtime.failed',
    ]);
    expect(events[1]?.payload['errorClass']).toBe('tool_error');
  });

  it('spawns an agent exactly once, even across batches', () => {
    const known = new Set<string>();
    const first = toSourceEvents(
      ingest([{ kind: 'agent.start', seq: 0, at: at(0), agent: 'root' }]),
      known,
    );
    const second = toSourceEvents(
      ingest([{ kind: 'agent.start', seq: 1, at: at(1), agent: 'root' }]),
      known,
    );
    expect(first.map((event) => event.type)).toEqual(['agent.spawned', 'agent.started']);
    expect(second.map((event) => event.type)).toEqual(['agent.started']);
  });

  it('gives two Source Events from one wire event a deterministic order', () => {
    const events = toSourceEvents(
      ingest([{ kind: 'agent.start', seq: 3, at: at(3), agent: 'root' }]),
      new Set(),
    );
    // Same timestamp; the dedupe key's sub-index is what breaks the tie, and the
    // Canonicalizer orders on exactly that.
    expect(events[0]?.sourceTime).toBe(events[1]?.sourceTime);
    expect(events[0]?.dedupeKey).toBe('adk:ses_x:000003:0');
    expect(events[1]?.dedupeKey).toBe('adk:ses_x:000003:1');
    const canonical = canonicalize(events, 'ses_x');
    expect(canonical.accepted.map((event) => event.type)).toEqual([
      'agent.spawned',
      'agent.started',
    ]);
  });

  it('omits what ADK did not report instead of defaulting it', () => {
    const [model] = toSourceEvents(
      ingest([{ kind: 'model.end', seq: 0, at: at(0), agent: 'a', model: 'm', callId: 'c' }]),
      new Set(),
    );
    expect(model?.payload).not.toHaveProperty('inputTokens');
    expect(model?.payload).not.toHaveProperty('outputTokens');
    expect(model?.correlations).not.toHaveProperty('parentAgentInstanceId');
  });

  it('is idempotent: the same batch twice canonicalizes to one stream', () => {
    const batch = ingest([
      { kind: 'session.start', seq: 0, at: at(0), agent: 'a' },
      { kind: 'session.end', seq: 1, at: at(1), agent: 'a' },
    ]);
    const once = toSourceEvents(batch, new Set());
    const twice = [...once, ...toSourceEvents(batch, new Set(['a']))];
    expect(canonicalize(twice, 'ses_x').accepted).toEqual(canonicalize(once, 'ses_x').accepted);
  });

  it('sends tool arguments through the redaction boundary', () => {
    const events = toSourceEvents(
      ingest([
        {
          kind: 'tool.start',
          seq: 0,
          at: at(0),
          agent: 'a',
          tool: 't',
          callId: 'c',
          args: { name: 'Acme', api_key: 'AIzaSyDUMMYKEY0000000000000000000000000000' },
        },
      ]),
      new Set(),
    );
    const canonical = canonicalize(events, 'ses_x');
    const args = canonical.accepted[0]?.payloadRedacted['args'] as Record<string, unknown>;
    expect(args['name']).toBe('Acme');
    expect(args['api_key']).toBe('«redacted»');
    expect(canonical.redactionCount).toBeGreaterThan(0);
  });
});
