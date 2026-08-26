import { describe, expect, it } from 'vitest';
import { loadCanonicalEvents } from '@fleetscope/fixtures/node';
import { compileScenario, interimJsonlAdapter } from '../src/index.js';

const events = loadCanonicalEvents('CASE-1042');
const transcript = compileScenario(events);

describe('compileScenario', () => {
  it('is deterministic for the same input', () => {
    expect(JSON.stringify(compileScenario(events))).toBe(JSON.stringify(transcript));
  });

  it('is insensitive to input order', () => {
    expect(JSON.stringify(compileScenario([...events].reverse()))).toBe(JSON.stringify(transcript));
  });

  it('emits one entry per canonical event, losing nothing', () => {
    expect(transcript.entries).toHaveLength(events.length);
  });

  it('keeps a back-reference to canonical evidence on every entry', () => {
    const eventIds = new Set(events.map((e) => e.eventId));
    for (const entry of transcript.entries) {
      expect(eventIds.has(entry.fleetscope.eventId)).toBe(true);
      expect(entry.fleetscope.caseSequence).toBeGreaterThanOrEqual(0);
    }
  });

  it('preserves entry order by caseSequence', () => {
    const sequences = transcript.entries.map((e) => e.fleetscope.caseSequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
  });

  it('builds the agent tree with the Case as the root', () => {
    const root = transcript.agents.find((a) => a.parentId === null);
    expect(root?.id).toBe('case-root');
    const logistics = transcript.agents.find((a) => a.id === 'agent-logistics-1');
    expect(logistics?.parentId).toBe('agent-orchestrator-1');
  });

  it('pairs every tool_pending with a tool_result by callId', () => {
    const pending = transcript.entries.filter((e) => e.kind === 'tool_pending');
    const results = new Set(
      transcript.entries.filter((e) => e.kind === 'tool_result').map((e) => e.callId),
    );
    expect(pending.length).toBeGreaterThan(0);
    for (const call of pending) {
      expect(results.has(call.callId), `unpaired call ${call.callId}`).toBe(true);
    }
  });

  it('renders platform decisions as named tool chips, not custom node types', () => {
    const toolNames = new Set(transcript.entries.map((e) => e.toolName).filter(Boolean));
    expect(toolNames).toContain('AgentIdentity.authorize');
    expect(toolNames).toContain('AgentGateway.route');
    expect(toolNames).toContain('ModelArmor.screen');
    expect(toolNames).toContain('MemoryBank.recall');
  });

  it('flags denial, block, and failure entries as errors', () => {
    const errored = transcript.entries
      .filter((e) => e.isError === true)
      .map((e) => e.fleetscope.eventType);
    expect(errored).toContain('armor.blocked');
    expect(errored).toContain('identity.denied');
    expect(errored).toContain('gateway.denied');
    expect(errored).toContain('tool.failed');
  });
});

describe('interimJsonlAdapter', () => {
  it('emits a header line followed by one line per entry', () => {
    const lines = interimJsonlAdapter.render(transcript).trim().split('\n');
    expect(lines).toHaveLength(transcript.entries.length + 1);
    expect(JSON.parse(lines[0]!).type).toBe('header');
    expect(JSON.parse(lines[1]!).type).toBe('entry');
  });

  it('declares itself unverified against any upstream schema', () => {
    expect(interimJsonlAdapter.description).toMatch(/not verified/i);
  });
});
