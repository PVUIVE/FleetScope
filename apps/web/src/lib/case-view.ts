import type { CanonicalEvent } from '@fleetscope/event-schema';
import { CASE_MILESTONES, type CaseMilestone, type ObservableCaseState } from '@fleetscope/domain';

/**
 * The Case Workspace projection.
 *
 * The Case Workspace is a BUSINESS view of the same Observable Case State the
 * Cockpit renders. A procurement manager opens it to answer six questions, and
 * everything below exists to answer exactly those:
 *
 *   1. What milestone are we on?
 *   2. What happened most recently?
 *   3. What is the agent waiting for?
 *   4. What needs me now?
 *   5. What trusted context survives?
 *   6. What happens next?
 *
 * Pure: derived from recorded evidence, never from a clock or a guess. Where the
 * evidence does not answer a question, the answer is "not recorded" — never a
 * plausible-sounding default, which is the same class of error as rendering an
 * unknown token count as zero.
 */

export interface CaseAnswer {
  readonly question: string;
  readonly answer: string;
  /** The Canonical Event this answer rests on, so it can be inspected. */
  readonly evidenceEventId: string | null;
  readonly caseSequence: number | null;
  /** True when the evidence simply does not answer it. */
  readonly unknown: boolean;
}

const NOT_RECORDED = 'Not recorded';

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const lastOfType = (
  events: readonly CanonicalEvent[],
  types: readonly string[],
): CanonicalEvent | null => {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (types.includes(event.type)) return event;
  }
  return null;
};

/** Human wording for an event, reusing the product's own vocabulary. */
function describe(event: CanonicalEvent): string {
  const p = event.payloadRedacted;
  switch (event.type) {
    case 'tool.succeeded':
      return `${str(p['tool']) ?? 'A tool call'} returned: ${str(p['resultSummary']) ?? 'a recorded result'}`;
    case 'tool.failed':
      return `${str(p['tool']) ?? 'A tool call'} failed (${str(p['errorClass']) ?? 'cause not recorded'})`;
    case 'memory.written':
      return `Recorded to Memory: ${str(p['summary']) ?? 'a fact'}`;
    case 'memory.recalled':
      return `Recalled from Memory: ${str(p['summary']) ?? 'a fact'}`;
    case 'identity.denied':
      return `Agent Identity denied access to ${str(p['resource']) ?? 'a protected resource'}`;
    case 'gateway.denied':
      return `Agent Gateway refused a delegation (${str(p['requestedCapability']) ?? 'capability not recorded'})`;
    case 'armor.blocked':
      return `Model Armor blocked incoming content (${str(p['findingClass']) ?? 'finding not recorded'})`;
    case 'armor.sanitized':
      return `Model Armor sanitized incoming content and allowed it through`;
    case 'intervention.succeeded':
      return 'A bounded recovery was applied and the Runtime confirmed it';
    case 'intervention.failed':
      return 'A bounded recovery was attempted and the Runtime reported failure';
    case 'incident.opened':
      return `An incident opened: ${str(p['incidentClass']) ?? 'unclassified'}`;
    case 'incident.resolved':
      return `The incident resolved: ${str(p['resolution']) ?? 'resolved'}`;
    case 'agent.completed':
      return 'A delegated agent finished its work';
    case 'runtime.completed':
      return 'The Runtime reported the Case complete';
    case 'human_escalation.resolved':
      return `An approval was ${str(p['decision']) ?? 'resolved'}`;
    default:
      return event.type;
  }
}

/** Events that represent visible business progress rather than plumbing. */
const PROGRESS_TYPES = [
  'tool.succeeded',
  'tool.failed',
  'memory.written',
  'memory.recalled',
  'identity.denied',
  'gateway.denied',
  'armor.blocked',
  'armor.sanitized',
  'incident.opened',
  'incident.resolved',
  'intervention.succeeded',
  'intervention.failed',
  'agent.completed',
  'runtime.completed',
  'human_escalation.resolved',
];

export function answerCaseQuestions(
  state: ObservableCaseState,
  events: readonly CanonicalEvent[],
): CaseAnswer[] {
  const answers: CaseAnswer[] = [];

  const push = (question: string, answer: string | null, event: CanonicalEvent | null): void => {
    answers.push({
      question,
      answer: answer ?? NOT_RECORDED,
      evidenceEventId: event?.eventId ?? null,
      caseSequence: event?.caseSequence ?? null,
      unknown: answer === null,
    });
  };

  // 1. Milestone.
  const milestoneEvent = lastOfType(events, ['case.milestone_changed']);
  push(
    'What milestone are we on?',
    state.currentMilestone === null
      ? null
      : `${state.currentMilestone} (${state.completedMilestones.length} of ${CASE_MILESTONES.length - 1} earlier milestones complete)`,
    milestoneEvent,
  );

  // 2. Most recent progress.
  const progress = lastOfType(events, PROGRESS_TYPES);
  push('What happened most recently?', progress === null ? null : describe(progress), progress);

  // 3. Waiting on what.
  const waiting = lastOfType(events, ['runtime.waiting', 'runtime.resumed', 'runtime.completed']);
  const waitingAnswer =
    waiting === null || waiting.type !== 'runtime.waiting'
      ? state.caseState === 'completed'
        ? 'Nothing — the Case is complete'
        : null
      : `${str(waiting.payloadRedacted['waitingFor']) ?? 'an external signal'}` +
        (str(waiting.payloadRedacted['expectedSignal']) !== undefined
          ? ` (expects ${str(waiting.payloadRedacted['expectedSignal'])})`
          : '');
  push('What is the agent waiting for?', waitingAnswer, waiting);

  // 4. What needs a human.
  const pending = state.approvals.filter((approval) => approval.state === 'pending');
  const approvalEvent = lastOfType(events, ['human_escalation.opened']);
  push(
    'What needs me now?',
    pending.length === 0
      ? 'Nothing is outstanding for an operator'
      : `${pending.length} approval${pending.length === 1 ? '' : 's'}: ${pending.map((a) => a.actionTemplate).join(', ')}`,
    pending.length === 0 ? null : approvalEvent,
  );

  // 5. Trusted context. Provenance is the point: an unsourced fact is not
  //    trusted context, it is a rumour.
  const memoryEvent = lastOfType(events, ['memory.written', 'memory.recalled']);
  push(
    'What trusted context survives?',
    state.memoryRecords.length === 0
      ? null
      : state.memoryRecords
          .map((record) => `${record.summary} (from ${record.sourceEventId})`)
          .join(' · '),
    memoryEvent,
  );

  // 6. What happens next. Derived from the recorded state, never predicted.
  push('What happens next?', nextStep(state), null);

  return answers;
}

/**
 * The next step, read off the recorded state.
 *
 * This is a statement about what the Case is currently blocked on, not a
 * forecast. FleetScope does not predict what an agent will do.
 */
function nextStep(state: ObservableCaseState): string | null {
  if (state.approvals.some((approval) => approval.state === 'pending')) {
    return 'An operator decision is required before the Case can continue';
  }
  switch (state.caseState) {
    case 'completed':
      return 'Nothing — the Runtime reported a terminal result';
    case 'failed':
      return 'The Case failed. Review the Audit view for the terminal evidence';
    case 'cancelled':
      return 'The Case was cancelled';
    case 'approval_required':
      return 'An operator decision is required before the Case can continue';
    case 'waiting':
      return 'The Runtime resumes when the awaited signal arrives';
    case 'active':
      return 'The Runtime is progressing the current milestone';
  }
}

export interface MilestoneStep {
  readonly milestone: CaseMilestone;
  readonly state: 'done' | 'current' | 'pending';
}

/** The milestone rail. The Case's business spine, not its event count. */
export function milestoneRail(state: ObservableCaseState): MilestoneStep[] {
  return CASE_MILESTONES.map((milestone) => ({
    milestone,
    state:
      milestone === state.currentMilestone
        ? ('current' as const)
        : state.completedMilestones.includes(milestone)
          ? ('done' as const)
          : ('pending' as const),
  }));
}

export interface ActivityRow {
  readonly caseSequence: number;
  readonly eventId: string;
  readonly at: string;
  readonly sessionId: string | null;
  readonly description: string;
}

/** The most recent recorded activity, newest first. */
export function recentActivity(events: readonly CanonicalEvent[], limit = 8): ActivityRow[] {
  return events
    .filter((event) => PROGRESS_TYPES.includes(event.type))
    .slice(-limit)
    .reverse()
    .map((event) => ({
      caseSequence: event.caseSequence,
      eventId: event.eventId,
      at: event.sourceTime,
      sessionId: event.sessionId,
      description: describe(event),
    }));
}

/**
 * The simulated-day boundary between two Sessions.
 *
 * A Case that spans weeks is the whole point of the Case/Session distinction —
 * but FleetScope must say "Simulated Day 12", never "12 days ago". The recorded
 * evidence carries the simulated boundary explicitly; nothing is inferred from
 * the gap between timestamps.
 */
export function simulatedDayBoundaries(
  events: readonly CanonicalEvent[],
): { readonly day: number; readonly caseSequence: number; readonly sessionId: string | null }[] {
  return events
    .filter(
      (event) =>
        event.type === 'runtime.resumed' &&
        typeof event.payloadRedacted['simulatedDayBoundary'] === 'number',
    )
    .map((event) => ({
      day: event.payloadRedacted['simulatedDayBoundary'] as number,
      caseSequence: event.caseSequence,
      sessionId: event.sessionId,
    }));
}
