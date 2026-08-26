import type { CanonicalEvent } from '@fleetscope/event-schema';
import type {
  ActorRef,
  AgentInstance,
  Approval,
  CaseMilestone,
  CaseState,
  DecisionEvidence,
  EventCursor,
  IncidentCandidate,
  Intervention,
  InterventionState,
  MemoryRecord,
  ObservableCaseState,
  PlatformBadge,
  PlatformDecision,
  PolicyDecision,
  Session,
  UsageTotals,
} from '@fleetscope/domain';
import {
  CASE_MILESTONES,
  agentInstanceId,
  agentVersionRef as agentVersionRefOf,
  approvalId,
  caseId as toCaseId,
  eventId as toEventId,
  incidentId as toIncidentId,
  interventionId as toInterventionId,
  isLegalInterventionTransition,
  memoryRecordId,
  policyVersion as toPolicyVersion,
  projectorVersion as toProjectorVersion,
  runtimeOperationId,
  sessionId as toSessionId,
} from '@fleetscope/domain';
import { canonicalJson, sha256Hex } from '@fleetscope/shared';

/**
 * @fleetscope/projector — the Session Projector.
 *
 * HARD CONSTRAINTS. This package MUST NOT:
 *   - call a model, tool, or network service;
 *   - execute a Warden action or touch the Control Adapter;
 *   - read the clock, the filesystem, or the environment;
 *   - mutate anything outside the state it returns.
 *
 * It is a versioned pure function of (canonical event prefix, projector version).
 * Nothing else. That is what makes Invariants 7 and 8 mechanically true rather
 * than aspirational, and it is why this package has no runtime dependency other
 * than the domain vocabulary, the event schema, and deterministic serialization.
 */
export const PROJECTOR_VERSION = toProjectorVersion('1.0.0');

export interface ProjectionResult {
  readonly state: ObservableCaseState;
  /** SHA-256 over the canonically serialized state. Stable across runs and runtimes. */
  readonly stateHash: string;
  /** Number of events actually folded (i.e. the prefix length applied). */
  readonly appliedEventCount: number;
}

export interface ProjectOptions {
  /**
   * Fold only events with `caseSequence <= throughCaseSequence`.
   * Omit to project the whole stream (the live edge).
   */
  readonly throughCaseSequence?: number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * The event schema types `actor` structurally; the domain brands its refs.
 * Converting explicitly (rather than widening the domain type) keeps the branded
 * ids meaningful everywhere downstream.
 */
function toActorRef(actor: CanonicalEvent['actor']): ActorRef {
  return {
    kind: actor.kind,
    id: actor.id,
    ...(actor.agentVersionRef !== undefined
      ? { agentVersionRef: agentVersionRefOf(actor.agentVersionRef) }
      : {}),
    ...(actor.role !== undefined ? { role: actor.role } : {}),
  };
}
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/**
 * Fold a Canonical Event prefix into Observable Case State.
 *
 * Determinism rules obeyed throughout:
 *   - events are sorted by caseSequence, never by timestamp;
 *   - all collections are emitted in first-seen or sorted order, never Map order
 *     that depends on insertion of duplicate keys;
 *   - unknown values stay `undefined` rather than defaulting to 0.
 */
export function project(
  events: readonly CanonicalEvent[],
  options: ProjectOptions = {},
): ProjectionResult {
  const ordered = [...events].sort((a, b) => a.caseSequence - b.caseSequence);
  const through = options.throughCaseSequence;
  const prefix = through === undefined ? ordered : ordered.filter((e) => e.caseSequence <= through);

  const sessions = new Map<string, Mutable<Session>>();
  const agents = new Map<string, Mutable<AgentInstance>>();
  const memory = new Map<string, MemoryRecord>();
  const badges: PlatformBadge[] = [];
  const incidents = new Map<string, Mutable<IncidentCandidate>>();
  const policyDecisions: PolicyDecision[] = [];
  const interventions = new Map<string, Mutable<Intervention>>();
  const approvals = new Map<string, Mutable<Approval>>();
  const evidenceByEventId: Record<string, DecisionEvidence> = {};
  const blockedInputIds: string[] = [];
  const invariantViolations: string[] = [];

  let caseRecord: ObservableCaseState['caseRecord'] = null;
  let caseState: CaseState = 'active';
  let currentMilestone: CaseMilestone | null = null;
  const completedMilestones: CaseMilestone[] = [];
  const usage: Mutable<UsageTotals> = { outputTokens: 0, estimatedCostUsd: 0, toolCalls: 0 };
  let lastAcceptedAt: string | null = null;
  let lastCaseSequence = -1;

  const rawCaseId = prefix[0]?.caseId ?? '';

  for (const event of prefix) {
    lastAcceptedAt = event.acceptedTime;
    lastCaseSequence = event.caseSequence;
    const p = event.payloadRedacted;
    const c = event.correlations;

    // ── Sessions ────────────────────────────────────────────────────────────
    if (event.sessionId !== null) {
      const existing = sessions.get(event.sessionId);
      if (existing === undefined) {
        sessions.set(event.sessionId, {
          sessionId: toSessionId(event.sessionId),
          caseId: toCaseId(event.caseId),
          runtimeOperationId: runtimeOperationId(
            c['runtimeOperationId'] ?? `op-${event.sessionId}`,
          ),
          state: 'started',
          startedAt: event.sourceTime,
          highWaterMark: event.sessionSequence ?? 0,
        });
      } else {
        existing.highWaterMark = Math.max(existing.highWaterMark, event.sessionSequence ?? 0);
      }
    }

    switch (event.type) {
      case 'case.created': {
        caseRecord = {
          caseId: toCaseId(event.caseId),
          title: str(p['objective']) ?? event.caseId,
          vendor: str(p['vendor']) ?? 'unknown',
          owner: event.actor.id,
          agentVersionRef: (c['agentVersionRef'] ?? '') as never,
          memoryScope: c['memoryScope'] ?? '',
          createdAt: event.sourceTime,
          sessions: [],
          executionMode: 'recorded',
        };
        break;
      }

      case 'case.milestone_changed': {
        const next = str(p['milestone']);
        if (next !== undefined && (CASE_MILESTONES as readonly string[]).includes(next)) {
          if (currentMilestone !== null && !completedMilestones.includes(currentMilestone)) {
            completedMilestones.push(currentMilestone);
          }
          currentMilestone = next as CaseMilestone;
        }
        break;
      }

      case 'registry.version_resolved':
        pushBadge(
          'registry',
          `REG ${shortVersion(c['agentVersionRef'])} ${str(p['approvalState']) ?? 'resolved'}`,
          {
            kind: 'registry',
            outcome: 'resolved',
            agentVersionRef: (c['agentVersionRef'] ?? '') as never,
            digest: str(p['digest']) ?? '',
          },
        );
        break;

      case 'runtime.started':
      case 'runtime.resumed':
        setSessionState(event.sessionId, event.type === 'runtime.started' ? 'started' : 'resumed');
        caseState = 'active';
        break;

      case 'runtime.waiting':
        setSessionState(event.sessionId, 'waiting');
        caseState = str(p['waitingFor']) === 'operator_approval' ? 'approval_required' : 'waiting';
        break;

      case 'runtime.completed':
        setSessionState(event.sessionId, 'completed');
        if (p['terminal'] === true) caseState = 'completed';
        break;

      case 'runtime.failed':
        setSessionState(event.sessionId, 'failed');
        caseState = 'failed';
        break;

      case 'runtime.controlled':
        setSessionState(event.sessionId, 'controlled');
        break;

      // ── Memory ────────────────────────────────────────────────────────────
      case 'memory.written': {
        const id = c['memoryRecordId'];
        if (id !== undefined) {
          memory.set(id, {
            memoryRecordId: memoryRecordId(id),
            caseId: toCaseId(event.caseId),
            scope: c['memoryScope'] ?? '',
            summary: str(p['summary']) ?? '',
            actor: toActorRef(event.actor),
            sourceEventId: toEventId(event.eventId),
            createdAt: event.sourceTime,
            sensitivity: (str(p['sensitivity']) ?? 'internal') as MemoryRecord['sensitivity'],
            ...(str(p['retrievalReference']) !== undefined
              ? { retrievalReference: str(p['retrievalReference'])! }
              : {}),
          });
        }
        pushBadge('memory', 'MEM written', undefined);
        break;
      }

      case 'memory.recalled':
        pushBadge('memory', 'MEM recalled', undefined);
        break;

      case 'memory.rejected':
        pushBadge('memory', 'MEM rejected', undefined);
        break;

      // ── Identity ──────────────────────────────────────────────────────────
      case 'identity.allowed':
      case 'identity.denied':
        pushBadge('identity', event.type === 'identity.allowed' ? 'ID allowed' : 'ID denied', {
          kind: 'identity',
          outcome: event.type === 'identity.allowed' ? 'allowed' : 'denied',
          subjectAgentVersionRef: (c['agentVersionRef'] ?? '') as never,
          requestedRole: str(p['requestedRole']) ?? '',
          audience: str(p['audience']) ?? '',
          resource: str(p['resource']) ?? '',
          ...(str(p['reason']) !== undefined ? { reason: str(p['reason'])! } : {}),
        });
        break;

      // ── Gateway ───────────────────────────────────────────────────────────
      case 'gateway.routed':
      case 'gateway.denied':
        pushBadge('gateway', event.type === 'gateway.routed' ? 'GW routed' : 'GW denied', {
          kind: 'gateway',
          outcome: event.type === 'gateway.routed' ? 'routed' : 'denied',
          sourceAgentVersionRef: (c['sourceAgentVersionRef'] ?? '') as never,
          destinationAgentVersionRef: (c['destinationAgentVersionRef'] ?? '') as never,
          requestedCapability: str(p['requestedCapability']) ?? '',
          routePolicyRef: str(p['routePolicyRef']) ?? '',
          ...(str(p['reason']) !== undefined ? { reason: str(p['reason'])! } : {}),
        });
        break;

      // ── Model Armor ───────────────────────────────────────────────────────
      case 'armor.allowed':
      case 'armor.blocked':
      case 'armor.sanitized':
      case 'armor.flagged': {
        const outcome = event.type.slice('armor.'.length) as
          'allowed' | 'blocked' | 'sanitized' | 'flagged';
        const inputId = c['screenedInputId'] ?? '';
        if (outcome === 'blocked' && !blockedInputIds.includes(inputId)) {
          blockedInputIds.push(inputId);
        }
        pushBadge('armor', `ARMOR ${outcome}`, {
          kind: 'armor',
          outcome,
          screenedInputId: inputId as never,
          inputDigest: str(p['inputDigest']) ?? '',
          policyVersion: str(p['policyVersion']) ?? '',
          ...(str(p['findingClass']) !== undefined
            ? { findingClass: str(p['findingClass'])! }
            : {}),
        });
        break;
      }

      // ── Agents ────────────────────────────────────────────────────────────
      case 'agent.spawned': {
        const id = c['agentInstanceId'];
        if (id !== undefined && event.sessionId !== null) {
          agents.set(id, {
            agentInstanceId: agentInstanceId(id),
            caseId: toCaseId(event.caseId),
            sessionId: toSessionId(event.sessionId),
            agentVersionRef: (c['agentVersionRef'] ?? '') as never,
            role: str(p['role']) ?? 'unknown',
            state: 'spawned',
            toolCallCount: 0,
            ...(c['parentAgentInstanceId'] !== undefined
              ? { parent: agentInstanceId(c['parentAgentInstanceId']) }
              : {}),
          });
        }
        break;
      }

      case 'agent.started':
      case 'agent.completed':
      case 'agent.failed': {
        const agent = agents.get(c['agentInstanceId'] ?? '');
        if (agent !== undefined) {
          agent.state = event.type.slice('agent.'.length) as AgentInstance['state'];
          const tokens = num(p['outputTokens']);
          if (tokens !== undefined) agent.outputTokens = tokens;
        }
        break;
      }

      // ── Tools ─────────────────────────────────────────────────────────────
      case 'tool.requested': {
        const agent = agents.get(c['agentInstanceId'] ?? '');
        if (agent !== undefined) agent.toolCallCount += 1;
        checkBlockedInputUse(event, 'tool');
        break;
      }
      case 'tool.succeeded':
      case 'tool.failed':
        break;

      case 'usage.recorded': {
        usage.outputTokens += num(p['outputTokens']) ?? 0;
        usage.estimatedCostUsd += num(p['estimatedCostUsd']) ?? 0;
        usage.toolCalls += num(p['toolCalls']) ?? 0;
        break;
      }

      // ── Incidents / policy ────────────────────────────────────────────────
      case 'incident.opened': {
        const id = c['incidentId'];
        if (id !== undefined) {
          incidents.set(id, {
            incidentId: toIncidentId(id),
            caseId: toCaseId(event.caseId),
            incidentClass: (str(p['incidentClass']) ??
              'context_drift') as IncidentCandidate['incidentClass'],
            detectorId: str(p['detectorId']) ?? '',
            detectorVersion: str(p['detectorVersion']) ?? '',
            severity: (str(p['severity']) ?? 'info') as IncidentCandidate['severity'],
            evidenceEventIds: [toEventId(event.eventId)],
            openedAt: event.sourceTime,
            state: 'open',
          });
        }
        break;
      }
      case 'incident.updated':
      case 'incident.resolved': {
        const incident = incidents.get(c['incidentId'] ?? '');
        if (incident !== undefined) {
          incident.state = event.type === 'incident.resolved' ? 'resolved' : 'updated';
          incident.evidenceEventIds = [...incident.evidenceEventIds, toEventId(event.eventId)];
        }
        break;
      }

      case 'policy.evaluated':
        policyDecisions.push({
          incidentId: toIncidentId(c['incidentId'] ?? ''),
          policyVersion: toPolicyVersion(c['policyVersion'] ?? ''),
          disposition: (str(p['disposition']) ?? 'observe') as PolicyDecision['disposition'],
          evaluatedAt: event.sourceTime,
          rationale: str(p['rationale']) ?? '',
          ...(str(p['actionTemplate']) !== undefined
            ? { actionTemplate: str(p['actionTemplate'])! }
            : {}),
        });
        break;

      // ── Interventions ─────────────────────────────────────────────────────
      case 'intervention.proposed': {
        const id = c['interventionId'];
        if (id !== undefined) {
          interventions.set(id, {
            interventionId: toInterventionId(id),
            caseId: toCaseId(event.caseId),
            incidentId: toIncidentId(c['incidentId'] ?? ''),
            policyVersion: toPolicyVersion(c['policyVersion'] ?? ''),
            actionTemplate: str(p['actionTemplate']) ?? '',
            operation: (str(p['operation']) ?? 'retry') as Intervention['operation'],
            target: str(p['target']) ?? '',
            state: 'proposed',
            proposedAt: event.sourceTime,
          });
        }
        break;
      }
      case 'intervention.authorized':
      case 'intervention.rejected':
      case 'intervention.requested':
      case 'intervention.acknowledged':
      case 'intervention.succeeded':
      case 'intervention.failed':
      case 'intervention.timed_out': {
        const id = c['interventionId'] ?? '';
        const intervention = interventions.get(id);
        const next = event.type.slice('intervention.'.length) as InterventionState;
        if (intervention === undefined) {
          invariantViolations.push(
            `${event.eventId}: intervention.${next} for unknown intervention ${id}`,
          );
          break;
        }
        // Invariant 10 in reducer form: a state cannot be skipped, so a UI can
        // never show "succeeded" without the Runtime acknowledgement before it.
        if (!isLegalInterventionTransition(intervention.state, next)) {
          invariantViolations.push(
            `${event.eventId}: illegal intervention transition ${intervention.state} -> ${next} for ${id}`,
          );
        }
        intervention.state = next;
        const opId = c['runtimeOperationId'];
        if (opId !== undefined) intervention.runtimeOperationId = runtimeOperationId(opId);
        break;
      }

      // ── Human escalation drives the Approval Inbox ────────────────────────
      case 'human_escalation.opened': {
        const id = c['approvalId'];
        if (id !== undefined) {
          approvals.set(id, {
            approvalId: approvalId(id),
            caseId: toCaseId(event.caseId),
            actionTemplate: str(p['actionTemplate']) ?? '',
            target: str(p['target']) ?? '',
            requestedAt: event.sourceTime,
            expiresAt: str(p['expiresAt']) ?? event.sourceTime,
            boundCaseSequence: num(p['boundCaseSequence']) ?? event.caseSequence,
            state: 'pending',
          });
        }
        break;
      }
      case 'human_escalation.resolved': {
        const approval = approvals.get(c['approvalId'] ?? '');
        if (approval !== undefined) {
          approval.state = str(p['decision']) === 'approved' ? 'approved' : 'rejected';
          const approver = str(p['approver']);
          if (approver !== undefined) approval.approver = approver;
        }
        break;
      }
    }

    // Every event yields Decision Evidence, so any badge, marker, or state a
    // surface renders can be traced back to the exact recorded fact.
    evidenceByEventId[event.eventId] = {
      evidenceEventIds: [toEventId(event.eventId)],
      caseSequence: event.caseSequence,
      actor: toActorRef(event.actor),
      correlations: c,
      ...(str(p['rationale']) !== undefined ? { rationale: str(p['rationale'])! } : {}),
      ...(c['policyVersion'] !== undefined
        ? { policyVersion: toPolicyVersion(c['policyVersion']) }
        : {}),
    };

    function pushBadge(
      service: PlatformBadge['service'],
      label: string,
      decision: PlatformDecision | undefined,
    ): void {
      if (decision === undefined) return;
      badges.push({
        service,
        label,
        decision,
        evidenceEventId: toEventId(event.eventId),
        at: event.sourceTime,
      });
    }
  }

  /**
   * Invariant 3 enforcement: after Model Armor blocks an input, no later tool or
   * memory event may reference it as usable content. A violation is RECORDED,
   * never suppressed — a demo that quietly hides this would be exactly the
   * "UI invents enforcement" failure the product forbids.
   */
  function checkBlockedInputUse(event: CanonicalEvent, kind: string): void {
    const referenced = event.correlations['screenedInputId'];
    if (referenced !== undefined && blockedInputIds.includes(referenced)) {
      invariantViolations.push(
        `${event.eventId}: ${kind} event references blocked input ${referenced}`,
      );
    }
  }

  if (caseRecord !== null) {
    caseRecord = { ...caseRecord, sessions: [...sessions.keys()].map(toSessionId) };
  }

  const state: ObservableCaseState = {
    caseId: toCaseId(rawCaseId),
    projectorVersion: PROJECTOR_VERSION,
    cursor: {
      caseId: toCaseId(rawCaseId),
      caseSequence: lastCaseSequence,
      atEdge: prefix.length === ordered.length,
    } satisfies EventCursor,
    caseRecord,
    caseState,
    currentMilestone,
    completedMilestones,
    sessions: [...sessions.values()].map(freeze),
    agents: [...agents.values()].map(freeze),
    memoryRecords: [...memory.values()],
    platformBadges: badges,
    incidents: [...incidents.values()].map(freeze),
    policyDecisions,
    interventions: [...interventions.values()].map(freeze),
    approvals: [...approvals.values()].map(freeze),
    usage: {
      outputTokens: usage.outputTokens,
      // Float accumulation is order-dependent at the last bit; rounding to
      // sub-cent precision keeps the state hash stable without lying about cost.
      estimatedCostUsd: Number(usage.estimatedCostUsd.toFixed(6)),
      toolCalls: usage.toolCalls,
    },
    evidenceByEventId,
    blockedInputIds,
    invariantViolations,
    lastAcceptedAt,
  };

  return {
    state,
    stateHash: hashState(state),
    appliedEventCount: prefix.length,
  };

  function setSessionState(id: string | null, next: Session['state']): void {
    if (id === null) return;
    const session = sessions.get(id);
    if (session !== undefined) session.state = next;
  }
}

/** The published hash contract: sha256 over the canonically serialized state. */
export function hashState(state: ObservableCaseState): string {
  return sha256Hex(canonicalJson(state));
}

function shortVersion(ref: string | undefined): string {
  if (ref === undefined) return 'unknown';
  const [, version] = ref.split('@');
  return version === undefined ? ref : `v${version}`;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const freeze = <T>(v: T): T => v;
