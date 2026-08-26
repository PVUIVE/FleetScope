import type { CanonicalEvent } from '@fleetscope/event-schema';
import type { CockpitTranscript, TranscriptAgentNode, TranscriptEntry } from './transcript.js';
import { TRANSCRIPT_VERSION } from './transcript.js';

/**
 * Scenario Compiler.
 *
 * Canonical Events → Cockpit transcript. One direction only. The compiler reads
 * canonical evidence and never writes it, so a renderer requirement can never
 * leak back into the audit spine.
 *
 * The enterprise story is carried by TOOL NAMES (AgentIdentity.authorize,
 * ERP.inventory.read, AgentGateway.route, ModelArmor.screen, ...) rather than by
 * bespoke node types, so the renderer needs no FleetScope-specific knowledge.
 */

/** Platform decisions rendered as named tool chips rather than custom node types. */
const PLATFORM_TOOL_NAMES: Readonly<Record<string, string>> = {
  'registry.version_resolved': 'AgentRegistry.resolve',
  'memory.written': 'MemoryBank.write',
  'memory.recalled': 'MemoryBank.recall',
  'memory.rejected': 'MemoryBank.reject',
  'identity.allowed': 'AgentIdentity.authorize',
  'identity.denied': 'AgentIdentity.authorize',
  'gateway.routed': 'AgentGateway.route',
  'gateway.denied': 'AgentGateway.route',
  'armor.allowed': 'ModelArmor.screen',
  'armor.blocked': 'ModelArmor.screen',
  'armor.sanitized': 'ModelArmor.screen',
  'armor.flagged': 'ModelArmor.screen',
  'runtime.controlled': 'Warden.control',
};

const ERROR_TYPES = new Set([
  'identity.denied',
  'gateway.denied',
  'armor.blocked',
  'memory.rejected',
  'tool.failed',
  'agent.failed',
  'runtime.failed',
  'intervention.failed',
  'intervention.timed_out',
]);

/** Events attributed to the Case rather than to a spawned agent. */
const ROOT_AGENT_ID = 'case-root';

export function compileScenario(events: readonly CanonicalEvent[]): CockpitTranscript {
  const ordered = [...events].sort((a, b) => a.caseSequence - b.caseSequence);
  const agents = new Map<string, TranscriptAgentNode>();
  const entries: TranscriptEntry[] = [];

  const caseId = ordered[0]?.caseId ?? 'unknown';

  agents.set(ROOT_AGENT_ID, {
    id: ROOT_AGENT_ID,
    role: 'case',
    label: caseId,
    parentId: null,
    firstEntryIndex: 0,
  });

  for (const event of ordered) {
    const agentId = event.correlations['agentInstanceId'] ?? ROOT_AGENT_ID;

    if (event.type === 'agent.spawned' && agentId !== ROOT_AGENT_ID && !agents.has(agentId)) {
      const parent = event.correlations['parentAgentInstanceId'] ?? ROOT_AGENT_ID;
      agents.set(agentId, {
        id: agentId,
        role:
          typeof event.payloadRedacted['role'] === 'string'
            ? event.payloadRedacted['role']
            : 'agent',
        label: agentId,
        parentId: parent,
        firstEntryIndex: entries.length,
      });
    }

    const entry = toEntry(event, agents.has(agentId) ? agentId : ROOT_AGENT_ID, entries.length);
    if (entry !== null) entries.push(entry);
  }

  return {
    transcriptVersion: TRANSCRIPT_VERSION,
    caseId,
    agents: [...agents.values()],
    entries,
  };
}

function toEntry(event: CanonicalEvent, agentId: string, index: number): TranscriptEntry | null {
  const fleetscope = {
    eventId: event.eventId,
    caseSequence: event.caseSequence,
    sessionId: event.sessionId,
    eventType: event.type,
  } as const;

  const base = { index, agentId, timestamp: event.sourceTime, fleetscope } as const;
  const callId = event.correlations['toolCallId'];

  if (event.type === 'agent.spawned') {
    return { ...base, kind: 'spawn', label: `spawn ${agentId}` };
  }

  if (event.type === 'tool.requested') {
    const toolName = stringField(event.payloadRedacted['tool']) ?? 'tool';
    return {
      ...base,
      kind: 'tool_pending',
      label: toolName,
      toolName,
      ...(callId !== undefined ? { callId } : {}),
    };
  }

  if (event.type === 'tool.succeeded' || event.type === 'tool.failed') {
    const toolName = stringField(event.payloadRedacted['tool']) ?? 'tool';
    return {
      ...base,
      kind: 'tool_result',
      label: toolName,
      toolName,
      isError: event.type === 'tool.failed',
      ...(callId !== undefined ? { callId } : {}),
    };
  }

  const platformTool = PLATFORM_TOOL_NAMES[event.type];
  if (platformTool !== undefined) {
    // A platform decision is a completed fact, so it renders as a resolved chip
    // rather than a pending call that never resolves.
    //
    // When the decision carries a toolCallId it IS the resolution of that call
    // (an identity authorization, say) and must reuse the id so the renderer can
    // pair it. Otherwise it stands alone and gets a synthetic id.
    return {
      ...base,
      kind: 'tool_result',
      label: `${platformTool} · ${outcomeOf(event.type)}`,
      toolName: platformTool,
      isError: ERROR_TYPES.has(event.type),
      callId: callId ?? `platform-${event.eventId}`,
    };
  }

  return {
    ...base,
    kind: 'status',
    label: event.type,
    ...(ERROR_TYPES.has(event.type) ? { isError: true } : {}),
  };
}

const stringField = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function outcomeOf(type: string): string {
  const [, outcome] = type.split('.');
  return outcome ?? type;
}
