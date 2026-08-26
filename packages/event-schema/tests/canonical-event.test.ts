import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  EVENT_TYPES,
  eventFamily,
  parseCanonicalEvent,
  parseCanonicalEventsJsonl,
  serializeCanonicalEventsJsonl,
  validateCanonicalStream,
  type CanonicalEvent,
} from '../src/index.js';

const base = (over: Partial<CanonicalEvent> = {}): Record<string, unknown> => ({
  eventId: 'evt-0001',
  caseId: 'CASE-1042',
  caseSequence: 0,
  sessionId: 'sess-001',
  sessionSequence: 0,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  type: 'runtime.started',
  sourceTime: '2026-08-26T09:00:00.000Z',
  acceptedTime: '2026-08-26T09:00:00.100Z',
  actor: { kind: 'service', id: 'agent-runtime' },
  correlations: { runtimeOperationId: 'op-1' },
  payloadRedacted: {},
  ...over,
});

describe('canonicalEventSchema', () => {
  it('accepts a well-formed envelope', () => {
    expect(parseCanonicalEvent(base()).success).toBe(true);
  });

  it('rejects an unknown event type', () => {
    expect(parseCanonicalEvent(base({ type: 'runtime.exploded' as never })).success).toBe(false);
  });

  it('rejects unknown envelope fields so schema drift is loud', () => {
    expect(parseCanonicalEvent({ ...base(), rawPrompt: 'secret' }).success).toBe(false);
  });

  it('requires an explicit UTC offset on instants', () => {
    expect(parseCanonicalEvent(base({ sourceTime: '2026-08-26 09:00:00' })).success).toBe(false);
    expect(parseCanonicalEvent(base({ sourceTime: '2026-08-26T09:00:00+02:00' })).success).toBe(
      true,
    );
  });

  it('allows a Case-level event with no Session', () => {
    const result = parseCanonicalEvent(
      base({ type: 'case.created', sessionId: null, sessionSequence: null }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a Session sequence without a Session id', () => {
    expect(parseCanonicalEvent(base({ sessionId: null })).success).toBe(false);
  });
});

describe('EVENT_TYPES', () => {
  it('covers every required family', () => {
    const families = new Set(EVENT_TYPES.map(eventFamily));
    expect([...families].sort()).toEqual([
      'agent',
      'armor',
      'case',
      'gateway',
      'human_escalation',
      'identity',
      'incident',
      'intervention',
      'memory',
      'policy',
      'registry',
      'runtime',
      'tool',
      'usage',
    ]);
  });

  it('models the full intervention lifecycle as distinct types', () => {
    for (const state of [
      'proposed',
      'authorized',
      'rejected',
      'requested',
      'acknowledged',
      'succeeded',
      'failed',
      'timed_out',
    ]) {
      expect(EVENT_TYPES).toContain(`intervention.${state}`);
    }
  });

  it('has no duplicate types', () => {
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
  });
});

describe('validateCanonicalStream', () => {
  const parse = (raw: Record<string, unknown>): CanonicalEvent => {
    const result = parseCanonicalEvent(raw);
    if (!result.success) throw new Error('fixture is invalid');
    return result.data;
  };

  it('accepts a monotonic single-Case stream', () => {
    const events = [
      parse(base({ eventId: 'e1', caseSequence: 0, sessionSequence: 0 })),
      parse(base({ eventId: 'e2', caseSequence: 1, sessionSequence: 1 })),
    ];
    expect(validateCanonicalStream(events)).toEqual([]);
  });

  it('detects duplicate event ids', () => {
    const events = [
      parse(base({ eventId: 'e1', caseSequence: 0, sessionSequence: 0 })),
      parse(base({ eventId: 'e1', caseSequence: 1, sessionSequence: 1 })),
    ];
    expect(validateCanonicalStream(events).join()).toMatch(/duplicate eventId/);
  });

  it('detects a non-monotonic caseSequence', () => {
    const events = [
      parse(base({ eventId: 'e1', caseSequence: 5, sessionSequence: 0 })),
      parse(base({ eventId: 'e2', caseSequence: 5, sessionSequence: 1 })),
    ];
    expect(validateCanonicalStream(events).join()).toMatch(/not strictly greater/);
  });

  it('tracks sessionSequence independently per Session', () => {
    const events = [
      parse(base({ eventId: 'e1', caseSequence: 0, sessionId: 'sess-001', sessionSequence: 7 })),
      parse(base({ eventId: 'e2', caseSequence: 1, sessionId: 'sess-002', sessionSequence: 0 })),
      parse(base({ eventId: 'e3', caseSequence: 2, sessionId: 'sess-001', sessionSequence: 8 })),
    ];
    expect(validateCanonicalStream(events)).toEqual([]);
  });

  it('refuses a stream that mixes Cases', () => {
    const events = [
      parse(base({ eventId: 'e1', caseSequence: 0, sessionSequence: 0 })),
      parse(base({ eventId: 'e2', caseId: 'CASE-9999', caseSequence: 1, sessionSequence: 1 })),
    ];
    expect(validateCanonicalStream(events).join()).toMatch(/mixes several Cases/);
  });
});

describe('jsonl round trip', () => {
  it('parses what it serializes', () => {
    const result = parseCanonicalEvent(base());
    if (!result.success) throw new Error('fixture is invalid');
    const text = serializeCanonicalEventsJsonl([result.data]);
    const round = parseCanonicalEventsJsonl(text);
    expect(round.failures).toEqual([]);
    expect(round.events).toEqual([result.data]);
  });

  it('reports the failing line number without aborting the file', () => {
    const text = ['{"nope":1}', JSON.stringify(base()), 'not json'].join('\n');
    const round = parseCanonicalEventsJsonl(text);
    expect(round.events).toHaveLength(1);
    expect(round.failures.map((f) => f.line)).toEqual([1, 3]);
  });
});
