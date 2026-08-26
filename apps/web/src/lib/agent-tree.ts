import type { CanonicalEvent } from '@fleetscope/event-schema';
import type { ObservableCaseState } from '@fleetscope/domain';

/**
 * The agent hierarchy, outside the canvas.
 *
 * The renderer draws a graph; a graph is not a list you can tab through, read
 * out, or copy an id from. This DOM tree exists so the topology is available to
 * a keyboard and a screen reader, and so an operator can see at a glance which
 * agent failed without hunting for a red node.
 *
 * Delegation depth comes from the recorded `parent` link, never from spawn
 * order — two agents spawned in sequence are siblings, not a chain.
 */

export interface AgentNode {
  readonly agentInstanceId: string;
  readonly label: string;
  readonly role: string;
  readonly agentVersionRef: string;
  readonly sessionId: string;
  readonly state: string;
  readonly depth: number;
  readonly toolCallCount: number;
  readonly outputTokens: number | null;
  /** Recorded tool failures attributed to this agent. */
  readonly failureCount: number;
  /** The most recent recorded action, in business English. */
  readonly lastAction: string | null;
  /** The Canonical Event behind `lastAction`, so it can be inspected. */
  readonly lastActionCaseSequence: number | null;
}

const roleLabel = (role: string): string =>
  role
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export function agentTree(
  state: ObservableCaseState,
  events: readonly CanonicalEvent[],
): AgentNode[] {
  const agents = state.agents;
  const byId = new Map(agents.map((agent) => [agent.agentInstanceId, agent]));

  // The map is keyed by the branded AgentInstanceId; look-ups take the branded
  // value straight from the recorded agent rather than a widened string.
  const depthOf = (agent: (typeof agents)[number] | undefined, guard = 0): number => {
    if (agent === undefined || agent.parent === undefined || guard > 16) return 0;
    return depthOf(byId.get(agent.parent), guard + 1) + 1;
  };

  const lastActionFor = new Map<string, { summary: string; caseSequence: number }>();
  const failuresFor = new Map<string, number>();

  for (const event of events) {
    const actorId = event.actor.kind === 'agent' ? event.actor.id : null;
    const correlated = event.correlations['agentInstanceId'];
    const id = typeof correlated === 'string' ? correlated : actorId;
    if (id === null || id === undefined) continue;

    if (event.type === 'tool.failed') {
      failuresFor.set(id, (failuresFor.get(id) ?? 0) + 1);
    }

    const tool = event.payloadRedacted['tool'];
    const summary =
      event.type === 'tool.succeeded'
        ? `${typeof tool === 'string' ? tool : 'A tool'} succeeded`
        : event.type === 'tool.failed'
          ? `${typeof tool === 'string' ? tool : 'A tool'} failed`
          : event.type === 'tool.requested'
            ? `${typeof tool === 'string' ? tool : 'A tool'} requested`
            : event.type === 'agent.completed'
              ? 'Finished its work'
              : event.type === 'agent.started'
                ? 'Started'
                : event.type === 'agent.spawned'
                  ? 'Created'
                  : null;
    if (summary !== null) {
      lastActionFor.set(id, { summary, caseSequence: event.caseSequence });
    }
  }

  const nodes = agents.map((agent) => {
    const last = lastActionFor.get(agent.agentInstanceId) ?? null;
    return {
      agentInstanceId: agent.agentInstanceId,
      label: roleLabel(agent.role) + ' Agent',
      role: agent.role,
      agentVersionRef: agent.agentVersionRef,
      sessionId: agent.sessionId,
      state: agent.state,
      depth: depthOf(agent),
      toolCallCount: agent.toolCallCount,
      // Unknown must stay unknown: an agent with no usage event has not
      // produced zero tokens, it has an unmeasured output.
      outputTokens: agent.outputTokens ?? null,
      failureCount: failuresFor.get(agent.agentInstanceId) ?? 0,
      lastAction: last?.summary ?? null,
      lastActionCaseSequence: last?.caseSequence ?? null,
    };
  });

  // Parents before children, so the DOM order matches the visual indentation.
  return nodes.sort(
    (a, b) => a.depth - b.depth || a.agentInstanceId.localeCompare(b.agentInstanceId),
  );
}
