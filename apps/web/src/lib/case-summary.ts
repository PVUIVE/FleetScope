import type { CanonicalEvent } from '@fleetscope/event-schema';
import { CASE_MILESTONES, type CaseMilestone, type ObservableCaseState } from '@fleetscope/domain';
import type { FixtureCaseDescriptor } from '@fleetscope/fixtures';
import { caseAttention, type CaseAttention } from './status';
import type { EvidenceRecord } from './evidence-view';

/**
 * One Case, summarised for a list or a header.
 *
 * Everything here is read off the Observable Case State and the recorded events.
 * Nothing is hard-coded to CASE-1042: adding a second recorded Case adds a row,
 * it does not require a component change.
 */
export interface CaseSummary {
  readonly caseId: string;
  readonly title: string | null;
  readonly vendor: string | null;
  readonly owner: string | null;
  readonly agentVersionRef: string | null;
  readonly executionMode: string;
  readonly caseState: string | null;
  readonly currentMilestone: CaseMilestone | null;
  readonly completedMilestones: number;
  readonly totalMilestones: number;
  readonly attention: CaseAttention;
  readonly sessionCount: number;
  /** 1-based count of accepted Canonical Events. */
  readonly eventCount: number;
  readonly lastActivity: { readonly summary: string; readonly at: string } | null;
  readonly nextAction: string;
  readonly openIncidents: number;
  readonly pendingApprovals: number;
}

/**
 * What the Case is blocked on, in business English.
 *
 * A statement about recorded state, never a forecast. FleetScope does not
 * predict what an agent will do next.
 */
export function nextAction(state: ObservableCaseState): string {
  if (state.approvals.some((approval) => approval.state === 'pending')) {
    return 'An operator decision is required before the Case can continue.';
  }
  if (state.incidents.some((incident) => incident.state === 'open')) {
    return 'An open incident is recorded. Review it before the Case is considered settled.';
  }
  switch (state.caseState) {
    case 'completed':
      return 'Nothing — the Runtime reported a terminal result.';
    case 'failed':
      return 'The Case failed. The terminal evidence is in the Audit view.';
    case 'cancelled':
      return 'The Case was cancelled before it completed.';
    case 'approval_required':
      return 'An operator decision is required before the Case can continue.';
    case 'waiting':
      return 'The Runtime resumes when the awaited signal arrives.';
    case 'active':
      return 'The Runtime is progressing the current milestone.';
  }
}

export function summariseCase(
  caseId: string,
  descriptor: FixtureCaseDescriptor | null,
  state: ObservableCaseState | null,
  records: readonly EvidenceRecord[],
): CaseSummary {
  const openIncidents = (state?.incidents ?? []).filter(
    (incident) => incident.state === 'open' || incident.state === 'escalated',
  ).length;
  const pendingApprovals = (state?.approvals ?? []).filter(
    (approval) => approval.state === 'pending',
  ).length;

  const lastNarrative = [...records]
    .reverse()
    .find((record) => record.domain !== 'usage' && record.type !== 'tool.requested');

  return {
    caseId,
    title: descriptor?.title ?? null,
    vendor: descriptor?.vendor ?? null,
    owner: descriptor?.owner ?? null,
    agentVersionRef: descriptor?.agentVersionRef ?? null,
    executionMode: descriptor?.executionMode ?? 'recorded',
    caseState: state?.caseState ?? null,
    currentMilestone: state?.currentMilestone ?? null,
    completedMilestones: state?.completedMilestones.length ?? 0,
    totalMilestones: CASE_MILESTONES.length,
    attention: caseAttention({
      caseState: state?.caseState,
      openIncidents,
      pendingApprovals,
    }),
    sessionCount: state?.sessions.length ?? 0,
    // The cursor is 0-based; people count from one. `Event 60 of 60`, never 59.
    eventCount: state === null ? 0 : state.cursor.caseSequence + 1,
    lastActivity:
      lastNarrative === undefined
        ? null
        : { summary: lastNarrative.summary, at: lastNarrative.sourceTime },
    nextAction: state === null ? 'No recorded evidence for this Case.' : nextAction(state),
    openIncidents,
    pendingApprovals,
  };
}

// ── Milestone rail ───────────────────────────────────────────────────────────

export type RailStepKind = 'milestone' | 'boundary';

export interface RailStep {
  readonly kind: RailStepKind;
  readonly name: string;
  readonly state: 'done' | 'current' | 'pending';
  readonly meta: string | null;
  readonly caseSequence: number | null;
}

/**
 * The Case's business spine, with the Session boundaries that make a multi-week
 * Case legible.
 *
 * A simulated day boundary is labelled "Simulated Day N" in full — never
 * "Day 12", which would read as elapsed time the recording does not contain.
 */
export function caseRail(
  state: ObservableCaseState,
  events: readonly CanonicalEvent[],
): RailStep[] {
  const milestoneEventFor = new Map<string, CanonicalEvent>();
  for (const event of events) {
    if (event.type !== 'case.milestone_changed') continue;
    const milestone = event.payloadRedacted['milestone'];
    if (typeof milestone === 'string' && !milestoneEventFor.has(milestone)) {
      milestoneEventFor.set(milestone, event);
    }
  }

  const steps: RailStep[] = CASE_MILESTONES.map((milestone) => {
    const event = milestoneEventFor.get(milestone);
    return {
      kind: 'milestone' as const,
      name: milestone,
      state:
        milestone === state.currentMilestone
          ? ('current' as const)
          : state.completedMilestones.includes(milestone)
            ? ('done' as const)
            : ('pending' as const),
      meta: event === undefined ? null : `#${event.caseSequence + 1}`,
      caseSequence: event?.caseSequence ?? null,
    };
  });

  const boundaries: RailStep[] = events
    .filter(
      (event) =>
        event.type === 'runtime.resumed' &&
        typeof event.payloadRedacted['simulatedDayBoundary'] === 'number',
    )
    .map((event) => ({
      kind: 'boundary' as const,
      name: `Simulated Day ${String(event.payloadRedacted['simulatedDayBoundary'])}`,
      state: 'done' as const,
      meta: `${event.sessionId ?? 'case-level'} · #${event.caseSequence + 1}`,
      caseSequence: event.caseSequence,
    }));

  // Boundaries are interleaved by position so the rail reads chronologically.
  const merged = [...steps, ...boundaries].sort((a, b) => {
    if (a.caseSequence === null) return 1;
    if (b.caseSequence === null) return -1;
    return a.caseSequence - b.caseSequence;
  });
  const unreached = steps.filter((step) => step.caseSequence === null);
  return [...merged.filter((step) => step.caseSequence !== null), ...unreached];
}
