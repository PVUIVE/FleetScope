import { describe, expect, it } from 'vitest';
import { validateCanonicalStream } from '@fleetscope/event-schema';
import { project } from '@fleetscope/projector';
import {
  loadCanonicalEvents,
  loadCaseDescriptor,
  loadEvidenceManifest,
  loadExpectedState,
} from '@fleetscope/fixtures/node';

const CASE_ID = 'CASE-1042';
const events = loadCanonicalEvents(CASE_ID);
const manifest = loadEvidenceManifest(CASE_ID);
const descriptor = loadCaseDescriptor(CASE_ID);

describe('CASE-1042 fixture integrity', () => {
  it('parses every line as a valid Canonical Event', () => {
    expect(events.length).toBeGreaterThan(0);
  });

  it('is a well-formed single-Case canonical stream', () => {
    expect(validateCanonicalStream(events)).toEqual([]);
  });

  it('matches the manifest event count and bounds', () => {
    expect(events.length).toBe(manifest.eventCount);
    expect(events[0]?.caseSequence).toBe(manifest.firstCaseSequence);
    expect(events.at(-1)?.caseSequence).toBe(manifest.lastCaseSequence);
  });

  it('spans the three declared Sessions', () => {
    const sessionIds = new Set(
      events.map((e) => e.sessionId).filter((s): s is string => s !== null),
    );
    expect([...sessionIds].sort()).toEqual(['sess-001', 'sess-002', 'sess-003']);
    expect(descriptor.sessions).toEqual(['sess-001', 'sess-002', 'sess-003']);
  });

  it('every manifest marker points at a real event of the stated type', () => {
    for (const marker of manifest.platformEvidence) {
      const event = events.find((e) => e.eventId === marker.eventId);
      expect(event, `marker ${marker.id}`).toBeDefined();
      expect(event?.type).toBe(marker.eventType);
      expect(event?.caseSequence).toBe(marker.caseSequence);
    }
  });

  it('contains no secrets or PII markers', () => {
    expect(descriptor.provenance.containsSecrets).toBe(false);
    expect(descriptor.provenance.containsPii).toBe(false);
    const text = JSON.stringify(events);
    for (const pattern of [
      /AIza[0-9A-Za-z_-]{20,}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /sk-[A-Za-z0-9]{20,}/,
    ]) {
      expect(text).not.toMatch(pattern);
    }
  });
});

describe('CASE-1042 projection', () => {
  const result = project(events);

  it('matches the blessed terminal state hash', () => {
    expect(result.stateHash).toBe(loadExpectedState(CASE_ID).terminalStateHash);
  });

  it('matches every blessed prefix hash', () => {
    for (const prefix of loadExpectedState(CASE_ID).prefixHashes) {
      expect(
        project(events, { throughCaseSequence: prefix.caseSequence }).stateHash,
        `prefix at caseSequence ${prefix.caseSequence} (${prefix.eventId})`,
      ).toBe(prefix.stateHash);
    }
  });

  it('reaches the activation milestone in a completed Case', () => {
    expect(result.state.currentMilestone).toBe('activation');
    expect(result.state.caseState).toBe('completed');
  });

  it('records no invariant violations', () => {
    expect(result.state.invariantViolations).toEqual([]);
  });

  it('holds the Model Armor block, and nothing downstream uses that input (Invariant 3)', () => {
    expect(result.state.blockedInputIds).toEqual(manifest.blockedInputIds);
    const blockIndex = events.findIndex((e) => e.type === 'armor.blocked');
    const blockedId = events[blockIndex]?.correlations['screenedInputId'];
    const downstreamUse = events
      .slice(blockIndex + 1)
      .filter(
        (e) =>
          e.correlations['screenedInputId'] === blockedId &&
          (e.type.startsWith('tool.') || e.type === 'memory.written'),
      );
    expect(downstreamUse).toEqual([]);
  });

  it('keeps every intervention lifecycle state distinct (Invariant 10)', () => {
    const intervention = result.state.interventions.find((i) => i.interventionId === 'itv-001');
    expect(intervention?.state).toBe('succeeded');
    // The success must be backed by an authoritative Runtime operation, not by
    // the request having been made.
    expect(intervention?.runtimeOperationId).toBe('op-ctl-001');
    const lifecycle = manifest.interventions[0]?.lifecycle.map((l) => l.state);
    expect(lifecycle).toEqual(['proposed', 'authorized', 'requested', 'acknowledged', 'succeeded']);
  });

  it('binds the approval to the exact evidence prefix it was raised at', () => {
    const approval = result.state.approvals.find((a) => a.approvalId === 'apr-001');
    expect(approval?.state).toBe('approved');
    expect(approval?.boundCaseSequence).toBe(manifest.approvals[0]?.openedAtCaseSequence);
  });

  it('the Case stays bound to the Agent Version it launched with (Invariant 2)', () => {
    expect(result.state.caseRecord?.agentVersionRef).toBe(descriptor.agentVersionRef);
  });

  it('surfaces both an identity allow and an identity denial', () => {
    const outcomes = result.state.platformBadges
      .filter((b) => b.service === 'identity')
      .map((b) => b.decision.outcome);
    expect(outcomes).toContain('allowed');
    expect(outcomes).toContain('denied');
  });

  it('every badge carries the event id that produced it (Invariant 6)', () => {
    for (const badge of result.state.platformBadges) {
      expect(events.some((e) => e.eventId === badge.evidenceEventId)).toBe(true);
    }
  });

  it('projects an earlier prefix without the later evidence', () => {
    const early = project(events, { throughCaseSequence: 5 });
    expect(early.state.currentMilestone).toBe('review');
    expect(early.state.cursor.atEdge).toBe(false);
    expect(early.state.interventions).toEqual([]);
  });
});
