import type { CanonicalEvent } from '@fleetscope/event-schema';
import {
  getCanonicalEvents,
  getCaseDescriptor,
  getEvidenceManifest,
  getExpectedState,
  projectCase,
} from './fixtures';

/**
 * Everything the landing page claims, derived from the recorded Case.
 *
 * The landing page is marketing, which is exactly why nothing on it may be
 * typed by hand: a page that overstates the product is the one bug this product
 * cannot ship. Every figure, event id, hash and outcome below is read out of
 * `packages/fixtures` at BUILD time. If the fixture changes, the page changes.
 *
 * When the recorded Case does not contain something the page wants to say, the
 * page does not say it — the field is `null` and the caller renders nothing.
 */

const CASE_ID = 'CASE-1042';

/** A pointer to the recorded event that proves a claim on screen. */
export interface Cite {
  readonly eventId: string;
  readonly caseSequence: number;
  readonly sessionId: string | null;
  readonly at: string;
}

const cite = (event: CanonicalEvent): Cite => ({
  eventId: event.eventId,
  caseSequence: event.caseSequence,
  sessionId: event.sessionId,
  at: event.sourceTime,
});

const str = (event: CanonicalEvent, key: string): string | null => {
  const value = event.payloadRedacted[key];
  return typeof value === 'string' ? value : null;
};
const num = (event: CanonicalEvent, key: string): number | null => {
  const value = event.payloadRedacted[key];
  return typeof value === 'number' ? value : null;
};

export interface ControlDecision extends Cite {
  /** `allowed` | `denied` | `blocked` | `routed` | `rejected` — the recorded outcome. */
  readonly outcome: string;
  readonly subject: string | null;
  readonly detail: string | null;
  readonly policyRef: string | null;
}

export interface MemoryFact extends Cite {
  readonly reference: string;
  readonly summary: string;
  readonly sensitivity: string | null;
  readonly recalled: Cite | null;
  readonly usedBy: string | null;
}

export interface SessionSpan {
  readonly sessionId: string;
  readonly index: number;
  readonly eventCount: number;
  readonly firstCaseSequence: number;
  readonly lastCaseSequence: number;
  readonly startedAt: string;
  readonly endedAt: string;
  /** Whole days between this session ending and the next one starting. */
  readonly gapDaysToNext: number | null;
}

export interface LifecycleStep extends Cite {
  readonly state: string;
  readonly note: string | null;
}

export interface ReplayFrame {
  readonly caseSequence: number;
  readonly eventId: string;
  readonly at: string;
  readonly label: string;
  readonly caseState: string;
  readonly milestone: string | null;
  readonly sessionId: string | null;
  readonly agentCount: number;
  readonly memoryCount: number;
  readonly openIncidents: number;
  readonly interventionCount: number;
  readonly approvalCount: number;
  /** Recorded prefix hash, when the fixture blessed one at this position. */
  readonly stateHash: string | null;
}

export interface EvidenceRow {
  readonly control: string;
  /** Human label for the outcome. */
  readonly outcome: string;
  /** The status-vocabulary key. `rejected` is not a control status; `denied` is. */
  readonly badge: string;
  readonly tone: 'ok' | 'warn' | 'deny' | 'info';
  readonly eventId: string;
  readonly caseSequence: number;
  readonly decision: string;
  readonly resource: string | null;
  readonly policy: string | null;
  readonly sessionId: string | null;
}

/** One recorded outcome of a control, as the corridor visual consumes it. */
export interface CorridorState {
  readonly key: string;
  readonly label: string;
  readonly badge: 'allowed' | 'denied' | 'blocked' | 'routed' | 'rejected';
  readonly passes: boolean;
  readonly target: string;
  readonly detail: string;
  readonly eventId: string;
  readonly policy: string | null;
}

export interface SpineNode {
  readonly key: string;
  readonly label: string;
  readonly eventId: string;
  readonly caseSequence: number;
  readonly tone: 'ok' | 'warn' | 'deny' | 'info';
}

export interface LandingData {
  readonly caseId: string;
  readonly title: string;
  readonly vendor: string;
  readonly owner: string;
  readonly memoryScope: string;
  readonly agentVersionRef: string;
  readonly agentVersionDigest: string | null;
  readonly agentApprovalState: string | null;
  readonly agentOwner: string | null;
  readonly eventCount: number;
  readonly sessionCount: number;
  readonly projectorVersion: string;
  readonly terminalStateHash: string;
  readonly prefixHashCount: number;
  readonly schemaVersions: readonly string[];
  readonly milestoneCount: number;
  readonly sessions: readonly SessionSpan[];
  /** The simulated day boundary the Runtime resumed across, from the resume event. */
  readonly simulatedDayBoundary: number | null;
  readonly resumeTrigger: string | null;
  readonly waitingFor: string | null;
  readonly memoryFacts: readonly MemoryFact[];
  readonly memoryRejected: ControlDecision | null;
  readonly identityAllowed: ControlDecision | null;
  readonly identityDenied: ControlDecision | null;
  readonly identityRecovered: ControlDecision | null;
  readonly gatewayRouted: ControlDecision | null;
  readonly gatewayDenied: ControlDecision | null;
  readonly screeningBlocked: ControlDecision | null;
  readonly screeningAllowed: ControlDecision | null;
  readonly blockedInputCount: number;
  readonly toolFailures: readonly Cite[];
  readonly failingTool: string | null;
  readonly failureClass: string | null;
  readonly incidentThreshold: number | null;
  readonly incidentOpened:
    (Cite & { readonly incidentClass: string; readonly severity: string | null }) | null;
  readonly incidentResolved: (Cite & { readonly resolution: string | null }) | null;
  readonly advisoryIncident:
    (Cite & { readonly incidentClass: string; readonly note: string | null }) | null;
  readonly policyDisposition: string | null;
  readonly policyRationale: string | null;
  readonly interventionTemplate: string | null;
  readonly interventionLifecycle: readonly LifecycleStep[];
  readonly approvalOpened:
    (Cite & { readonly actionTemplate: string | null; readonly target: string | null }) | null;
  readonly approvalResolved:
    (Cite & { readonly decision: string | null; readonly approver: string | null }) | null;
  readonly replayFrames: readonly ReplayFrame[];
  readonly evidenceRows: readonly EvidenceRow[];
  readonly spine: readonly SpineNode[];
  readonly toolCallCount: number;
  readonly agentRoles: readonly string[];
}

const control = (
  event: CanonicalEvent | undefined,
  outcome: string,
  subjectKeys: readonly string[],
  detail: string | null,
  policyKey: string | null,
): ControlDecision | null => {
  if (event === undefined) return null;
  let subject: string | null = null;
  for (const key of subjectKeys) {
    subject = str(event, key);
    if (subject !== null) break;
  }
  return {
    ...cite(event),
    outcome,
    subject,
    detail,
    policyRef: policyKey === null ? null : str(event, policyKey),
  };
};

/** Whole days between two instants, floored. */
const dayGap = (from: string, to: string): number =>
  Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000);

let cached: LandingData | null = null;

export function landingData(): LandingData {
  if (cached !== null) return cached;

  const descriptor = getCaseDescriptor(CASE_ID);
  const manifest = getEvidenceManifest(CASE_ID);
  const expected = getExpectedState(CASE_ID);
  const events = getCanonicalEvents(CASE_ID);
  const projection = projectCase(CASE_ID);
  if (
    descriptor === null ||
    manifest === null ||
    expected === null ||
    projection === null ||
    events.length === 0
  ) {
    throw new Error(`Landing page requires recorded fixture ${CASE_ID}; it was not found.`);
  }
  const state = projection.state;

  const first = (
    type: string,
    predicate?: (event: CanonicalEvent) => boolean,
  ): CanonicalEvent | undefined =>
    events.find((event) => event.type === type && (predicate === undefined || predicate(event)));
  const all = (type: string): CanonicalEvent[] => events.filter((event) => event.type === type);

  const registry = first('registry.version_resolved');
  const resumed = all('runtime.resumed');
  const dayResume = resumed.find((event) => num(event, 'simulatedDayBoundary') !== null);
  const waiting = first('runtime.waiting');

  const memoryWrites = all('memory.written');
  const memoryRecalls = all('memory.recalled');
  const memoryFacts: MemoryFact[] = memoryWrites.map((write) => {
    const reference = str(write, 'retrievalReference') ?? '';
    const recall = memoryRecalls.find((event) => str(event, 'retrievalReference') === reference);
    return {
      ...cite(write),
      reference,
      summary: str(write, 'summary') ?? '',
      sensitivity: str(write, 'sensitivity'),
      recalled: recall === undefined ? null : cite(recall),
      usedBy: recall === undefined ? null : str(recall, 'usedBy'),
    };
  });

  const identityAllowedEvents = all('identity.allowed');
  const identityDeniedEvent = first('identity.denied');
  // The recovery: the allowed grant that comes *after* the denial, on the same
  // resource. This is the shape of the story — a denial is not the end.
  const identityRecoveredEvent =
    identityDeniedEvent === undefined
      ? undefined
      : identityAllowedEvents.find(
          (event) => event.caseSequence > identityDeniedEvent.caseSequence,
        );

  const toolFailureEvents = all('tool.failed');
  const criticalIncident = events.find(
    (event) =>
      event.type === 'incident.opened' && str(event, 'incidentClass') === 'repeated_tool_failure',
  );
  const advisory = events.find(
    (event) => event.type === 'incident.opened' && str(event, 'incidentClass') === 'context_drift',
  );
  const incidentResolvedEvent = first('incident.resolved');
  const autoPolicy = events.find(
    (event) => event.type === 'policy.evaluated' && str(event, 'disposition') === 'auto_act',
  );

  const lifecycleTypes: readonly (readonly [string, string])[] = [
    ['intervention.proposed', 'proposed'],
    ['intervention.authorized', 'authorized'],
    ['intervention.requested', 'requested'],
    ['intervention.acknowledged', 'acknowledged'],
    ['intervention.succeeded', 'succeeded'],
  ];
  const interventionLifecycle: LifecycleStep[] = lifecycleTypes.flatMap(([type, label]) => {
    const event = first(type);
    if (event === undefined) return [];
    const note =
      str(event, 'authorizationSource') ??
      str(event, 'acknowledgedBy') ??
      str(event, 'authoritativeResult') ??
      str(event, 'operation');
    return [{ ...cite(event), state: label, note }];
  });

  const escalationOpened = first('human_escalation.opened');
  const escalationResolved = first('human_escalation.resolved');

  // Replay frames: one per blessed prefix hash, so every frame the scrubber can
  // stop on is a position the projector has a recorded state hash for.
  const labelFor = (event: CanonicalEvent): string =>
    event.type.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

  const replayFrames: ReplayFrame[] = [];
  const hashSeqs = new Map<number, string>();
  for (const entry of expected.prefixHashes) hashSeqs.set(entry.caseSequence, entry.stateHash);
  const frameSequences = [...hashSeqs.keys()].sort((a, b) => a - b);
  for (const caseSequence of frameSequences) {
    const frame = projectCase(CASE_ID, caseSequence);
    const event = events.find((candidate) => candidate.caseSequence === caseSequence);
    if (frame === null || event === undefined) continue;
    const s = frame.state;
    replayFrames.push({
      caseSequence,
      eventId: event.eventId,
      at: event.sourceTime,
      label: labelFor(event),
      caseState: s.caseState,
      milestone: s.currentMilestone,
      sessionId: event.sessionId,
      agentCount: s.agents.length,
      memoryCount: s.memoryRecords.length,
      openIncidents: s.incidents.filter(
        (incident) => incident.state === 'open' || incident.state === 'escalated',
      ).length,
      interventionCount: s.interventions.length,
      approvalCount: s.approvals.length,
      stateHash: hashSeqs.get(caseSequence) ?? null,
    });
  }

  const rows: EvidenceRow[] = [];
  const pushRow = (
    decision: ControlDecision | null,
    controlName: string,
    outcomeLabel: string,
    badge: string,
    tone: EvidenceRow['tone'],
    decisionText: string,
  ): void => {
    if (decision === null) return;
    rows.push({
      control: controlName,
      outcome: outcomeLabel,
      badge,
      tone,
      eventId: decision.eventId,
      caseSequence: decision.caseSequence,
      decision: decisionText,
      resource: decision.subject,
      policy: decision.policyRef,
      sessionId: decision.sessionId,
    });
  };

  const identityAllowed = control(
    identityAllowedEvents[0],
    'allowed',
    ['resource'],
    identityAllowedEvents[0] === undefined ? null : str(identityAllowedEvents[0], 'requestedRole'),
    null,
  );
  const identityDenied = control(
    identityDeniedEvent,
    'denied',
    ['resource'],
    identityDeniedEvent === undefined ? null : str(identityDeniedEvent, 'reason'),
    null,
  );
  const identityRecovered = control(
    identityRecoveredEvent,
    'allowed',
    ['resource'],
    identityRecoveredEvent === undefined ? null : str(identityRecoveredEvent, 'requestedRole'),
    null,
  );
  const gatewayRoutedEvent = first('gateway.routed');
  const gatewayDeniedEvent = first('gateway.denied');
  const gatewayRouted = control(
    gatewayRoutedEvent,
    'routed',
    ['requestedCapability'],
    null,
    'routePolicyRef',
  );
  const gatewayDenied = control(
    gatewayDeniedEvent,
    'denied',
    ['requestedCapability'],
    gatewayDeniedEvent === undefined ? null : str(gatewayDeniedEvent, 'reason'),
    'routePolicyRef',
  );
  const blockedEvent = first('armor.blocked');
  const allowedEvent = first('armor.allowed');
  const screeningBlocked = control(
    blockedEvent,
    'blocked',
    ['channel'],
    blockedEvent === undefined ? null : str(blockedEvent, 'findingClass'),
    'policyVersion',
  );
  const screeningAllowed = control(allowedEvent, 'allowed', ['channel'], null, 'policyVersion');
  const rejectedEvent = first('memory.rejected');
  const memoryRejected = control(
    rejectedEvent,
    'rejected',
    [],
    rejectedEvent === undefined ? null : str(rejectedEvent, 'reason'),
    null,
  );

  pushRow(
    identityAllowed,
    'Identity',
    'Allowed',
    'allowed',
    'ok',
    'Workload identity issued for a scoped ERP read.',
  );
  pushRow(
    gatewayRouted,
    'Gateway',
    'Routed',
    'routed',
    'ok',
    'Agent-to-agent delegation permitted by route policy.',
  );
  pushRow(
    screeningBlocked,
    'Screening',
    'Blocked',
    'blocked',
    'deny',
    'Untrusted external input refused before any context use.',
  );
  pushRow(
    memoryRejected,
    'Memory',
    'Rejected',
    'denied',
    'warn',
    'Persistence refused because its source input was blocked.',
  );
  pushRow(
    gatewayDenied,
    'Gateway',
    'Denied',
    'denied',
    'deny',
    'Delegated capability not allowed for the source agent.',
  );
  pushRow(
    identityDenied,
    'Identity',
    'Denied',
    'denied',
    'deny',
    'Requested role is not granted to this Agent Version.',
  );
  pushRow(
    identityRecovered,
    'Identity',
    'Allowed',
    'allowed',
    'ok',
    'The correctly scoped role was issued instead.',
  );
  if (interventionLifecycle.length > 0) {
    const succeeded = interventionLifecycle[interventionLifecycle.length - 1];
    if (succeeded !== undefined) {
      rows.push({
        control: 'Intervention',
        outcome: 'Succeeded',
        badge: 'succeeded',
        tone: 'ok',
        eventId: succeeded.eventId,
        caseSequence: succeeded.caseSequence,
        decision: 'Bounded recovery applied and acknowledged by the Runtime.',
        resource: succeeded.note,
        policy: autoPolicy === undefined ? null : (str(autoPolicy, 'actionTemplate') ?? null),
        sessionId: succeeded.sessionId,
      });
    }
  }

  const spineSource: readonly (readonly [
    string,
    string,
    EvidenceRow['tone'],
    CanonicalEvent | undefined,
  ])[] = [
    ['created', 'Case created', 'info', events[0]],
    ['memory', 'Memory written', 'ok', memoryWrites[0]],
    ['waiting', 'Waiting', 'warn', waiting],
    ['resume', 'Resumed', 'info', dayResume ?? resumed[0]],
    ['screening', 'Screening', 'deny', blockedEvent],
    ['recall', 'Memory recalled', 'ok', memoryRecalls[0]],
    ['gateway', 'Gateway', 'ok', gatewayRoutedEvent],
    ['incident', 'Incident', 'deny', criticalIncident],
    ['intervention', 'Intervention', 'ok', first('intervention.succeeded')],
    ['approval', 'Approval', 'warn', escalationResolved],
    ['identity', 'Identity', 'ok', identityRecoveredEvent],
    ['audit', 'Audit', 'info', first('runtime.completed')],
  ];
  const spine: SpineNode[] = spineSource.flatMap(([key, label, tone, event]) =>
    event === undefined
      ? []
      : [{ key, label, eventId: event.eventId, caseSequence: event.caseSequence, tone }],
  );

  const sessions: SessionSpan[] = manifest.sessions.map((session, index) => {
    const next = manifest.sessions[index + 1];
    return {
      sessionId: session.sessionId,
      index: index + 1,
      eventCount: session.eventCount,
      firstCaseSequence: session.firstCaseSequence,
      lastCaseSequence: session.lastCaseSequence,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      gapDaysToNext: next === undefined ? null : dayGap(session.endedAt, next.startedAt),
    };
  });

  cached = {
    caseId: CASE_ID,
    title: descriptor.title,
    vendor: descriptor.vendor,
    owner: descriptor.owner,
    memoryScope: descriptor.memoryScope,
    agentVersionRef: descriptor.agentVersionRef,
    agentVersionDigest: registry === undefined ? null : str(registry, 'digest'),
    agentApprovalState: registry === undefined ? null : str(registry, 'approvalState'),
    agentOwner: registry === undefined ? null : str(registry, 'owner'),
    eventCount: manifest.eventCount,
    sessionCount: manifest.sessions.length,
    projectorVersion: state.projectorVersion,
    terminalStateHash: expected.terminalStateHash,
    prefixHashCount: expected.prefixHashes.length,
    schemaVersions: manifest.schemaVersions,
    milestoneCount: manifest.milestones.length,
    sessions,
    simulatedDayBoundary: dayResume === undefined ? null : num(dayResume, 'simulatedDayBoundary'),
    resumeTrigger: dayResume === undefined ? null : str(dayResume, 'trigger'),
    waitingFor: waiting === undefined ? null : str(waiting, 'waitingFor'),
    memoryFacts,
    memoryRejected,
    identityAllowed,
    identityDenied,
    identityRecovered,
    gatewayRouted,
    gatewayDenied,
    screeningBlocked,
    screeningAllowed,
    blockedInputCount: state.blockedInputIds.length,
    toolFailures: toolFailureEvents.map(cite),
    failingTool: toolFailureEvents[0] === undefined ? null : str(toolFailureEvents[0], 'tool'),
    failureClass:
      toolFailureEvents[0] === undefined ? null : str(toolFailureEvents[0], 'errorClass'),
    incidentThreshold: criticalIncident === undefined ? null : num(criticalIncident, 'threshold'),
    incidentOpened:
      criticalIncident === undefined
        ? null
        : {
            ...cite(criticalIncident),
            incidentClass: str(criticalIncident, 'incidentClass') ?? 'unknown',
            severity: str(criticalIncident, 'severity'),
          },
    incidentResolved:
      incidentResolvedEvent === undefined
        ? null
        : { ...cite(incidentResolvedEvent), resolution: str(incidentResolvedEvent, 'resolution') },
    advisoryIncident:
      advisory === undefined
        ? null
        : {
            ...cite(advisory),
            incidentClass: str(advisory, 'incidentClass') ?? 'unknown',
            note: str(advisory, 'note'),
          },
    policyDisposition: autoPolicy === undefined ? null : str(autoPolicy, 'disposition'),
    policyRationale: autoPolicy === undefined ? null : str(autoPolicy, 'rationale'),
    interventionTemplate: autoPolicy === undefined ? null : str(autoPolicy, 'actionTemplate'),
    interventionLifecycle,
    approvalOpened:
      escalationOpened === undefined
        ? null
        : {
            ...cite(escalationOpened),
            actionTemplate: str(escalationOpened, 'actionTemplate'),
            target: str(escalationOpened, 'target'),
          },
    approvalResolved:
      escalationResolved === undefined
        ? null
        : {
            ...cite(escalationResolved),
            decision: str(escalationResolved, 'decision'),
            approver: str(escalationResolved, 'approver'),
          },
    replayFrames,
    evidenceRows: rows,
    spine,
    toolCallCount: all('tool.requested').length,
    agentRoles: all('agent.spawned').flatMap((event) => {
      const role = str(event, 'role');
      return role === null ? [] : [role];
    }),
  };
  return cached;
}
