import { describe, expect, it } from 'vitest';
import { loadRecordedSessionEvents, GOLDEN_SESSION } from '@fleetscope/fixtures/node';
import { landingSession } from '../src/lib/landing-session';

/**
 * The landing page is the one surface a visitor sees before the product, so
 * this is where a marketing claim the evidence cannot support gets caught.
 * Every assertion compares what the page will print against the recording it
 * was built from.
 */
const events = loadRecordedSessionEvents(GOLDEN_SESSION);
const data = landingSession();

describe('landing page claims', () => {
  it('reports the recorded run, not a rewritten one', () => {
    expect(data.session.eventCount).toBe(events.length);
    expect(data.framework).toBe('google-adk');
    expect(data.sessionId).toBe(events[0]?.caseId);
  });

  it('names only agents that actually ran', () => {
    const recorded = new Set(
      events.map((event) => event.correlations['agentInstanceId']).filter(Boolean),
    );
    for (const agent of data.agents) expect(recorded.has(agent.id)).toBe(true);
  });

  it('shows a failure only because one was recorded', () => {
    expect(data.session.errorCount).toBeGreaterThan(0);
    expect(data.highlights.failure).not.toBeNull();
    const recordedClasses = events
      .map((event) => event.payloadRedacted['errorClass'])
      .filter((value): value is string => typeof value === 'string');
    expect(recordedClasses).toContain(data.highlights.failure?.errorClass);
  });

  it('shows a handoff only because one was recorded', () => {
    expect(data.highlights.handoff?.parentAgentId).not.toBeNull();
    expect(data.session.handoffCount).toBe(1);
  });

  it('quotes only event types the canonical stream contains', () => {
    const recorded = new Set(events.map((event) => event.type));
    for (const line of data.rawLogLines) expect(recorded.has(line as never)).toBe(true);
  });

  it('builds every spine and context row from a recorded event', () => {
    const ids = new Set(events.map((event) => event.eventId));
    for (const row of [...data.spine, ...data.failureContext]) {
      expect(ids.has(row.sourceEventId)).toBe(true);
    }
  });

  it('states what was real in the recording', () => {
    expect(data.provenance).toMatch(/Google ADK/);
    expect(data.provenance).toMatch(/local fixtures/);
  });

  it('prints no duration it did not measure', () => {
    expect(data.session.durationMs).not.toBeNull();
    for (const row of data.spine) {
      if (row.durationMs !== null) expect(row.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
