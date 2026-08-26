import { describe, expect, it } from 'vitest';
import type { SourceEvent } from '@fleetscope/event-schema';
import {
  canonicalize,
  deriveEventId,
  REDACTION_MARKER,
  redactPayload,
  scanForSensitiveMaterial,
  streamRevisionOf,
} from '../src/index.js';

const CASE = 'CASE-TEST';

function source(overrides: Partial<SourceEvent> & Pick<SourceEvent, 'dedupeKey'>): SourceEvent {
  return {
    caseId: CASE,
    sessionId: 'sess-001',
    type: 'tool.requested',
    sourceTime: '2026-08-26T09:00:00.000Z',
    actor: { kind: 'agent', id: 'orchestrator' },
    correlations: { caseId: CASE },
    payload: {},
    ...overrides,
  };
}

describe('deduplication', () => {
  it('collapses a logical Source Event delivered twice into one Canonical Event', () => {
    const once = source({ dedupeKey: 'k-1' });
    const result = canonicalize([once, structuredClone(once)], CASE);

    expect(result.accepted).toHaveLength(1);
    expect(result.duplicatesCollapsed).toEqual(['k-1']);
    expect(result.rejected).toEqual([]);
    expect(result.streamProblems).toEqual([]);
  });

  it('records a conflicting redelivery instead of silently discarding it', () => {
    const a = source({ dedupeKey: 'k-1', payload: { tool: 'ERP.inventory.read' } });
    const b = source({ dedupeKey: 'k-1', payload: { tool: 'ERP.inventory.write' } });

    const result = canonicalize([a, b], CASE);

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toEqual([
      expect.objectContaining({ dedupeKey: 'k-1', reason: 'duplicate_key_conflicting_payload' }),
    ]);
  });

  it('gives the same logical fact the same eventId however often it is delivered', () => {
    expect(deriveEventId(CASE, 'k-1')).toBe(deriveEventId(CASE, 'k-1'));
    expect(deriveEventId(CASE, 'k-1')).not.toBe(deriveEventId(CASE, 'k-2'));
    expect(deriveEventId('OTHER', 'k-1')).not.toBe(deriveEventId(CASE, 'k-1'));
  });
});

describe('ordering', () => {
  const events = [
    source({ dedupeKey: 'a', sourceTime: '2026-08-26T09:00:00.000Z' }),
    source({ dedupeKey: 'b', sourceTime: '2026-08-26T09:00:01.000Z' }),
    source({ dedupeKey: 'c', sourceTime: '2026-08-26T09:00:02.000Z', sessionId: 'sess-002' }),
    source({ dedupeKey: 'd', sourceTime: '2026-08-26T09:00:03.000Z' }),
  ];

  it('produces the same canonical sequence from any arrival order', () => {
    const forward = canonicalize(events, CASE);
    const reversed = canonicalize([...events].reverse(), CASE);
    const shuffled = canonicalize([events[2]!, events[0]!, events[3]!, events[1]!], CASE);

    expect(reversed.accepted).toEqual(forward.accepted);
    expect(shuffled.accepted).toEqual(forward.accepted);
    expect(reversed.streamRevision).toBe(forward.streamRevision);
    expect(shuffled.streamRevision).toBe(forward.streamRevision);
  });

  it('assigns dense caseSequence and per-Session sessionSequence', () => {
    const { accepted } = canonicalize(events, CASE);

    expect(accepted.map((e) => e.caseSequence)).toEqual([0, 1, 2, 3]);
    // sess-001 gets 0,1,2 across its three events; sess-002 restarts at 0.
    expect(accepted.map((e) => [e.sessionId, e.sessionSequence])).toEqual([
      ['sess-001', 0],
      ['sess-001', 1],
      ['sess-002', 0],
      ['sess-001', 2],
    ]);
  });

  it('breaks an exact sourceTime tie deterministically by dedupeKey', () => {
    const tied = [
      source({ dedupeKey: 'z', sourceTime: '2026-08-26T09:00:00.000Z' }),
      source({ dedupeKey: 'a', sourceTime: '2026-08-26T09:00:00.000Z' }),
    ];
    expect(canonicalize(tied, CASE).accepted.map((e) => e.caseSequence)).toEqual([0, 1]);
    expect(canonicalize(tied, CASE).accepted[0]!.eventId).toBe(deriveEventId(CASE, 'a'));
  });
});

describe('rejection', () => {
  it('rejects a malformed Source Event and names the problem', () => {
    const result = canonicalize([{ nope: true }], CASE);
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('schema_invalid');
  });

  it('rejects an event belonging to another Case', () => {
    const result = canonicalize([source({ dedupeKey: 'k', caseId: 'CASE-OTHER' })], CASE);
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('wrong_case');
  });

  it('rejects an unknown event type rather than projecting it', () => {
    const result = canonicalize([{ ...source({ dedupeKey: 'k' }), type: 'tool.exploded' }], CASE);
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('schema_invalid');
  });
});

describe('redaction — the primary persistence boundary', () => {
  it('keeps a configured secret out of the accepted Canonical Event', () => {
    const secret = 'AIzaSyD-fake-fixture-key-00000000000000';
    const result = canonicalize(
      [source({ dedupeKey: 'k', payload: { tool: 'ERP.read', apiKey: secret } })],
      CASE,
    );

    const [event] = result.accepted;
    expect(event).toBeDefined();

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(secret);
    expect(event!.payloadRedacted['apiKey']).toBe(REDACTION_MARKER);
    // The non-sensitive sibling survives: redaction is targeted, not wholesale.
    expect(event!.payloadRedacted['tool']).toBe('ERP.read');
  });

  it('emits a digest of the pre-redaction payload for correlation without disclosure', () => {
    const result = canonicalize(
      [source({ dedupeKey: 'k', payload: { password: 'hunter2' } })],
      CASE,
    );
    const digest = result.accepted[0]?.payloadDigest;
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digest).not.toContain('hunter2');
  });

  it('catches a secret arriving under an unremarkable key, by value shape', () => {
    const { payloadRedacted, redactions } = redactPayload({
      note: 'use Bearer abcdefghijklmnopqrstuvwxyz012345 to call it',
    });
    expect(payloadRedacted['note']).toBe(REDACTION_MARKER);
    expect(redactions[0]?.rule).toBe('bearer_token');
  });

  it('redacts a whole sensitive subtree, not only its string leaves', () => {
    const { payloadRedacted } = redactPayload({
      credentials: { user: 'svc-erp', password: 'hunter2' },
    });
    // Redacting only the leaves would still disclose the key names around them.
    expect(payloadRedacted['credentials']).toBe(REDACTION_MARKER);
  });

  it('redacts private prompts and model reasoning', () => {
    const { redactions } = redactPayload({
      prompt: 'internal instruction text',
      thinking: 'the model reasoning nobody may see',
    });
    expect(redactions.map((r) => r.classification).sort()).toEqual([
      'model_reasoning',
      'private_prompt',
    ]);
  });

  it('redacts a local filesystem path so a developer machine layout never ships', () => {
    const { payloadRedacted, redactions } = redactPayload({
      artifact: '/Users/someone/work/secrets/report.txt',
    });
    expect(payloadRedacted['artifact']).toBe(REDACTION_MARKER);
    expect(redactions[0]?.classification).toBe('filesystem_path');
  });

  it('reaches sensitive leaves nested inside arrays', () => {
    const { payloadRedacted } = redactPayload({
      attempts: [{ token: 'abc' }, { token: 'def' }],
    });
    const attempts = payloadRedacted['attempts'] as { token: string }[];
    expect(attempts.map((a) => a.token)).toEqual([REDACTION_MARKER, REDACTION_MARKER]);
  });

  it('scans an artifact for sensitive material without echoing the match', () => {
    const hits = scanForSensitiveMaterial('key=AIzaSyD-fake-fixture-key-00000000000000');
    expect(hits.map((h) => h.rule)).toContain('google_api_key');
    expect(scanForSensitiveMaterial('nothing sensitive here')).toEqual([]);
  });
});

describe('stream revision', () => {
  it('changes when the evidence changes and is stable when it does not', () => {
    const a = canonicalize([source({ dedupeKey: 'k' })], CASE);
    const b = canonicalize([source({ dedupeKey: 'k' })], CASE);
    const c = canonicalize([source({ dedupeKey: 'k', payload: { tool: 'x' } })], CASE);

    expect(a.streamRevision).toBe(b.streamRevision);
    expect(a.streamRevision).not.toBe(c.streamRevision);
    expect(streamRevisionOf(a.accepted)).toBe(a.streamRevision);
  });
});

describe('purity', () => {
  it('reads no clock: acceptedTime defaults to the recorded sourceTime', () => {
    const { accepted } = canonicalize([source({ dedupeKey: 'k' })], CASE);
    expect(accepted[0]?.acceptedTime).toBe('2026-08-26T09:00:00.000Z');
  });

  it('names no forbidden runtime capability in its own source', async () => {
    const { readFileSync } = await import('node:fs');
    const source_ = readFileSync(new URL('../src/canonicalize.ts', import.meta.url), 'utf8');
    for (const forbidden of ['Date.now', 'Math.random', 'node:fs', 'fetch(']) {
      expect(source_).not.toContain(forbidden);
    }
  });
});
