import { describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@fleetscope/event-schema';
import { loadCanonicalEvents } from '@fleetscope/fixtures/node';
import { scanForSensitiveMaterial } from '@fleetscope/canonicalizer';
import {
  ZOETROPE_ADAPTER_ID,
  compileZoetropeScene,
  fractionForEntryIndex,
  manifestEntryForCaseSequence,
  manifestEntryForRendererIndex,
  orderedTimestamp,
  rendererFractionForCaseSequence,
  validateRenderManifest,
  type RenderManifestEntry,
} from '../src/index.js';

const CASE_ID = 'CASE-1042';
const events = loadCanonicalEvents(CASE_ID);
const scene = compileZoetropeScene(events);
const manifest = scene.manifest;

/** Build a minimal synthetic Case for mappings CASE-1042 does not contain. */
function synthetic(
  specs: readonly (Pick<CanonicalEvent, 'type'> &
    Partial<Pick<CanonicalEvent, 'correlations' | 'payloadRedacted' | 'sessionId'>>)[],
): CanonicalEvent[] {
  return specs.map((spec, index) => ({
    eventId: `evt-s${String(index).padStart(3, '0')}`,
    caseId: 'CASE-SYNTH',
    caseSequence: index,
    sessionId: spec.sessionId === undefined ? 'sess-001' : spec.sessionId,
    sessionSequence: spec.sessionId === null ? null : index,
    schemaVersion: '1.0.0',
    type: spec.type,
    sourceTime: `2026-08-26T09:${String(index).padStart(2, '0')}:00.000Z`,
    acceptedTime: `2026-08-26T09:${String(index).padStart(2, '0')}:00.000Z`,
    actor: { kind: 'service', id: 'test' },
    correlations: { caseId: 'CASE-SYNTH', ...spec.correlations },
    payloadRedacted: spec.payloadRedacted ?? {},
  }));
}

const outcomeAt = (m: typeof manifest, caseSequence: number): string | undefined =>
  m.entries.find((e) => e.caseSequence === caseSequence)?.outcome;

describe('the compiled scene', () => {
  it('declares the adapter that produced it', () => {
    expect(manifest.adapterId).toBe(ZOETROPE_ADAPTER_ID);
    expect(manifest.caseId).toBe(CASE_ID);
  });

  it('produces an internally consistent Render Manifest', () => {
    expect(validateRenderManifest(manifest)).toEqual([]);
  });

  it('records one manifest entry per Canonical Event, in order', () => {
    expect(manifest.entries).toHaveLength(events.length);
    expect(manifest.entries.map((e) => e.caseSequence)).toEqual(events.map((e) => e.caseSequence));
  });

  it('records no security-ordering violation for the golden Case', () => {
    expect(scene.invariantViolations).toEqual([]);
  });

  it('compiles deterministically — the same events give byte-identical output', () => {
    const again = compileZoetropeScene(events);
    expect(again.main).toBe(scene.main);
    expect(again.subagents).toEqual(scene.subagents);
    expect(again.manifest).toEqual(manifest);
  });

  it('is unaffected by the arrival order of its input', () => {
    const shuffled = compileZoetropeScene([...events].reverse());
    expect(shuffled.main).toBe(scene.main);
    expect(shuffled.manifest).toEqual(manifest);
  });
});

describe('one Canonical Event may produce zero, one, or many renderer entries', () => {
  it('produces none for evidence that has no renderer meaning', () => {
    const zero = manifest.entries.filter((e) => e.rendererEntryCount === 0);
    expect(zero.length).toBeGreaterThan(0);
    // Usage totals and milestones belong to the business rail, not the graph.
    expect(new Set(zero.map((e) => e.domain))).toEqual(new Set(['usage', 'case']));
  });

  it('produces exactly one for a simple tool request', () => {
    const single = manifest.entries.filter((e) => e.rendererEntryCount === 1);
    expect(single.length).toBeGreaterThan(0);
  });

  it('produces several for a platform decision, without breaking manifest lookup', () => {
    const many = manifest.entries.filter((e) => e.rendererEntryCount > 1);
    expect(many.length).toBeGreaterThan(0);

    for (const entry of many) {
      // Every index in the range resolves back to this same event.
      for (let i = entry.rendererEntryStart; i <= entry.rendererEntryEnd; i++) {
        expect(manifestEntryForRendererIndex(manifest, i)?.eventId).toBe(entry.eventId);
      }
    }
  });

  it('lets an allowed delegation produce a route chip and a real child agent', () => {
    const routed = events.find((e) => e.type === 'gateway.routed');
    expect(routed).toBeDefined();
    const entry = manifest.entries.find((e) => e.eventId === routed!.eventId);
    expect(entry?.rendererEntryCount).toBeGreaterThan(1);
    expect(scene.subagents).toHaveLength(1);
  });
});

describe('cursor synchronization uses manifest lookup, not sequence division', () => {
  it('maps every rendered Canonical Event to the fraction of its own first entry', () => {
    for (const entry of manifest.entries.filter((e) => e.rendererEntryCount > 0)) {
      expect(rendererFractionForCaseSequence(manifest, entry.caseSequence)).toBeCloseTo(
        fractionForEntryIndex(entry.rendererEntryStart, manifest.rendererEntryCount),
        12,
      );
    }
  });

  it('disagrees with the forbidden ratio, which is the whole point', () => {
    // 60 Canonical Events compile to 69 renderer entries, so the two units are
    // not proportional. If this ever stopped disagreeing, the guard would be
    // proving nothing.
    const disagreements = manifest.entries
      .filter((e) => e.rendererEntryCount > 0)
      .filter((e) => {
        const forbidden = e.caseSequence / manifest.lastCaseSequence;
        const correct = rendererFractionForCaseSequence(manifest, e.caseSequence)!;
        return Math.abs(forbidden - correct) > 1 / manifest.rendererEntryCount;
      });
    expect(disagreements.length).toBeGreaterThan(0);
  });

  it('resolves an event that rendered nothing to the last thing that was drawn', () => {
    const invisible = manifest.entries.find((e) => e.rendererEntryCount === 0);
    expect(invisible).toBeDefined();
    const resolved = manifestEntryForCaseSequence(manifest, invisible!.caseSequence);
    // Never ahead of the operator: the cursor lands on evidence already reached.
    expect(resolved!.caseSequence).toBeLessThan(invisible!.caseSequence);
    expect(resolved!.rendererEntryCount).toBeGreaterThan(0);
  });

  it('round-trips renderer index → canonical event → renderer index', () => {
    for (let i = 0; i < manifest.rendererEntryCount; i++) {
      const entry = manifestEntryForRendererIndex(manifest, i);
      expect(entry, `renderer entry ${i} has no canonical event`).not.toBeNull();
      expect(i).toBeGreaterThanOrEqual(entry!.rendererEntryStart);
      expect(i).toBeLessThanOrEqual(entry!.rendererEntryEnd);
    }
  });
});

describe('semantic fidelity — the four failure-shaped outcomes stay apart', () => {
  it('records a sanitized screen as a success, never as a failure', () => {
    const compiled = compileZoetropeScene(
      synthetic([
        {
          type: 'armor.sanitized',
          correlations: { screenedInputId: 'in-1' },
          payloadRedacted: { findingClass: 'pii_removed' },
        },
      ]),
    );
    const entry = compiled.manifest.entries[0]!;
    expect(entry.outcome).toBe('sanitized');
    expect(entry.outcome).not.toBe('failed');
    expect(entry.label).toContain('sanitized');
    // Zoetrope must not draw it with the error styling: the control WORKED.
    expect(compiled.main).not.toContain('"is_error":true');
  });

  it('records a flagged screen as a success with a finding', () => {
    const compiled = compileZoetropeScene(
      synthetic([{ type: 'armor.flagged', correlations: { screenedInputId: 'in-1' } }]),
    );
    expect(compiled.manifest.entries[0]!.outcome).toBe('flagged');
    expect(compiled.main).not.toContain('"is_error":true');
  });

  it('records an Identity denial as denied, and says so in the label', () => {
    const denial = events.find((e) => e.type === 'identity.denied')!;
    const entry = manifest.entries.find((e) => e.eventId === denial.eventId)!;
    expect(entry.outcome).toBe('denied');
    expect(entry.outcome).not.toBe('failed');
    expect(entry.label).toContain('Identity denied');
  });

  it('records a Gateway denial as denied, and says so in the label', () => {
    const denial = events.find((e) => e.type === 'gateway.denied')!;
    const entry = manifest.entries.find((e) => e.eventId === denial.eventId)!;
    expect(entry.outcome).toBe('denied');
    expect(entry.label).toContain('Gateway denied');
  });

  it('records an Armor block as blocked, distinct from denied and failed', () => {
    const blocked = events.find((e) => e.type === 'armor.blocked')!;
    const entry = manifest.entries.find((e) => e.eventId === blocked.eventId)!;
    expect(entry.outcome).toBe('blocked');
    expect(entry.label).toContain('Armor blocked');
  });

  it('reserves `failed` for genuine execution failure', () => {
    const failed = manifest.entries.filter((e) => e.outcome === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(new Set(failed.map((e) => e.domain))).toEqual(new Set(['tool']));
  });
});

describe('security ordering', () => {
  it('emits no child agent spawn for a denied route', () => {
    const denial = events.find((e) => e.type === 'gateway.denied')!;
    const laterSpawns = events.filter(
      (e) => e.type === 'agent.spawned' && e.caseSequence > denial.caseSequence,
    );
    expect(laterSpawns).toEqual([]);
    expect(scene.invariantViolations).toEqual([]);
  });

  it('emits no ERP tool result after an Identity denial for that call', () => {
    const denial = events.find((e) => e.type === 'identity.denied')!;
    const callId = denial.correlations['toolCallId'];
    expect(callId).toBeDefined();
    // The requested ERP write is never carried out: the only resolution of that
    // call is the denial's own "not executed" record, and no tool.succeeded
    // exists for it anywhere in the Case.
    const executed = events.filter(
      (e) => e.correlations['toolCallId'] === callId && e.type === 'tool.succeeded',
    );
    expect(executed).toEqual([]);
  });

  it('flags a downstream use of a blocked input rather than hiding it', () => {
    const compiled = compileZoetropeScene(
      synthetic([
        { type: 'armor.blocked', correlations: { screenedInputId: 'in-bad' } },
        {
          type: 'memory.written',
          correlations: { screenedInputId: 'in-bad', memoryRecordId: 'mem-1' },
          payloadRedacted: { summary: 'derived from the blocked vendor email' },
        },
      ]),
    );
    expect(compiled.invariantViolations).toHaveLength(1);
    expect(compiled.invariantViolations[0]).toContain('blocked input in-bad');
  });

  it('does not flag a decision merely ABOUT a blocked input', () => {
    // `memory.rejected` names the blocked input in order to record that it was
    // refused. Recording a refusal is not using the content.
    const compiled = compileZoetropeScene(
      synthetic([
        { type: 'armor.blocked', correlations: { screenedInputId: 'in-bad' } },
        { type: 'memory.rejected', correlations: { screenedInputId: 'in-bad' } },
      ]),
    );
    expect(compiled.invariantViolations).toEqual([]);
    expect(outcomeAt(compiled.manifest, 1)).toBe('denied');
  });
});

describe('renderer-safe minimization', () => {
  const artifacts = [scene.main, ...scene.subagents.flatMap((s) => [s.meta, s.transcript])];

  it('emits no reasoning, prompt, or chain-of-thought field', () => {
    // The PRIMARY control for the upstream provenance panel, which renders
    // `↳ prompt` and `↳ thought` rows from exactly these fields.
    for (const artifact of artifacts) {
      for (const forbidden of ['"thinking"', '"prompt"', '"reasoning"', 'chain_of_thought']) {
        expect(artifact, `artifact contains ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('emits no credential, key, or token shape', () => {
    for (const artifact of artifacts) {
      expect(scanForSensitiveMaterial(artifact)).toEqual([]);
    }
  });

  it('emits no local filesystem path', () => {
    for (const artifact of artifacts) {
      expect(artifact).not.toMatch(/(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+\//);
    }
  });

  it('drops an already-redacted payload value rather than rendering the marker', () => {
    const compiled = compileZoetropeScene(
      synthetic([
        {
          type: 'tool.requested',
          correlations: { toolCallId: 'tc-1' },
          payloadRedacted: { tool: 'ERP.read', argumentsRedacted: '«redacted»' },
        },
      ]),
    );
    expect(compiled.main).not.toContain('«redacted»');
    expect(compiled.main).toContain('ERP.read');
  });

  it('truncates an overlong recorded summary instead of pasting it into the graph', () => {
    const compiled = compileZoetropeScene(
      synthetic([
        {
          type: 'memory.written',
          correlations: { memoryRecordId: 'mem-1' },
          payloadRedacted: { summary: 'x'.repeat(500) },
        },
      ]),
    );
    expect(compiled.manifest.entries[0]!.label.length).toBeLessThanOrEqual(121);
  });

  it('omits token usage entirely when it was never recorded', () => {
    // Unknown must render as unknown. An emitted `output_tokens: 0` would make
    // the renderer draw "0 tok" for an agent whose usage was simply not observed.
    const compiled = compileZoetropeScene(
      synthetic([{ type: 'agent.completed', correlations: { agentInstanceId: 'a-1' } }]),
    );
    expect(compiled.main).not.toContain('output_tokens');
  });

  it('carries recorded token usage when it exists', () => {
    const compiled = compileZoetropeScene(
      synthetic([
        {
          type: 'agent.completed',
          correlations: { agentInstanceId: 'a-1' },
          payloadRedacted: { outputTokens: 640 },
        },
      ]),
    );
    expect(compiled.main).toContain('"output_tokens":640');
  });
});

describe('renderer line ordering', () => {
  it('stamps every emitted line with a strictly increasing timestamp', () => {
    // Zoetrope merges the main transcript and the subagent sidecars by
    // timestamp. A tie would leave the merge order to sort stability across
    // files, which is not something the cursor mapping may depend on.
    const timestamps = [
      ...scene.main.trim().split('\n'),
      ...scene.subagents.flatMap((s) => s.transcript.trim().split('\n')),
    ]
      .filter((line) => line !== '')
      .map((line) => (JSON.parse(line) as { timestamp: string }).timestamp)
      .sort();
    expect(new Set(timestamps).size).toBe(timestamps.length);
  });

  it('keeps a line inside its own Canonical Event millisecond', () => {
    expect(orderedTimestamp('2026-08-26T09:01:00.000Z', 0)).toBe('2026-08-26T09:01:00.000000000Z');
    expect(orderedTimestamp('2026-08-26T09:01:00.250Z', 42)).toBe('2026-08-26T09:01:00.250000042Z');
  });

  it('refuses to stamp a line beyond the ordering budget', () => {
    expect(() => orderedTimestamp('2026-08-26T09:01:00.000Z', 1_000_000)).toThrow(RangeError);
  });

  it('rejects a timestamp that is not an ISO-8601 instant', () => {
    expect(() => orderedTimestamp('yesterday', 0)).toThrow(TypeError);
  });
});

describe('evidence back-references', () => {
  it('never drops the event that produced an entry', () => {
    for (const entry of manifest.entries) {
      expect(entry.evidenceEventIds).toContain(entry.eventId);
    }
  });

  it('cites the requesting event when a decision resolves a pending call', () => {
    const denial = events.find((e) => e.type === 'identity.denied')!;
    const request = events.find(
      (e) =>
        e.type === 'tool.requested' &&
        e.correlations['toolCallId'] === denial.correlations['toolCallId'],
    )!;
    const entry = manifest.entries.find((e) => e.eventId === denial.eventId)!;
    expect(entry.evidenceEventIds).toContain(request.eventId);
  });
});

describe('manifest entries are safe to hand to the renderer', () => {
  it('serializes to the shape the wasm ABI deserializes', () => {
    const entry: RenderManifestEntry = manifest.entries[0]!;
    const keys = Object.keys(entry).sort();
    expect(keys).toEqual([
      'caseSequence',
      'domain',
      'eventId',
      'evidenceEventIds',
      'label',
      'outcome',
      'rendererEntryCount',
      'rendererEntryEnd',
      'rendererEntryStart',
      'rendererFraction',
    ]);
  });
});

describe('model calls', () => {
  // Model calls are the family the enterprise Case never had: a local ADK run
  // is mostly Gemini requests, and the graph is useless if they are invisible.
  const at = (n: number): string => `2026-08-28T10:00:0${n}.000Z`;
  const modelEvent = (
    type: 'model.requested' | 'model.responded' | 'model.failed',
    caseSequence: number,
    payload: Record<string, unknown>,
  ): CanonicalEvent => ({
    eventId: `evt-model-${caseSequence}`,
    caseId: 'ses_1',
    caseSequence,
    sessionId: 'ses_1',
    sessionSequence: caseSequence,
    schemaVersion: '1.0.0',
    type,
    sourceTime: at(caseSequence),
    acceptedTime: at(caseSequence),
    actor: { kind: 'agent', id: 'root' },
    correlations: { agentInstanceId: 'root', modelCallId: 'm1' },
    payloadRedacted: payload,
  });

  it('draws a model call as a named chip that resolves', () => {
    const scene = compileZoetropeScene([
      modelEvent('model.requested', 0, { model: 'gemini-3.5-flash' }),
      modelEvent('model.responded', 1, {
        model: 'gemini-3.5-flash',
        finishReason: 'STOP',
        outputTokens: 71,
      }),
    ]);
    expect(scene.main).toContain('"name":"gemini-3.5-flash"');
    expect(scene.main).toContain('"tool_use_id":"m1"');
    expect(scene.main).toContain('71 out tok');
    expect(scene.manifest.entries.map((entry) => [entry.domain, entry.outcome])).toEqual([
      ['model', 'pending'],
      ['model', 'succeeded'],
    ]);
  });

  it('marks a model failure as an error the renderer will style as one', () => {
    const scene = compileZoetropeScene([
      modelEvent('model.requested', 0, { model: 'gemini-3.5-flash' }),
      modelEvent('model.failed', 1, { model: 'gemini-3.5-flash', errorClass: 'ResourceExhausted' }),
    ]);
    expect(scene.main).toContain('"is_error":true');
    expect(scene.main).toContain('ResourceExhausted');
    expect(scene.manifest.entries[1]?.outcome).toBe('failed');
  });

  it('omits a token count the framework never reported', () => {
    const scene = compileZoetropeScene([
      modelEvent('model.requested', 0, { model: 'gemini-3.5-flash' }),
      modelEvent('model.responded', 1, { model: 'gemini-3.5-flash', finishReason: 'STOP' }),
    ]);
    // "0 out tok" would report a measurement that was never taken.
    expect(scene.main).not.toContain('out tok');
  });

  it('names a local agent by its role when there is no version to cite', () => {
    const scene = compileZoetropeScene([
      {
        eventId: 'evt-spawn',
        caseId: 'ses_1',
        caseSequence: 0,
        sessionId: 'ses_1',
        sessionSequence: 0,
        schemaVersion: '1.0.0',
        type: 'agent.spawned',
        sourceTime: at(0),
        acceptedTime: at(0),
        actor: { kind: 'agent', id: 'root' },
        correlations: { agentInstanceId: 'root' },
        payloadRedacted: { role: 'vendor_onboarding' },
      },
    ]);
    expect(scene.main).toContain('vendor_onboarding');
    expect(scene.main).not.toContain('unknown version');
  });
});
