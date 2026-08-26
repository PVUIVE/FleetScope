import type { SourceEvent } from '@fleetscope/event-schema';
import type { LiveStep } from './allowlist.js';
import type { LiveFailure, LiveSuccess } from './gemini.js';

/**
 * Turning a live model result into evidence.
 *
 * A model result NEVER reaches an authoritative surface directly. It becomes
 * Source Events, which the Canonicalizer validates, redacts and orders, which
 * the Projector folds, and which the Scenario Compiler renders. This module
 * produces only the first link in that chain, and the shapes it produces are
 * ordinary FleetScope events — no bespoke "model output" type exists, because a
 * bespoke type is how model output ends up on a path that skips the pipeline.
 *
 * The chosen shape is a TOOL CALL, because that is what actually happened: the
 * orchestrator asked a model a question and got an answer. `tool.requested` then
 * `tool.succeeded` or `tool.failed` — the same two events any other tool
 * produces, rendered by the same chip, subject to the same invariants.
 *
 * A FAILED call still produces evidence. "The live proof was attempted and did
 * not succeed" is a fact worth recording; quietly serving the recorded result
 * with no trace would make the demo unable to tell the two apart afterwards.
 */

const LIVE_TOOL = 'Gemini.generate';

export interface LiveEvidenceContext {
  readonly step: LiveStep;
  /**
   * The Runtime Session the call belongs to, or null for a Case-level fact.
   * A Case spans several Sessions, so this is never assumed.
   */
  readonly sessionId: string | null;
  /** The agent instance credited with the call. */
  readonly agentInstanceId: string;
  /**
   * When the event happened in the CASE's own frame.
   *
   * A Recorded Case runs a simulated timeline, so a live proof appended to it
   * must be stamped where it belongs in that Case — after the evidence already
   * there — not at real wall-clock time, which may sit anywhere relative to the
   * recording. `ingestionTime` carries the real receipt time separately.
   */
  readonly observedAt: string;
  /** When this edge actually took delivery, in real time. */
  readonly ingestedAt: string;
}

const toolCallId = (step: LiveStep): string => `tc-live-${step.stepId}`;

function request(context: LiveEvidenceContext): SourceEvent {
  return {
    dedupeKey: `live:${context.step.caseId}:${context.step.stepId}:requested`,
    caseId: context.step.caseId,
    sessionId: context.sessionId,
    type: 'tool.requested',
    sourceTime: context.observedAt,
    ingestionTime: context.ingestedAt,
    actor: { kind: 'agent', id: context.agentInstanceId },
    correlations: {
      caseId: context.step.caseId,
      toolCallId: toolCallId(context.step),
      agentInstanceId: context.agentInstanceId,
    },
    payload: {
      tool: LIVE_TOOL,
      stepId: context.step.stepId,
      // The prompt is a server constant and is NOT carried into evidence. It is
      // identified by its step id, which is enough to reproduce the call and
      // carries nothing an operator may not see.
      argumentsRedacted: '[redacted]',
    },
  };
}

/** The two Source Events a SUCCESSFUL live proof produces. */
export function liveSuccessEvidence(
  context: LiveEvidenceContext,
  outcome: LiveSuccess,
): SourceEvent[] {
  const usage: SourceEvent[] =
    outcome.usage.outputTokens === null
      ? []
      : [
          {
            dedupeKey: `live:${context.step.caseId}:${context.step.stepId}:usage`,
            caseId: context.step.caseId,
            sessionId: context.sessionId,
            type: 'usage.recorded',
            sourceTime: context.observedAt,
            ingestionTime: context.ingestedAt,
            actor: { kind: 'service', id: 'agent-observability' },
            correlations: {
              caseId: context.step.caseId,
              agentInstanceId: context.agentInstanceId,
            },
            payload: {
              outputTokens: outcome.usage.outputTokens,
              inputTokens: outcome.usage.inputTokens,
              toolCalls: 1,
            },
          },
        ];

  return [
    request(context),
    {
      dedupeKey: `live:${context.step.caseId}:${context.step.stepId}:succeeded`,
      caseId: context.step.caseId,
      sessionId: context.sessionId,
      type: 'tool.succeeded',
      sourceTime: context.observedAt,
      ingestionTime: context.ingestedAt,
      actor: { kind: 'agent', id: context.agentInstanceId },
      correlations: {
        caseId: context.step.caseId,
        toolCallId: toolCallId(context.step),
        agentInstanceId: context.agentInstanceId,
      },
      payload: {
        tool: LIVE_TOOL,
        durationMs: outcome.durationMs,
        // The operator-safe summary the model returned, inside its schema cap.
        resultSummary: `${outcome.decision.classification} · ${outcome.decision.summary}`,
        classification: outcome.decision.classification,
        confidence: outcome.decision.confidence,
        // Recorded so the advice is attributable — and so the audit record shows
        // plainly that a model contributed advice, which is never authority.
        modelReference: { model: outcome.model, responseRef: outcome.responseRef },
        executionMode: 'live',
      },
    },
    ...usage,
  ];
}

/** The two Source Events a FAILED live proof produces. Failure is evidence too. */
export function liveFailureEvidence(
  context: LiveEvidenceContext,
  outcome: LiveFailure,
): SourceEvent[] {
  return [
    request(context),
    {
      dedupeKey: `live:${context.step.caseId}:${context.step.stepId}:failed`,
      caseId: context.step.caseId,
      sessionId: context.sessionId,
      type: 'tool.failed',
      sourceTime: context.observedAt,
      ingestionTime: context.ingestedAt,
      actor: { kind: 'agent', id: context.agentInstanceId },
      correlations: {
        caseId: context.step.caseId,
        toolCallId: toolCallId(context.step),
        agentInstanceId: context.agentInstanceId,
      },
      payload: {
        tool: LIVE_TOOL,
        errorClass: outcome.reason,
        durationMs: outcome.durationMs,
        detail: outcome.detail,
        executionMode: 'live',
      },
    },
  ];
}
