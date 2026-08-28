import type { CanonicalEvent } from '@fleetscope/event-schema';
import { sha256Hex } from '@fleetscope/shared';
import {
  RENDER_MANIFEST_VERSION,
  fractionForEntryIndex,
  type RenderDomain,
  type RenderManifest,
  type RenderManifestEntry,
  type RenderOutcome,
} from '../render-manifest.js';
import {
  SPAWN_TOOL,
  assistantLine,
  orderedTimestamp,
  serializeJsonl,
  subagentMeta,
  userResultLine,
} from './wire.js';

/**
 * The Zoetrope Scenario Compiler adapter.
 *
 * Canonical Events in, a Zoetrope-loadable session out, plus the Render Manifest
 * that makes the mapping between them invertible. One direction only: this
 * module reads canonical evidence and never writes it, so a renderer's needs can
 * never leak back into the audit spine.
 *
 * # Two things this file is responsible for
 *
 * **Renderer-safe minimization.** The Canonicalizer already redacted the stream
 * before persistence; this is the second boundary. Only operator-safe labels and
 * recorded summaries are emitted — never a prompt, never reasoning, never a raw
 * payload, never a filesystem path. `redactedSummary` below is the only way a
 * payload value reaches an emitted line.
 *
 * **Semantic fidelity.** `sanitized` is a success. `denied` is a policy decision.
 * `blocked` is a screening refusal. `failed` is an execution failure. The
 * renderer may draw the last three with the same error styling — it has no
 * richer vocabulary — but the manifest keeps them distinct, and the Decision
 * Evidence rail reads the manifest, so it says "Identity denied", not
 * "Tool failed".
 */

export const ZOETROPE_ADAPTER_ID = 'zoetrope-claude-jsonl@1.0.0';

/** Platform capability decisions render as named tool chips, not bespoke nodes. */
const PLATFORM_TOOL: Readonly<Record<string, string>> = {
  'registry.version_resolved': 'AgentRegistry.resolve',
  'memory.written': 'MemoryBank.write',
  'memory.recalled': 'MemoryBank.recall',
  'memory.rejected': 'MemoryBank.recall',
  'identity.allowed': 'AgentIdentity.authorize',
  'identity.denied': 'AgentIdentity.authorize',
  'gateway.routed': 'AgentGateway.route',
  'gateway.denied': 'AgentGateway.route',
  'armor.allowed': 'ModelArmor.screen',
  'armor.blocked': 'ModelArmor.screen',
  'armor.sanitized': 'ModelArmor.screen',
  'armor.flagged': 'ModelArmor.screen',
  'policy.evaluated': 'Warden.policy',
  'runtime.controlled': 'Warden.control',
};

const DOMAIN_OF: Readonly<Record<string, RenderDomain>> = {
  case: 'case',
  registry: 'registry',
  runtime: 'runtime',
  memory: 'memory',
  identity: 'identity',
  gateway: 'gateway',
  armor: 'armor',
  agent: 'agent',
  model: 'model',
  tool: 'tool',
  usage: 'usage',
  incident: 'incident',
  policy: 'policy',
  intervention: 'intervention',
  human_escalation: 'approval',
};

/**
 * The semantic outcome of each event type.
 *
 * This table is the single place the four failure-shaped-but-different outcomes
 * are kept apart, and the compiler tests assert on it directly.
 */
const OUTCOME_OF: Readonly<Record<string, RenderOutcome>> = {
  'case.created': 'informational',
  'case.milestone_changed': 'informational',

  'registry.version_resolved': 'succeeded',

  'runtime.started': 'informational',
  'runtime.waiting': 'informational',
  'runtime.resumed': 'informational',
  'runtime.completed': 'succeeded',
  'runtime.failed': 'failed',
  'runtime.controlled': 'succeeded',

  'memory.written': 'succeeded',
  'memory.recalled': 'succeeded',
  'memory.rejected': 'denied',

  'identity.allowed': 'succeeded',
  'identity.denied': 'denied',

  'gateway.routed': 'succeeded',
  'gateway.denied': 'denied',

  'armor.allowed': 'succeeded',
  'armor.sanitized': 'sanitized',
  'armor.flagged': 'flagged',
  'armor.blocked': 'blocked',

  'agent.spawned': 'informational',
  'agent.started': 'informational',
  'agent.completed': 'succeeded',
  'agent.failed': 'failed',

  'model.requested': 'pending',
  'model.responded': 'succeeded',
  'model.failed': 'failed',

  'tool.requested': 'pending',
  'tool.succeeded': 'succeeded',
  'tool.failed': 'failed',

  'usage.recorded': 'informational',

  'incident.opened': 'informational',
  'incident.updated': 'informational',
  'incident.resolved': 'succeeded',

  'policy.evaluated': 'informational',

  'intervention.proposed': 'informational',
  'intervention.authorized': 'informational',
  'intervention.rejected': 'denied',
  'intervention.requested': 'pending',
  'intervention.acknowledged': 'informational',
  'intervention.succeeded': 'succeeded',
  'intervention.failed': 'failed',
  'intervention.timed_out': 'failed',

  'human_escalation.opened': 'pending',
  'human_escalation.resolved': 'succeeded',
};

/** Outcomes the renderer must draw with its error styling. */
const ERROR_OUTCOMES = new Set<RenderOutcome>(['denied', 'blocked', 'failed']);

export interface ZoetropeSubagentFile {
  readonly agentId: string;
  /** `meta.json` contents, serialized. */
  readonly meta: string;
  /** The subagent's own JSONL transcript. */
  readonly transcript: string;
}

export interface ZoetropeScene {
  readonly caseId: string;
  /** The main session transcript. */
  readonly main: string;
  readonly subagents: readonly ZoetropeSubagentFile[];
  readonly manifest: RenderManifest;
  /**
   * Compiler-detected breaches of the security ordering invariants. Recorded,
   * never suppressed: a demo that quietly hid one would be exactly the
   * "UI invents enforcement" failure the product forbids.
   */
  readonly invariantViolations: readonly string[];
}

/** Zoetrope keys subagents by a 17-hex id; derive one deterministically. */
const rendererAgentId = (agentInstanceId: string): string =>
  sha256Hex(agentInstanceId).slice(0, 17);

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/**
 * The ONLY path by which a payload value reaches an emitted renderer line.
 *
 * Everything else is a label this compiler wrote. A value is admitted only if it
 * is a short, already-redacted summary field the product has decided is
 * operator-safe; anything longer is truncated, and anything carrying a redaction
 * marker is dropped rather than shown as `«redacted»` noise.
 */
function redactedSummary(value: unknown, fallback: string): string {
  const text = str(value);
  if (
    text === undefined ||
    text === '' ||
    text.includes('«redacted»') ||
    text.includes('[redacted]')
  ) {
    return fallback;
  }
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

type Slot =
  | { readonly kind: 'main'; readonly line: Record<string, unknown> }
  | { readonly kind: 'meta'; readonly agentId: string; readonly meta: Record<string, unknown> }
  | { readonly kind: 'sub'; readonly agentId: string; readonly line: Record<string, unknown> };

interface PendingCall {
  readonly toolName: string;
  readonly rendererAgentId: string | null;
  /** The Canonical Event that requested this call, so its resolution can cite it. */
  readonly originEventId: string;
  resolved: boolean;
}

export function compileZoetropeScene(events: readonly CanonicalEvent[]): ZoetropeScene {
  const ordered = [...events].sort((a, b) => a.caseSequence - b.caseSequence);
  const caseId = ordered[0]?.caseId ?? 'unknown';

  const slots: Slot[] = [];
  const manifestEntries: RenderManifestEntry[] = [];
  const invariantViolations: string[] = [];

  /** FleetScope agentInstanceId → renderer agent id. `null` means the main node. */
  const agentNodes = new Map<string, string | null>();
  const subagentLines = new Map<string, Record<string, unknown>[]>();
  const subagentMetas = new Map<string, Record<string, unknown>>();
  const subagentStarted = new Set<string>();
  const pendingCalls = new Map<string, PendingCall>();
  const spawnToolUseIds = new Map<string, string>();
  const blockedInputIds = new Set<string>();
  const deniedRouteCapabilities = new Set<string>();

  let lastMainUuid: string | null = null;
  let uuidCounter = 0;
  const nextUuid = (): string => `fs-${String(++uuidCounter).padStart(5, '0')}`;

  const push = (slot: Slot): void => {
    slots.push(slot);
    if (slot.kind === 'sub') {
      const list = subagentLines.get(slot.agentId);
      if (list === undefined) subagentLines.set(slot.agentId, [slot.line]);
      else list.push(slot.line);
    } else if (slot.kind === 'meta') {
      subagentMetas.set(slot.agentId, slot.meta);
    }
  };

  for (const event of ordered) {
    const start = slots.length;
    const evidence = new Set<string>([event.eventId]);
    const c = event.correlations;
    const p = event.payloadRedacted;
    const sessionId = event.sessionId ?? caseId;
    const family = event.type.split('.')[0] ?? event.type;
    const domain = DOMAIN_OF[family] ?? 'case';
    const outcome = OUTCOME_OF[event.type] ?? 'informational';

    // Which renderer node this event belongs to: a spawned child if the event
    // names one FleetScope has already routed to a subagent, else the main node.
    const instanceId = c['agentInstanceId'];
    const nodeAgentId =
      instanceId !== undefined && agentNodes.has(instanceId)
        ? (agentNodes.get(instanceId) ?? null)
        : null;

    /** Emit one assistant line onto the right transcript. */
    const emitAssistant = (
      content: Parameters<typeof assistantLine>[0]['content'],
      options: { readonly outputTokens?: number } = {},
    ): string => {
      const uuid = nextUuid();
      const timestamp = orderedTimestamp(event.sourceTime, slots.length);
      if (nodeAgentId === null) {
        push({
          kind: 'main',
          line: assistantLine({
            uuid,
            parentUuid: lastMainUuid,
            timestamp,
            sessionId,
            content,
            ...(options.outputTokens !== undefined ? { outputTokens: options.outputTokens } : {}),
          }),
        });
        lastMainUuid = uuid;
      } else {
        push({
          kind: 'sub',
          agentId: nodeAgentId,
          line: assistantLine({
            uuid,
            parentUuid: null,
            timestamp,
            sessionId,
            agentId: nodeAgentId,
            content,
            ...(options.outputTokens !== undefined ? { outputTokens: options.outputTokens } : {}),
          }),
        });
      }
      return uuid;
    };

    const emitResult = (toolUseId: string, summary: string, isError: boolean): void => {
      const call = pendingCalls.get(toolUseId);
      if (call !== undefined) evidence.add(call.originEventId);
      const target = call?.rendererAgentId ?? nodeAgentId;
      const uuid = nextUuid();
      const timestamp = orderedTimestamp(event.sourceTime, slots.length);
      if (target === null) {
        push({
          kind: 'main',
          line: userResultLine({
            uuid,
            parentUuid: lastMainUuid,
            timestamp,
            sessionId,
            toolUseId,
            summary,
            isError,
          }),
        });
        lastMainUuid = uuid;
      } else {
        push({
          kind: 'sub',
          agentId: target,
          line: userResultLine({
            uuid,
            parentUuid: null,
            timestamp,
            sessionId,
            agentId: target,
            toolUseId,
            summary,
            isError,
          }),
        });
      }
      if (call !== undefined) call.resolved = true;
    };

    /** A completed platform decision: request chip and its resolution. */
    const emitChip = (toolName: string, summary: string, isError: boolean): void => {
      const id = `plat-${event.eventId}`;
      emitAssistant([{ type: 'tool_use', id, name: toolName, input: {} }]);
      pendingCalls.set(id, {
        toolName,
        rendererAgentId: nodeAgentId,
        originEventId: event.eventId,
        resolved: false,
      });
      emitResult(id, summary, isError);
    };

    const emitText = (text: string): void => {
      emitAssistant([{ type: 'text', text }]);
    };

    switch (event.type) {
      // ── Case ──────────────────────────────────────────────────────────────
      case 'case.created':
        emitText(
          `Case ${event.caseId} opened · ${redactedSummary(p['objective'], 'governed vendor onboarding')}`,
        );
        break;

      // A milestone is a business-rail concept, not a renderer item. Recorded in
      // the manifest with a zero-length range so the cursor can still find it.
      case 'case.milestone_changed':
      case 'usage.recorded':
        break;

      // ── Runtime ───────────────────────────────────────────────────────────
      case 'runtime.started':
        emitText(`Runtime Session ${sessionId} started`);
        break;

      case 'runtime.resumed': {
        const day = num(p['simulatedDayBoundary']);
        emitText(
          day === undefined
            ? `Runtime Session ${sessionId} resumed`
            : `Simulated Day ${day} · Runtime Session ${sessionId} resumed`,
        );
        break;
      }

      case 'runtime.waiting':
        emitText(`Waiting · ${redactedSummary(p['waitingFor'], 'external signal')}`);
        break;

      case 'runtime.completed':
        emitText(`Runtime result · ${redactedSummary(p['state'], 'completed')}`);
        break;

      case 'runtime.failed':
        emitText(
          `Runtime result · failed · ${redactedSummary(p['errorClass'], 'unrecorded cause')}`,
        );
        break;

      // ── Agents ────────────────────────────────────────────────────────────
      case 'agent.spawned': {
        const id = instanceId;
        if (id === undefined) break;
        const parent = c['parentAgentInstanceId'];
        const role = redactedSummary(p['role'], 'agent');

        if (parent === undefined) {
          // The root orchestrator IS the main node; it is not delegated to.
          agentNodes.set(id, null);
          // The version ref exists for governed enterprise Cases and not for a
          // local run. Absent, the label is the role alone — never the words
          // "unknown version", which would read as a fault rather than as a
          // field this framework simply does not report.
          const version = c['agentVersionRef'];
          emitText(version === undefined ? role : `${role} · ${version}`);
          break;
        }

        // A delegation. The spawn tool call lives on the PARENT's transcript and
        // is what Zoetrope joins the child's meta to.
        const rendererId = rendererAgentId(id);
        agentNodes.set(id, rendererId);
        const toolUseId = `spawn-${event.eventId}`;
        spawnToolUseIds.set(id, toolUseId);
        emitAssistant([
          {
            type: 'tool_use',
            id: toolUseId,
            name: SPAWN_TOOL,
            // NO `prompt` field. `vendor/zoetrope/src/ui/panel.rs` renders one as
            // a `↳ prompt` row, and a private prompt must never reach a renderer.
            input: { description: `${role} agent`, subagent_type: role },
          },
        ]);
        pendingCalls.set(toolUseId, {
          toolName: SPAWN_TOOL,
          rendererAgentId: null,
          originEventId: event.eventId,
          resolved: false,
        });
        break;
      }

      case 'agent.started': {
        const id = instanceId;
        const rendererId = id === undefined ? undefined : agentNodes.get(id);
        if (id === undefined || rendererId === undefined || rendererId === null) {
          emitText('Agent started');
          break;
        }
        // Meta first, then the child's first line. Zoetrope dates a meta to its
        // agent's first entry and sorts metas before entries at that instant, so
        // emitting them adjacently is what keeps emission order == timeline order.
        push({
          kind: 'meta',
          agentId: rendererId,
          meta: subagentMeta({
            agentType: redactedSummary(c['agentVersionRef'], 'agent'),
            description:
              c['agentVersionRef'] === undefined ? id : `${id} · ${c['agentVersionRef']}`,
            toolUseId: spawnToolUseIds.get(id) ?? `spawn-${id}`,
          }),
        });
        const uuid = nextUuid();
        push({
          kind: 'sub',
          agentId: rendererId,
          line: assistantLine({
            uuid,
            parentUuid: null,
            timestamp: orderedTimestamp(event.sourceTime, slots.length),
            sessionId,
            agentId: rendererId,
            content: [{ type: 'text', text: `${id} started` }],
          }),
        });
        subagentStarted.add(rendererId);
        break;
      }

      case 'agent.completed':
      case 'agent.failed': {
        const failed = event.type === 'agent.failed';
        const tokens = num(p['outputTokens']);
        emitAssistant(
          [
            {
              type: 'text',
              text: failed
                ? `${instanceId ?? 'agent'} failed · ${redactedSummary(p['errorClass'], 'unrecorded cause')}`
                : `${instanceId ?? 'agent'} completed`,
            },
          ],
          // Only when recorded. An absent count must stay absent, never 0.
          tokens === undefined ? {} : { outputTokens: tokens },
        );
        // Acknowledge the spawn on the parent so the delegation chip resolves.
        const spawnId = instanceId === undefined ? undefined : spawnToolUseIds.get(instanceId);
        if (spawnId !== undefined && pendingCalls.get(spawnId)?.resolved === false) {
          emitResult(spawnId, failed ? 'agent failed' : 'agent completed', failed);
        }
        break;
      }

      // ── Model calls ───────────────────────────────────────────────────────
      //
      // A model call renders as a named chip so the graph shows WHICH model ran
      // and how long it took, without any prompt or response text reaching the
      // renderer. `redactedSummary` is still the only path a payload value takes.
      case 'model.requested': {
        const modelName = redactedSummary(p['model'], 'model');
        const callId = c['modelCallId'] ?? `model-${event.eventId}`;
        emitAssistant([{ type: 'tool_use', id: callId, name: modelName, input: {} }]);
        pendingCalls.set(callId, {
          toolName: modelName,
          rendererAgentId: nodeAgentId,
          originEventId: event.eventId,
          resolved: false,
        });
        break;
      }

      case 'model.responded':
      case 'model.failed': {
        const callId = c['modelCallId'] ?? `model-${event.eventId}`;
        const failed = event.type === 'model.failed';
        const tokens = num(p['outputTokens']);
        emitResult(
          callId,
          failed
            ? `failed · ${redactedSummary(p['errorClass'], 'unrecorded error class')}`
            : tokens === undefined
              ? redactedSummary(p['finishReason'], 'responded')
              : `${redactedSummary(p['finishReason'], 'responded')} · ${tokens} out tok`,
          failed,
        );
        break;
      }

      // ── Tools ─────────────────────────────────────────────────────────────
      case 'tool.requested': {
        const toolName = redactedSummary(p['tool'], 'tool');
        const callId = c['toolCallId'] ?? `call-${event.eventId}`;
        emitAssistant([{ type: 'tool_use', id: callId, name: toolName, input: {} }]);
        pendingCalls.set(callId, {
          toolName,
          rendererAgentId: nodeAgentId,
          originEventId: event.eventId,
          resolved: false,
        });
        break;
      }

      case 'tool.succeeded':
      case 'tool.failed': {
        const callId = c['toolCallId'] ?? `call-${event.eventId}`;
        const failed = event.type === 'tool.failed';
        emitResult(
          callId,
          failed
            ? `failed · ${redactedSummary(p['errorClass'], 'unrecorded error class')}`
            : redactedSummary(p['resultSummary'], 'succeeded'),
          failed,
        );
        break;
      }

      // ── Platform decisions ────────────────────────────────────────────────
      default: {
        const toolName = PLATFORM_TOOL[event.type];
        if (toolName === undefined) {
          emitText(labelFor(event));
          break;
        }

        const callId = c['toolCallId'];
        const pending = callId === undefined ? undefined : pendingCalls.get(callId);
        const isError = ERROR_OUTCOMES.has(outcome);
        const summary = platformSummary(event, outcome);

        if (pending !== undefined && !pending.resolved && pending.toolName === toolName) {
          // The decision IS the resolution of the call that requested it.
          emitResult(callId!, summary, isError);
        } else {
          emitChip(toolName, summary, isError);
          if (pending !== undefined && !pending.resolved && isError) {
            // A denial or block terminates the call it was evaluated for. The
            // renderer draws it with error styling because it has no `denied`
            // state; the manifest and the evidence rail keep the distinction.
            emitResult(callId!, `Not executed · ${summary}`, true);
          }
        }
        break;
      }
    }

    // ── Security-ordering checks over the compiled stream ──────────────────
    const screenedInputId = c['screenedInputId'];
    if (event.type === 'armor.blocked' && screenedInputId !== undefined) {
      blockedInputIds.add(screenedInputId);
    } else if (
      screenedInputId !== undefined &&
      blockedInputIds.has(screenedInputId) &&
      USES_INPUT_AS_CONTENT.has(event.type)
    ) {
      invariantViolations.push(
        `${event.eventId}: ${event.type} uses blocked input ${screenedInputId} as downstream content`,
      );
    }

    if (event.type === 'gateway.denied') {
      const capability = str(p['requestedCapability']);
      if (capability !== undefined) deniedRouteCapabilities.add(capability);
    }
    if (event.type === 'agent.spawned' && c['parentAgentInstanceId'] !== undefined) {
      const capability = str(p['requestedCapability']);
      if (capability !== undefined && deniedRouteCapabilities.has(capability)) {
        invariantViolations.push(
          `${event.eventId}: agent spawned for capability ${capability} after Gateway denied it`,
        );
      }
    }

    const end = slots.length - 1;
    const count = slots.length - start;
    manifestEntries.push({
      eventId: event.eventId,
      caseSequence: event.caseSequence,
      rendererEntryStart: start,
      rendererEntryEnd: end,
      rendererEntryCount: count,
      rendererFraction: 0, // filled in below, once the total is known
      domain,
      outcome,
      label: labelFor(event),
      evidenceEventIds: [...evidence].sort(),
    });
  }

  const total = slots.length;
  const entries = manifestEntries.map((entry) => ({
    ...entry,
    rendererFraction: fractionForEntryIndex(entry.rendererEntryStart, total),
  }));

  // An unresolved spawn would leave a child node looking permanently in-flight.
  for (const [id, pending] of pendingCalls) {
    if (!pending.resolved && pending.toolName === SPAWN_TOOL) {
      invariantViolations.push(`spawn ${id} was never acknowledged`);
    }
  }

  const subagents: ZoetropeSubagentFile[] = [...subagentMetas.keys()].sort().map((agentId) => ({
    agentId,
    meta: JSON.stringify(subagentMetas.get(agentId)),
    transcript: serializeJsonl(subagentLines.get(agentId) ?? []),
  }));

  return {
    caseId,
    main: serializeJsonl(
      slots
        .filter((s): s is Extract<Slot, { kind: 'main' }> => s.kind === 'main')
        .map((s) => s.line),
    ),
    subagents,
    manifest: {
      manifestVersion: RENDER_MANIFEST_VERSION,
      caseId,
      adapterId: ZOETROPE_ADAPTER_ID,
      rendererEntryCount: total,
      firstCaseSequence: ordered[0]?.caseSequence ?? 0,
      lastCaseSequence: ordered[ordered.length - 1]?.caseSequence ?? 0,
      entries,
    },
    invariantViolations,
  };
}

/**
 * Event families that would be USING a screened input as content, as opposed to
 * merely recording a decision about it. Only these can breach Invariant 5.
 */
const USES_INPUT_AS_CONTENT = new Set([
  'memory.written',
  'memory.recalled',
  'tool.requested',
  'agent.spawned',
]);

function platformSummary(event: CanonicalEvent, outcome: RenderOutcome): string {
  const p = event.payloadRedacted;
  switch (event.type) {
    case 'identity.allowed':
      return `allowed · ${redactedSummary(p['requestedRole'], 'role')} on ${redactedSummary(p['resource'], 'resource')}`;
    case 'identity.denied':
      return `Identity denied · ${redactedSummary(p['reason'], 'role not granted')}`;
    case 'gateway.routed':
      return `routed · ${redactedSummary(p['requestedCapability'], 'capability')}`;
    case 'gateway.denied':
      return `Gateway denied · ${redactedSummary(p['reason'], 'route not permitted')}`;
    case 'armor.blocked':
      return `Armor blocked · ${redactedSummary(p['findingClass'], 'policy finding')}`;
    case 'armor.sanitized':
      // A sanitized screen SUCCEEDED with modified content. Rendering it as a
      // failure would misreport a working control as a broken one.
      return `sanitized · ${redactedSummary(p['findingClass'], 'content modified by policy')}`;
    case 'armor.flagged':
      return `flagged · ${redactedSummary(p['findingClass'], 'finding recorded')}`;
    case 'armor.allowed':
      return 'allowed';
    case 'memory.rejected':
      return `Memory rejected · ${redactedSummary(p['reason'], 'scope or provenance')}`;
    case 'memory.written':
    case 'memory.recalled':
      return redactedSummary(p['summary'], outcome);
    case 'registry.version_resolved':
      return `${redactedSummary(p['approvalState'], 'resolved')} · ${event.correlations['agentVersionRef'] ?? ''}`.trim();
    case 'policy.evaluated':
      return `${redactedSummary(p['disposition'], 'evaluated')} · ${redactedSummary(p['actionTemplate'], 'no action')}`;
    case 'runtime.controlled':
      return `${redactedSummary(p['operation'], 'control')} · ${redactedSummary(p['result'], 'applied')}`;
    default:
      return outcome;
  }
}

/** The operator-facing label. Product vocabulary only. */
function labelFor(event: CanonicalEvent): string {
  const p = event.payloadRedacted;
  switch (event.type) {
    case 'case.created':
      return 'Case created';
    case 'case.milestone_changed':
      return `Milestone · ${redactedSummary(p['milestone'], 'changed')}`;
    case 'usage.recorded':
      return 'Usage recorded';
    case 'incident.opened':
      return `Incident opened · ${redactedSummary(p['incidentClass'], 'unclassified')}`;
    case 'incident.updated':
      return 'Incident updated';
    case 'incident.resolved':
      return `Incident resolved · ${redactedSummary(p['resolution'], 'resolved')}`;
    case 'policy.evaluated':
      return `Policy · ${redactedSummary(p['disposition'], 'evaluated')}`;
    case 'intervention.proposed':
      return `Warden proposed · ${redactedSummary(p['actionTemplate'], 'action')}`;
    case 'intervention.authorized':
      return 'Warden authorized';
    case 'intervention.rejected':
      return 'Warden rejected';
    case 'intervention.requested':
      return 'Warden requested';
    case 'intervention.acknowledged':
      return 'Runtime acknowledged';
    case 'intervention.succeeded':
      return 'Runtime result · succeeded';
    case 'intervention.failed':
      return 'Runtime result · failed';
    case 'intervention.timed_out':
      return 'Runtime result · timed out';
    case 'human_escalation.opened':
      return `Approval required · ${redactedSummary(p['actionTemplate'], 'action')}`;
    case 'human_escalation.resolved':
      return `Approval ${redactedSummary(p['decision'], 'resolved')}`;
    case 'runtime.waiting':
      return `Waiting · ${redactedSummary(p['waitingFor'], 'external signal')}`;
    case 'runtime.resumed': {
      const day = num(p['simulatedDayBoundary']);
      return day === undefined ? 'Session resumed' : `Simulated Day ${day} · Session resumed`;
    }
    case 'runtime.started':
      return 'Session started';
    case 'runtime.completed':
      return 'Runtime result · completed';
    case 'runtime.failed':
      return 'Runtime result · failed';
    case 'runtime.controlled':
      return `Runtime controlled · ${redactedSummary(p['operation'], 'control')}`;
    case 'agent.spawned':
      return `Agent spawned · ${redactedSummary(p['role'], 'agent')}`;
    case 'agent.started':
      return 'Agent started';
    case 'agent.completed':
      return 'Agent completed';
    case 'agent.failed':
      return 'Agent failed';
    case 'model.requested':
      return `${redactedSummary(p['model'], 'model')} requested`;
    case 'model.responded':
      return `${redactedSummary(p['model'], 'model')} responded`;
    case 'model.failed':
      return `${redactedSummary(p['model'], 'model')} failed`;
    case 'tool.requested':
      return `${redactedSummary(p['tool'], 'tool')} requested`;
    case 'tool.succeeded':
      return `${redactedSummary(p['tool'], 'tool')} succeeded`;
    case 'tool.failed':
      return `${redactedSummary(p['tool'], 'tool')} failed`;
    default:
      return platformSummary(event, OUTCOME_OF[event.type] ?? 'informational');
  }
}
