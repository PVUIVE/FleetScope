import type { SourceEvent } from '@fleetscope/event-schema';
import type { AdkIngest, AdkWireEvent } from './wire.js';

/**
 * The adapter boundary: Google ADK events → FleetScope Source Events.
 *
 * One direction only. Nothing downstream of this file knows that ADK exists,
 * and nothing here knows what a Canonical Event is. That is the whole point of
 * the seam: a second framework becomes a second adapter, not a second spine.
 *
 * # What it must never do
 *
 * Fabricate. A duration ADK did not report, a token count it did not supply, a
 * parent agent it did not name — all stay absent. The viewer renders "Unknown".
 *
 * # Ordering
 *
 * Source Events carry no sequence; the Canonicalizer assigns one. Ordering is
 * therefore (sourceTime, dedupeKey), and the dedupe key ends in the emitter's
 * own `seq` plus a sub-index, so two Source Events derived from the SAME wire
 * event keep their intended order even at an identical timestamp.
 */

/**
 * FleetScope's canonical spine is Case-rooted; a local run is one Case.
 *
 * For the local viewer the two identifiers are the SAME value, deliberately: a
 * derived id would mean a developer reading a URL, a log line and a stored row
 * saw three different strings for one run. The function exists so the mapping
 * stays a single named decision rather than an assumption spread across files.
 */
export const caseIdForSession = (sessionId: string): string => sessionId;

const drop = <T extends Record<string, unknown>>(record: T): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};

interface Emit {
  readonly type: SourceEvent['type'];
  readonly subIndex: number;
  readonly payload: Record<string, unknown>;
  readonly correlations: Record<string, string>;
  readonly actorId: string;
}

/**
 * Convert one ingest batch.
 *
 * `knownAgents` carries the agent instances already spawned earlier in the same
 * session, so a second batch does not re-spawn an agent the graph already has.
 * It is mutated as agents are discovered — the caller passes the session's set.
 */
export function toSourceEvents(ingest: AdkIngest, knownAgents: Set<string>): SourceEvent[] {
  const caseId = caseIdForSession(ingest.sessionId);
  const sessionId = ingest.sessionId;
  const out: SourceEvent[] = [];

  for (const event of ingest.events) {
    for (const emit of emissionsFor(event, ingest, knownAgents)) {
      out.push({
        dedupeKey: `adk:${sessionId}:${String(event.seq).padStart(6, '0')}:${emit.subIndex}`,
        caseId,
        sessionId,
        type: emit.type,
        sourceTime: event.at,
        actor: { kind: 'agent', id: emit.actorId },
        correlations: emit.correlations,
        payload: emit.payload,
      });
    }
  }

  return out;
}

function emissionsFor(event: AdkWireEvent, ingest: AdkIngest, knownAgents: Set<string>): Emit[] {
  const agent = event.agent;
  const actorId = agent ?? ingest.appName ?? 'adk';

  const correlations = (extra: Record<string, string | undefined> = {}): Record<string, string> => {
    const base: Record<string, string | undefined> = {
      ...(agent !== undefined ? { agentInstanceId: agent } : {}),
      ...(event.parentAgent !== undefined ? { parentAgentInstanceId: event.parentAgent } : {}),
      ...(event.invocationId !== undefined ? { invocationId: event.invocationId } : {}),
      framework: ingest.framework,
      ...extra,
    };
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(base)) if (value !== undefined) out[key] = value;
    return out;
  };

  const failed = event.error === true;

  switch (event.kind) {
    case 'session.start':
      return [
        {
          type: 'runtime.started',
          subIndex: 0,
          actorId,
          correlations: correlations(),
          payload: drop({
            framework: ingest.framework,
            frameworkVersion: ingest.frameworkVersion,
            appName: ingest.appName,
            rootAgent: agent,
          }),
        },
      ];

    case 'session.end':
      return [
        {
          type: failed ? 'runtime.failed' : 'runtime.completed',
          subIndex: 0,
          actorId,
          correlations: correlations(),
          payload: drop({
            state: failed ? undefined : 'completed',
            errorClass: event.errorClass,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
          }),
        },
      ];

    case 'agent.start': {
      const emits: Emit[] = [];
      // The spawn is what creates the node and the parent edge; it is emitted
      // once per agent instance, on that agent's first activation.
      if (agent !== undefined && !knownAgents.has(agent)) {
        knownAgents.add(agent);
        emits.push({
          type: 'agent.spawned',
          subIndex: 0,
          actorId,
          correlations: correlations(),
          payload: drop({ role: agent, framework: ingest.framework }),
        });
      }
      emits.push({
        type: 'agent.started',
        subIndex: 1,
        actorId,
        correlations: correlations(),
        payload: drop({ role: agent }),
      });
      return emits;
    }

    case 'agent.end':
      return [
        {
          type: failed ? 'agent.failed' : 'agent.completed',
          subIndex: 0,
          actorId,
          correlations: correlations(),
          payload: drop({
            role: agent,
            errorClass: event.errorClass,
            outputTokens: event.outputTokens,
          }),
        },
      ];

    case 'model.start':
      return [
        {
          type: 'model.requested',
          subIndex: 0,
          actorId,
          correlations: correlations({ modelCallId: event.callId }),
          payload: drop({ model: event.model, inputTokens: event.inputTokens }),
        },
      ];

    case 'model.end':
      return [
        {
          type: 'model.responded',
          subIndex: 0,
          actorId,
          correlations: correlations({ modelCallId: event.callId }),
          payload: drop({
            model: event.model,
            finishReason: event.finishReason,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
          }),
        },
      ];

    case 'model.error':
      return [
        {
          type: 'model.failed',
          subIndex: 0,
          actorId,
          correlations: correlations({ modelCallId: event.callId }),
          payload: drop({ model: event.model, errorClass: event.errorClass ?? 'model_error' }),
        },
      ];

    case 'tool.start':
      return [
        {
          type: 'tool.requested',
          subIndex: 0,
          actorId,
          correlations: correlations({ toolCallId: event.callId }),
          // Arguments travel as a payload so the Canonicalizer's redaction rules
          // see them. They are the one place a developer's own data can arrive.
          payload: drop({ tool: event.tool, args: event.args }),
        },
      ];

    case 'tool.end':
      return [
        {
          type: failed ? 'tool.failed' : 'tool.succeeded',
          subIndex: 0,
          actorId,
          correlations: correlations({ toolCallId: event.callId }),
          payload: drop({
            tool: event.tool,
            resultSummary: event.summary,
            errorClass: event.errorClass,
            result: event.result,
          }),
        },
      ];

    case 'tool.error':
      return [
        {
          type: 'tool.failed',
          subIndex: 0,
          actorId,
          correlations: correlations({ toolCallId: event.callId }),
          payload: drop({ tool: event.tool, errorClass: event.errorClass ?? 'tool_error' }),
        },
      ];
  }
}
