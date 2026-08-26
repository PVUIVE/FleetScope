import type { CanonicalEvent } from '@fleetscope/event-schema';
import type { ObservableCaseState } from '@fleetscope/domain';
import type { RenderManifest, RenderManifestEntry } from '@fleetscope/scenario-compiler';
import { CAPABILITY_TRUTH } from '@fleetscope/platform-adapters';
import type { ExecutionModeKey } from './status';

/**
 * Decision Evidence, prepared for display.
 *
 * # What this is not
 *
 * It is not chain-of-thought, not a prompt, and not a reconstruction. Every
 * field below is copied from a recorded Canonical Event, the Render Manifest, or
 * the Observable Case State. Where the evidence is silent the field is `null`
 * and the UI says "Not recorded" — it never fills a gap with a plausible value.
 *
 * # Why the execution mode is derived here
 *
 * A viewer must never mistake a synthetic control decision for a vendor
 * response. The mode is read from the event itself when the event declares one
 * (a live proof does), and otherwise from the capability truth table — the same
 * table the Audit view renders. It is never inferred from whether a service
 * happens to be configured.
 */

export interface EvidenceField {
  readonly label: string;
  readonly value: string | null;
  readonly mono?: boolean;
}

export interface EvidenceGroup {
  readonly title: string;
  readonly fields: readonly EvidenceField[];
}

export interface EvidenceRecord {
  readonly eventId: string;
  readonly caseSequence: number;
  /** 1-based position for humans. caseSequence 15 is "Event 16". */
  readonly humanIndex: number;
  readonly type: string;
  readonly domain: string;
  readonly outcome: string;
  /** Operator-safe label from the Render Manifest. */
  readonly label: string;
  readonly sessionId: string | null;
  readonly actor: string;
  readonly sourceTime: string;
  readonly acceptedTime: string;
  readonly mode: ExecutionModeKey;
  readonly evidenceEventIds: readonly string[];
  readonly rendererEntryCount: number;
  /** One line of business English. Never raw JSON. */
  readonly summary: string;
  readonly groups: readonly EvidenceGroup[];
  /** The redacted canonical payload, for the expandable raw view. */
  readonly payload: Readonly<Record<string, unknown>>;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): string | null => (typeof v === 'number' ? String(v) : null);
const bool = (v: unknown): string | null => (typeof v === 'boolean' ? String(v) : null);

/**
 * Which capability a domain speaks for.
 *
 * `identity`, `gateway` and `armor` are synthetic in this deployment: the
 * ORDERING they enforce is real, the service behind them is not. Saying so is
 * the difference between a demo and a lie.
 */
const DOMAIN_SERVICE: Readonly<Record<string, keyof typeof CAPABILITY_TRUTH | undefined>> = {
  registry: 'registry',
  runtime: 'runtime',
  memory: 'memory',
  identity: 'identity',
  gateway: 'gateway',
  armor: 'armor',
  usage: 'observability',
};

function modeFor(event: CanonicalEvent, domain: string): ExecutionModeKey {
  // An event that declares its own mode wins: a live proof appended to a
  // Recorded Case is live evidence inside recorded evidence, and both facts
  // matter.
  const declared = str(event.payloadRedacted['executionMode']);
  if (declared === 'live') return 'live';
  if (declared === 'synthetic') return 'synthetic';
  if (typeof event.payloadRedacted['simulatedDayBoundary'] === 'number') return 'simulated';

  const service = DOMAIN_SERVICE[domain];
  if (service === undefined) return 'recorded';
  const truth = CAPABILITY_TRUTH[service].mode;
  return truth === 'synthetic' ? 'synthetic' : truth === 'live' ? 'live' : 'recorded';
}

/** Business English for one event. The Cockpit rail and the Workspace share it. */
function summarize(event: CanonicalEvent, entry: RenderManifestEntry): string {
  const p = event.payloadRedacted;
  switch (event.type) {
    case 'case.created':
      return `Case opened for ${str(p['vendor']) ?? 'a vendor'}.`;
    case 'registry.version_resolved':
      return `The Registry resolved the Agent Version and recorded it as ${str(p['approvalState']) ?? 'unlabelled'}.`;
    case 'runtime.started':
      return 'A Runtime Session started.';
    case 'runtime.waiting':
      return `The Runtime parked, waiting for ${str(p['waitingFor']) ?? 'an external signal'}.`;
    case 'runtime.resumed':
      return typeof p['simulatedDayBoundary'] === 'number'
        ? `A new Runtime Session resumed the Case on simulated day ${String(p['simulatedDayBoundary'])}.`
        : `The Runtime resumed on ${str(p['trigger']) ?? 'a recorded trigger'}.`;
    case 'runtime.controlled':
      return `The Runtime applied a control operation (${str(p['operation']) ?? 'unrecorded'}) and reported "${str(p['result']) ?? 'no result'}".`;
    case 'runtime.completed':
      return 'The Runtime reported the Case complete.';
    case 'agent.spawned':
      return `A ${str(p['role']) ?? 'delegated'} agent was created.`;
    case 'agent.started':
      return 'A delegated agent started work.';
    case 'agent.completed':
      return 'A delegated agent finished its work.';
    case 'identity.allowed':
      return `Agent Identity allowed ${str(p['requestedRole']) ?? 'a role'} on ${str(p['resource']) ?? 'a protected resource'}.`;
    case 'identity.denied':
      return `Agent Identity denied ${str(p['requestedRole']) ?? 'a role'} on ${str(p['resource']) ?? 'a protected resource'}. No downstream action followed.`;
    case 'gateway.routed':
      return `The Agent Gateway routed a delegation for ${str(p['requestedCapability']) ?? 'a capability'}.`;
    case 'gateway.denied':
      return `The Agent Gateway refused a delegation for ${str(p['requestedCapability']) ?? 'a capability'}. No child agent was created.`;
    case 'armor.allowed':
      return 'Model Armor screened incoming content and allowed it.';
    case 'armor.sanitized':
      return 'Model Armor modified incoming content by policy and allowed it through.';
    case 'armor.flagged':
      return 'Model Armor allowed incoming content and recorded a finding.';
    case 'armor.blocked':
      return `Model Armor blocked incoming content (${str(p['findingClass']) ?? 'finding not recorded'}). It reached no context, memory or tool.`;
    case 'memory.written':
      return `Recorded to Memory: ${str(p['summary']) ?? 'a fact'}.`;
    case 'memory.recalled':
      return `Recalled from Memory: ${str(p['summary']) ?? 'a fact'}.`;
    case 'memory.rejected':
      return `A Memory write was refused (${str(p['reason']) ?? 'reason not recorded'}).`;
    case 'tool.requested':
      return `${str(p['tool']) ?? 'A tool'} was requested.`;
    case 'tool.succeeded':
      return `${str(p['tool']) ?? 'A tool'} returned: ${str(p['resultSummary']) ?? 'a recorded result'}.`;
    case 'tool.failed':
      return `${str(p['tool']) ?? 'A tool'} failed (${str(p['errorClass']) ?? 'cause not recorded'}).`;
    case 'incident.opened':
      return `An incident opened: ${str(p['incidentClass']) ?? 'unclassified'}.`;
    case 'incident.resolved':
      return `The incident closed (${str(p['resolution']) ?? 'resolved'}).`;
    case 'policy.evaluated':
      return `Policy chose "${str(p['disposition']) ?? 'a disposition'}"${str(p['actionTemplate']) === null ? '' : ` for ${str(p['actionTemplate'])}`}.`;
    case 'intervention.proposed':
      return `Warden proposed a bounded ${str(p['operation']) ?? 'action'} on ${str(p['target']) ?? 'a target'}.`;
    case 'intervention.authorized':
      return `The intervention was authorized by ${str(p['authorizationSource']) ?? 'an unrecorded source'}.`;
    case 'intervention.rejected':
      return 'The intervention was rejected and never requested.';
    case 'intervention.requested':
      return 'FleetScope asked the Runtime to perform the intervention.';
    case 'intervention.acknowledged':
      return 'The Runtime acknowledged the intervention request.';
    case 'intervention.succeeded':
      return 'The Runtime confirmed the intervention succeeded.';
    case 'intervention.failed':
      return 'The Runtime reported the intervention failed.';
    case 'intervention.timed_out':
      return 'No authoritative Runtime result arrived. The outcome is unknown, not failed.';
    case 'human_escalation.opened':
      return `An operator decision was requested for ${str(p['actionTemplate']) ?? 'an action'}.`;
    case 'human_escalation.resolved':
      return `An operator ${str(p['decision']) ?? 'decided'} the request.`;
    case 'case.milestone_changed':
      return `The Case moved to the ${str(p['milestone']) ?? 'next'} milestone.`;
    case 'usage.recorded':
      return 'Usage totals were recorded for this segment.';
    default:
      return entry.label;
  }
}

/** Domain-specific detail groups. Only fields the evidence actually carries. */
function detailGroups(event: CanonicalEvent, entry: RenderManifestEntry): EvidenceGroup[] {
  const p = event.payloadRedacted;
  const groups: EvidenceGroup[] = [];
  const add = (title: string, fields: readonly EvidenceField[]): void => {
    const kept = fields.filter((field) => field.value !== null && field.value !== '');
    if (kept.length > 0) groups.push({ title, fields: kept });
  };

  switch (entry.domain) {
    case 'registry':
      add('Agent Version', [
        { label: 'Version reference', value: str(p['agentVersionRef']), mono: true },
        { label: 'Digest', value: str(p['digest']), mono: true },
        { label: 'Approval state', value: str(p['approvalState']) },
        { label: 'Owner', value: str(p['owner']) },
      ]);
      break;
    case 'identity':
      add('Identity decision', [
        { label: 'Requested role', value: str(p['requestedRole']), mono: true },
        { label: 'Audience', value: str(p['audience']), mono: true },
        { label: 'Resource', value: str(p['resource']), mono: true },
        { label: 'Reason', value: str(p['reason']) },
        { label: 'Token lifetime (s)', value: num(p['expiresIn']) },
      ]);
      break;
    case 'gateway':
      add('Gateway decision', [
        { label: 'Requested capability', value: str(p['requestedCapability']), mono: true },
        { label: 'Route policy', value: str(p['routePolicyRef']), mono: true },
        { label: 'Reason', value: str(p['reason']) },
      ]);
      break;
    case 'armor':
      add('Screening decision', [
        { label: 'Channel', value: str(p['channel']) },
        { label: 'Finding class', value: str(p['findingClass']) },
        { label: 'Detector policy', value: str(p['policyVersion']), mono: true },
        { label: 'Input digest', value: str(p['inputDigest']), mono: true },
        {
          label: 'Downstream use',
          value:
            event.type === 'armor.blocked'
              ? 'Blocked content reaches no context, memory or tool. FleetScope records a violation if it ever does.'
              : null,
        },
      ]);
      break;
    case 'memory':
      add('Memory Record', [
        { label: 'Summary', value: str(p['summary']) },
        { label: 'Sensitivity', value: str(p['sensitivity']) },
        { label: 'Retrieval reference', value: str(p['retrievalReference']), mono: true },
        { label: 'Used by', value: str(p['usedBy']), mono: true },
        { label: 'Rejection reason', value: str(p['reason']) },
      ]);
      break;
    case 'tool':
      add('Tool call', [
        { label: 'Tool', value: str(p['tool']), mono: true },
        { label: 'Arguments', value: str(p['argumentsRedacted']), mono: true },
        { label: 'Result summary', value: str(p['resultSummary']) },
        { label: 'Error class', value: str(p['errorClass']) },
        { label: 'Duration (ms)', value: num(p['durationMs']) },
        { label: 'Adapter', value: str(p['adapter']), mono: true },
        { label: 'Approval used', value: str(p['approvalId']), mono: true },
        { label: 'Classification', value: str(p['classification']) },
        { label: 'Confidence', value: num(p['confidence']) },
      ]);
      break;
    case 'incident':
      add('Incident', [
        { label: 'Incident class', value: str(p['incidentClass']), mono: true },
        { label: 'Detector', value: str(p['detectorId']), mono: true },
        { label: 'Detector version', value: str(p['detectorVersion']), mono: true },
        { label: 'Severity', value: str(p['severity']) },
        { label: 'Threshold', value: num(p['threshold']) },
        { label: 'Advisory only', value: bool(p['advisoryOnly']) },
        { label: 'Resolution', value: str(p['resolution']) },
        { label: 'Follow-up', value: str(p['followUp']) },
        { label: 'Note', value: str(p['note']) },
      ]);
      break;
    case 'policy':
      add('Policy decision', [
        { label: 'Disposition', value: str(p['disposition']) },
        { label: 'Action template', value: str(p['actionTemplate']), mono: true },
        { label: 'Policy version', value: str(p['policyVersion']), mono: true },
        { label: 'Rationale', value: str(p['rationale']) },
        { label: 'Attempt budget', value: num(p['attemptBudget']) },
      ]);
      break;
    case 'intervention':
      add('Intervention', [
        { label: 'Action template', value: str(p['actionTemplate']), mono: true },
        { label: 'Operation', value: str(p['operation']) },
        { label: 'Target', value: str(p['target']), mono: true },
        { label: 'Authorization source', value: str(p['authorizationSource']) },
        { label: 'Acknowledged by', value: str(p['acknowledgedBy']), mono: true },
        { label: 'Authoritative result', value: str(p['authoritativeResult']) },
      ]);
      break;
    case 'approval':
      add('Approval', [
        { label: 'Action template', value: str(p['actionTemplate']), mono: true },
        { label: 'Target', value: str(p['target']), mono: true },
        { label: 'Bound to evidence', value: num(p['boundCaseSequence']) },
        { label: 'Expires', value: str(p['expiresAt']), mono: true },
        { label: 'Decision', value: str(p['decision']) },
        { label: 'Approver', value: str(p['approver']), mono: true },
      ]);
      break;
    case 'runtime':
      add('Runtime', [
        { label: 'State', value: str(p['state']) },
        { label: 'Waiting for', value: str(p['waitingFor']) },
        { label: 'Expected signal', value: str(p['expectedSignal']), mono: true },
        { label: 'Trigger', value: str(p['trigger']), mono: true },
        { label: 'Operation', value: str(p['operation']) },
        { label: 'Result', value: str(p['result']) },
        {
          label: 'Simulated day boundary',
          value:
            typeof p['simulatedDayBoundary'] === 'number'
              ? `Simulated Day ${String(p['simulatedDayBoundary'])} — a separate Runtime invocation, not elapsed real time`
              : null,
        },
      ]);
      break;
    case 'usage':
      add('Recorded usage', [
        { label: 'Input tokens', value: num(p['inputTokens']) },
        { label: 'Output tokens', value: num(p['outputTokens']) },
        { label: 'Tool calls', value: num(p['toolCalls']) },
        { label: 'Estimated cost (USD)', value: num(p['estimatedCostUsd']) },
      ]);
      break;
    case 'agent':
      add('Agent', [
        { label: 'Role', value: str(p['role']) },
        { label: 'Output tokens', value: num(p['outputTokens']) },
      ]);
      break;
    case 'case':
      add('Case', [
        { label: 'Vendor', value: str(p['vendor']) },
        { label: 'Objective', value: str(p['objective']) },
        { label: 'Milestone', value: str(p['milestone']) },
        { label: 'Previous milestone', value: str(p['previousMilestone']) },
        { label: 'Target completion', value: str(p['targetCompletion']), mono: true },
      ]);
      break;
  }

  // A model contribution is recorded wherever one exists, and labelled as
  // advice. Advice is never authority (Invariant 11).
  const modelReference = p['modelReference'];
  if (typeof modelReference === 'object' && modelReference !== null) {
    const reference = modelReference as Record<string, unknown>;
    add('Model contribution (advice, never authority)', [
      { label: 'Model', value: str(reference['model']), mono: true },
      { label: 'Response reference', value: str(reference['responseRef']), mono: true },
    ]);
  }

  return groups;
}

export function buildEvidenceRecords(
  events: readonly CanonicalEvent[],
  manifest: RenderManifest,
): EvidenceRecord[] {
  const byEventId = new Map(events.map((event) => [event.eventId, event]));
  const records: EvidenceRecord[] = [];

  for (const entry of manifest.entries) {
    const event = byEventId.get(entry.eventId);
    if (event === undefined) continue;
    records.push({
      eventId: entry.eventId,
      caseSequence: entry.caseSequence,
      humanIndex: entry.caseSequence + 1,
      type: event.type,
      domain: entry.domain,
      outcome: entry.outcome,
      label: entry.label,
      sessionId: event.sessionId,
      actor: `${event.actor.kind}:${event.actor.id}`,
      sourceTime: event.sourceTime,
      acceptedTime: event.acceptedTime,
      mode: modeFor(event, entry.domain),
      evidenceEventIds: entry.evidenceEventIds,
      rendererEntryCount: entry.rendererEntryCount,
      summary: summarize(event, entry),
      groups: detailGroups(event, entry),
      payload: event.payloadRedacted,
    });
  }

  return records;
}

/**
 * The narrative activity feed, in business language.
 *
 * Deliberately a subset: plumbing (`tool.requested`, `agent.started`) is real
 * evidence but it is not progress, and a feed that lists it buries the four
 * things a procurement manager actually needs to see.
 */
const NARRATIVE_DOMAINS = new Set([
  'identity',
  'gateway',
  'armor',
  'memory',
  'incident',
  'policy',
  'intervention',
  'approval',
]);
const NARRATIVE_TYPES = new Set([
  'tool.succeeded',
  'tool.failed',
  'agent.completed',
  'runtime.completed',
  'runtime.waiting',
  'runtime.resumed',
  'case.created',
]);

export function narrativeActivity(
  records: readonly EvidenceRecord[],
  limit = 10,
): EvidenceRecord[] {
  return records
    .filter(
      (record) =>
        NARRATIVE_TYPES.has(record.type) ||
        (NARRATIVE_DOMAINS.has(record.domain) && record.type !== 'tool.requested'),
    )
    .slice(-limit)
    .reverse();
}

/** Everything the Case knows about one incident, gathered for a detail panel. */
export interface IncidentView {
  readonly incidentId: string;
  readonly incidentClass: string;
  readonly severity: string;
  readonly state: string;
  readonly detector: string;
  readonly detectorVersion: string;
  readonly openedAt: string;
  readonly evidenceEventIds: readonly string[];
  readonly detectedBecause: string;
  readonly policy: {
    readonly disposition: string;
    readonly policyVersion: string;
    readonly rationale: string;
  } | null;
  readonly interventionIds: readonly string[];
  /** The first recorded failure that led here, for a "jump to first failure". */
  readonly firstEvidenceCaseSequence: number | null;
  readonly incidentCaseSequence: number | null;
}

const DETECTION_COPY: Readonly<Record<string, string>> = {
  repeated_tool_failure:
    'The same tool failed repeatedly with the same normalized error class, past the detector threshold.',
  no_progress_loop: 'The Case produced no new progress evidence across repeated attempts.',
  usage_threshold_breach: 'Recorded usage crossed the configured threshold for this Case.',
  context_drift:
    'Screened content diverged from the Case context. Advisory only — this class must not auto-act.',
};

export function incidentViews(
  state: ObservableCaseState,
  events: readonly CanonicalEvent[],
): IncidentView[] {
  const sequenceOf = new Map(events.map((event) => [event.eventId, event.caseSequence]));
  return state.incidents.map((incident) => {
    const policy =
      state.policyDecisions.find((decision) => decision.incidentId === incident.incidentId) ?? null;
    const sequences = incident.evidenceEventIds
      .map((id) => sequenceOf.get(id))
      .filter((value): value is number => value !== undefined);
    const openedEvent = events.find(
      (event) =>
        event.type === 'incident.opened' &&
        event.payloadRedacted['incidentClass'] === incident.incidentClass,
    );
    return {
      incidentId: incident.incidentId,
      incidentClass: incident.incidentClass,
      severity: incident.severity,
      state: incident.state,
      detector: incident.detectorId,
      detectorVersion: incident.detectorVersion,
      openedAt: incident.openedAt,
      evidenceEventIds: incident.evidenceEventIds,
      detectedBecause:
        DETECTION_COPY[incident.incidentClass] ??
        'A detector recorded a finding against this Case.',
      policy:
        policy === null
          ? null
          : {
              disposition: policy.disposition,
              policyVersion: policy.policyVersion,
              rationale: policy.rationale,
            },
      interventionIds: state.interventions
        .filter((intervention) => intervention.incidentId === incident.incidentId)
        .map((intervention) => intervention.interventionId),
      firstEvidenceCaseSequence: sequences.length === 0 ? null : Math.min(...sequences),
      incidentCaseSequence: openedEvent?.caseSequence ?? null,
    };
  });
}
