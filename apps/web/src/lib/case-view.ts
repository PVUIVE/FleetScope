import type { ObservableCaseState } from '@fleetscope/domain';
import type { EvidenceRecord } from './evidence-view';
import { nextAction } from './case-summary';

/**
 * The six questions the Case Workspace exists to answer.
 *
 * A procurement manager opens this screen to find out where a multi-week vendor
 * onboarding stands. They should not have to read an event schema to do it, so
 * every answer below is business English backed by the exact Canonical Event it
 * rests on — which is also what stops the screen becoming a summary nobody can
 * check.
 *
 * Where the evidence does not answer a question, the answer is "Not recorded" —
 * never a plausible-sounding default, which is the same class of error as
 * rendering an unknown token count as zero.
 */

export interface CaseAnswer {
  readonly question: string;
  readonly answer: string;
  /** The Canonical Event this answer rests on, so it can be inspected. */
  readonly evidenceEventId: string | null;
  readonly humanIndex: number | null;
  readonly unknown: boolean;
}

/** Milestone names are lowercase domain tokens; operators read English. */
const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

const lastRecordOf = (
  records: readonly EvidenceRecord[],
  types: readonly string[],
): EvidenceRecord | null => {
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index]!;
    if (types.includes(record.type)) return record;
  }
  return null;
};

export function answerCaseQuestions(
  state: ObservableCaseState,
  records: readonly EvidenceRecord[],
): CaseAnswer[] {
  const answers: CaseAnswer[] = [];
  const push = (question: string, answer: string | null, record: EvidenceRecord | null): void => {
    answers.push({
      question,
      answer: answer ?? 'Not recorded',
      evidenceEventId: record?.eventId ?? null,
      humanIndex: record?.humanIndex ?? null,
      unknown: answer === null,
    });
  };

  // 1. What is happening right now.
  const progress = lastRecordOf(records, [
    'tool.succeeded',
    'tool.failed',
    'runtime.waiting',
    'runtime.resumed',
    'runtime.completed',
    'agent.completed',
  ]);
  push('What is happening?', progress === null ? null : progress.summary, progress);

  // 2. Milestone.
  const milestone = lastRecordOf(records, ['case.milestone_changed']);
  push(
    'What milestone are we at?',
    state.currentMilestone === null
      ? null
      : `${titleCase(state.currentMilestone)} — ${state.completedMilestones.length} earlier milestone${state.completedMilestones.length === 1 ? '' : 's'} complete`,
    milestone,
  );

  // 3. The most recent decision by the control plane or by a person.
  const decision = lastRecordOf(records, [
    'identity.allowed',
    'identity.denied',
    'gateway.routed',
    'gateway.denied',
    'armor.blocked',
    'armor.sanitized',
    'armor.allowed',
    'human_escalation.resolved',
    'intervention.succeeded',
    'intervention.failed',
  ]);
  push(
    'What was the last control decision?',
    decision === null ? null : decision.summary,
    decision,
  );

  // 4. Waiting on what.
  const waiting = lastRecordOf(records, [
    'runtime.waiting',
    'runtime.resumed',
    'runtime.completed',
  ]);
  const waitingAnswer =
    waiting === null || waiting.type !== 'runtime.waiting'
      ? state.caseState === 'completed'
        ? 'Nothing — the Case is complete'
        : null
      : waiting.summary;
  push('What is the agent waiting for?', waitingAnswer, waiting);

  // 5. Trusted context. Provenance is the point: an unsourced fact is not
  //    trusted context, it is a rumour.
  const memory = lastRecordOf(records, ['memory.written', 'memory.recalled']);
  push(
    'What trusted context survives?',
    state.memoryRecords.length === 0
      ? null
      : `${state.memoryRecords.length} Memory Record${state.memoryRecords.length === 1 ? '' : 's'}, each naming the event it came from`,
    memory,
  );

  // 6. What happens next. Read off recorded state, never predicted.
  push('What happens next?', nextAction(state), null);

  return answers;
}
