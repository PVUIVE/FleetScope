import { describe, expect, it } from 'vitest';
import { loadCanonicalEvents } from '@fleetscope/fixtures/node';
import { project } from '@fleetscope/projector';
import { compileZoetropeScene } from '@fleetscope/scenario-compiler';
import { buildEvidenceRecords, incidentViews, narrativeActivity } from '../src/lib/evidence-view';
import { caseRail, nextAction, summariseCase } from '../src/lib/case-summary';
import { demoPhases } from '../src/lib/demo-phases';
import { agentTree } from '../src/lib/agent-tree';
import { answerCaseQuestions } from '../src/lib/case-view';
import { caseAttention, caseStatus, controlStatus, interventionStatus } from '../src/lib/status';
import { planAppend } from '../src/lib/live-proof';

/**
 * The presentation layer, tested against the real recorded Case.
 *
 * These are the claims the UI makes on screen. A regression here is a demo that
 * says something the evidence does not support, which is the one class of bug
 * this product cannot ship.
 */

const CASE_ID = 'CASE-1042';
const events = loadCanonicalEvents(CASE_ID);
const projection = project(events);
const state = projection.state;
const manifest = compileZoetropeScene(events).manifest;
const records = buildEvidenceRecords(events, manifest);

describe('status vocabulary', () => {
  it('maps every domain state to a word, a glyph and a tone', () => {
    expect(caseStatus('waiting').label).toBe('Waiting');
    expect(caseStatus('approval_required').label).toBe('Needs Approval');
    expect(controlStatus('denied').label).toBe('Denied');
    expect(controlStatus('blocked').label).toBe('Blocked');
    // A success with a finding must not read as a failure.
    expect(controlStatus('sanitized').tone).toBe('warn');
    expect(controlStatus('flagged').tone).toBe('warn');
    expect(controlStatus('denied').tone).toBe('deny');
  });

  it('never invents a state for a value it does not know', () => {
    expect(caseStatus('teleported').label).toBe('Unknown');
    expect(caseStatus(null).label).toBe('Unknown');
    expect(caseStatus(undefined).tone).toBe('unknown');
  });

  it('keeps the intervention lifecycle states distinct', () => {
    const labels = ['requested', 'acknowledged', 'succeeded', 'timed_out'].map(
      (value) => interventionStatus(value).label,
    );
    expect(new Set(labels).size).toBe(4);
    // A timeout is an unknown outcome, not a failure.
    expect(interventionStatus('timed_out').tone).not.toBe('deny');
  });

  it('ranks a Case that blocks a person above one that is merely running', () => {
    const blocked = caseAttention({ caseState: 'active', openIncidents: 0, pendingApprovals: 1 });
    const running = caseAttention({ caseState: 'active', openIncidents: 0, pendingApprovals: 0 });
    expect(blocked.priority).toBeGreaterThan(running.priority);
    expect(blocked.flags.map((flag) => flag.label)).toContain('Needs Approval');
  });
});

describe('evidence records', () => {
  it('covers every manifest entry of the recorded Case', () => {
    expect(records).toHaveLength(manifest.entries.length);
    expect(records.map((record) => record.eventId)).toEqual(
      manifest.entries.map((entry) => entry.eventId),
    );
  });

  it('numbers events for humans from one', () => {
    expect(records[0]?.caseSequence).toBe(0);
    expect(records[0]?.humanIndex).toBe(1);
    expect(records.at(-1)?.humanIndex).toBe(events.length);
  });

  it('labels synthetic control decisions as synthetic, never as live', () => {
    const armor = records.find((record) => record.type === 'armor.blocked');
    expect(armor?.mode).toBe('synthetic');
    const identity = records.find((record) => record.type === 'identity.denied');
    expect(identity?.mode).toBe('synthetic');
    expect(records.some((record) => record.mode === 'live')).toBe(false);
  });

  it('describes a policy denial as a denial, not as a crash', () => {
    const denial = records.find((record) => record.type === 'identity.denied');
    expect(denial?.outcome).toBe('denied');
    expect(denial?.summary).toContain('denied');
    expect(denial?.summary).toContain('No downstream action followed');
  });

  it('never exposes a raw prompt or an unredacted argument', () => {
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain('AIza');
    expect(serialized).not.toContain('Bearer ');
    expect(serialized).not.toContain('-----BEGIN');
  });

  it('keeps plumbing out of the business narrative', () => {
    const activity = narrativeActivity(records, 8);
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.some((row) => row.type === 'tool.requested')).toBe(false);
    // Newest first.
    expect(activity[0]!.caseSequence).toBeGreaterThan(activity.at(-1)!.caseSequence);
  });
});

describe('incident views', () => {
  it('explains why each incident opened and what policy decided', () => {
    const views = incidentViews(state, events);
    expect(views.length).toBeGreaterThan(0);
    const repeated = views.find((view) => view.incidentClass === 'repeated_tool_failure');
    expect(repeated?.detectedBecause).toContain('same normalized error class');
    expect(repeated?.policy?.disposition).toBe('auto_act');
    expect(repeated?.firstEvidenceCaseSequence).not.toBeNull();
    expect(repeated?.interventionIds.length).toBeGreaterThan(0);
  });

  it('does not claim a recovery for an incident that had none', () => {
    const advisory = incidentViews(state, events).find(
      (view) => view.incidentClass === 'context_drift',
    );
    expect(advisory?.interventionIds).toEqual([]);
  });
});

describe('case summary', () => {
  const summary = summariseCase(CASE_ID, null, state, records);

  it('counts canonical events from one', () => {
    expect(summary.eventCount).toBe(events.length);
  });

  it('states what the Case is blocked on without predicting', () => {
    expect(nextAction(state)).toMatch(/incident|Runtime|operator/);
  });

  it('names a simulated day boundary in full', () => {
    const rail = caseRail(state, events);
    const boundary = rail.find((step) => step.kind === 'boundary');
    expect(boundary?.name).toBe('Simulated Day 12');
  });

  it('keeps unreached milestones in the rail without inventing a position', () => {
    const rail = caseRail(state, events);
    expect(rail.filter((step) => step.kind === 'milestone')).toHaveLength(5);
  });
});

describe('the six workspace questions', () => {
  const answers = answerCaseQuestions(state, records);

  it('answers all six', () => {
    expect(answers).toHaveLength(6);
  });

  it('backs every answered question with a Canonical Event, except the forward look', () => {
    for (const answer of answers.slice(0, 5)) {
      expect(answer.evidenceEventId).not.toBeNull();
      expect(answer.humanIndex).toBeGreaterThan(0);
    }
    expect(answers.at(-1)?.evidenceEventId).toBeNull();
  });
});

describe('demo phases', () => {
  const phases = demoPhases(events, manifest);

  it('anchors every phase to a real Canonical Event that the renderer draws', () => {
    const drawable = new Set(
      manifest.entries.filter((entry) => entry.rendererEntryCount > 0).map((e) => e.eventId),
    );
    expect(phases.length).toBeGreaterThan(5);
    for (const phase of phases) {
      expect(drawable.has(phase.eventId)).toBe(true);
      expect(events.some((event) => event.eventId === phase.eventId)).toBe(true);
    }
  });

  it('is chronological and numbered from one', () => {
    expect(phases.map((phase) => phase.index)).toEqual(phases.map((_, i) => i + 1));
    const sequences = phases.map((phase) => phase.caseSequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
  });

  it('drops a phase whose evidence does not exist rather than guessing', () => {
    const truncated = events.filter((event) => event.caseSequence <= 5);
    const smallManifest = compileZoetropeScene(truncated).manifest;
    const smallPhases = demoPhases(truncated, smallManifest);
    expect(smallPhases.some((phase) => phase.id === 'armor')).toBe(false);
  });
});

describe('agent tree', () => {
  const nodes = agentTree(state, events);

  it('reads delegation depth from the recorded parent link', () => {
    expect(nodes.length).toBeGreaterThan(1);
    expect(nodes[0]?.depth).toBe(0);
    expect(nodes.some((node) => node.depth === 1)).toBe(true);
  });

  it('attributes recorded failures to the agent that produced them', () => {
    const logistics = nodes.find((node) => node.role === 'logistics');
    expect(logistics?.failureCount).toBe(3);
  });

  it('leaves an unmeasured token count unknown rather than zero', () => {
    for (const node of nodes) {
      expect(node.outputTokens === null || node.outputTokens > 0).toBe(true);
    }
  });
});

describe('live proof append planning', () => {
  /** The exact Source Event shape the bounded endpoint returns on success. */
  const sourceEvents = [
    {
      dedupeKey: 'live:CASE-1042:orchestrator-compliance-decision:requested',
      caseId: CASE_ID,
      sessionId: 'sess-003',
      type: 'tool.requested',
      sourceTime: '2026-09-08T11:00:00.000Z',
      ingestionTime: '2026-09-08T11:00:00.000Z',
      actor: { kind: 'agent', id: 'agent-orchestrator-1' },
      correlations: {
        caseId: CASE_ID,
        toolCallId: 'tc-live-1',
        agentInstanceId: 'agent-orchestrator-1',
      },
      payload: { tool: 'Gemini.generate', argumentsRedacted: '[redacted]' },
    },
    {
      dedupeKey: 'live:CASE-1042:orchestrator-compliance-decision:succeeded',
      caseId: CASE_ID,
      sessionId: 'sess-003',
      type: 'tool.succeeded',
      sourceTime: '2026-09-08T11:00:00.000Z',
      ingestionTime: '2026-09-08T11:00:00.000Z',
      actor: { kind: 'agent', id: 'agent-orchestrator-1' },
      correlations: {
        caseId: CASE_ID,
        toolCallId: 'tc-live-1',
        agentInstanceId: 'agent-orchestrator-1',
      },
      payload: {
        tool: 'Gemini.generate',
        durationMs: 1700,
        resultSummary: 'compliant · packet matches the recorded Case context',
        classification: 'compliant',
        confidence: 0.95,
        executionMode: 'live',
      },
    },
  ];

  const plan = planAppend(events, sourceEvents, CASE_ID);

  it('accepts the append without a single problem', () => {
    expect(plan.problems).toEqual([]);
    expect(plan.appendedEvents).toHaveLength(2);
  });

  it('continues the recorded sequences instead of renumbering settled evidence', () => {
    expect(plan.appendedEvents[0]?.caseSequence).toBe(events.length);
    expect(plan.stream.slice(0, events.length)).toEqual(events);
  });

  it('grows the renderer timeline and produces the matching manifest delta', () => {
    expect(plan.rendererEntriesAfter).toBeGreaterThan(plan.rendererEntriesBefore);
    expect(plan.newManifestEntries).toHaveLength(2);
    expect(plan.mainTail.length).toBeGreaterThan(0);
  });

  it('marks the appended evidence as a live proof, not as recorded', () => {
    const appendedManifest = compileZoetropeScene(plan.stream).manifest;
    const appendedRecords = buildEvidenceRecords(plan.stream, appendedManifest).filter((record) =>
      plan.appendedEvents.some((event) => event.eventId === record.eventId),
    );
    expect(appendedRecords.some((record) => record.mode === 'live')).toBe(true);
  });

  it('refuses a late arrival rather than reordering settled evidence', () => {
    const late = [{ ...sourceEvents[0], sourceTime: '2026-08-26T09:00:00.000Z' }];
    const latePlan = planAppend(events, late, CASE_ID);
    expect(latePlan.appendedEvents).toHaveLength(0);
    expect(latePlan.problems.join(' ')).toContain('rejected');
  });
});
