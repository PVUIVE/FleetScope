import type { CanonicalEvent } from '@fleetscope/event-schema';
import type { IncidentCandidate, IncidentClass } from '@fleetscope/domain';
import { canonicalJson, sha256Hex } from '@fleetscope/shared';

/**
 * The Incident Detector.
 *
 * A pure, deterministic function of a Canonical Event prefix. It reads no clock,
 * no network and no model, and it produces the same candidates from the same
 * prefix every time — which is what lets an incident be replayed and audited
 * rather than merely re-observed.
 *
 * # An Incident Candidate is a finding, not a verdict
 *
 * It grants no authority whatsoever. It says "this pattern is present in the
 * recorded evidence, here are the exact events". Whether anything may be DONE
 * about it is the Policy Engine's decision, and whether anything actually
 * happened is the Runtime's to report. Keeping those three apart is why a
 * detector can be this aggressive without being dangerous.
 *
 * # No model involvement
 *
 * Nothing here consults a model. Model advice, where it exists at all, is
 * untrusted advisory data handled in `policy.ts` — it can never be the reason an
 * incident exists.
 */

export const DETECTOR_VERSION = '1.0.0';

export interface DetectorConfig {
  readonly repeatedToolFailure: {
    /** Failures of the same normalized (tool, error class) that constitute an incident. */
    readonly threshold: number;
    /** How many events back the count may reach. */
    readonly windowEvents: number;
  };
  readonly noProgressLoop: {
    /** Repeats of the same normalized action signature with no progress between. */
    readonly threshold: number;
    readonly windowEvents: number;
  };
  readonly usageThreshold: {
    readonly maxOutputTokens: number;
    readonly maxEstimatedCostUsd: number;
  };
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  // Three is the smallest count that distinguishes a systematic failure from a
  // flake plus a retry. Two would fire on ordinary transient error handling.
  repeatedToolFailure: { threshold: 3, windowEvents: 12 },
  noProgressLoop: { threshold: 3, windowEvents: 12 },
  usageThreshold: { maxOutputTokens: 50_000, maxEstimatedCostUsd: 5 },
};

/**
 * Events that constitute PROGRESS.
 *
 * A loop is only a loop if nothing moved. A successful tool call, a memory
 * write, a milestone change or a session transition all mean the Case advanced,
 * so they reset the no-progress window.
 */
const PROGRESS_EVENTS = new Set([
  'tool.succeeded',
  'memory.written',
  'case.milestone_changed',
  'runtime.completed',
  'runtime.waiting',
  'runtime.resumed',
  'agent.completed',
  'intervention.succeeded',
]);

/** Normalize a tool name so `ERP.read` and `erp.read ` are one signature. */
const normalizeTool = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : 'unknown';

/**
 * Deterministic incident id.
 *
 * Derived from the Case, the detector, and the signature it fired on — never
 * from a counter or a clock. Re-running the detector over the same prefix
 * therefore produces the same id, so an incident can be correlated across runs
 * and an intervention can be bound to it.
 */
export function deriveIncidentId(
  caseId: string,
  detectorId: string,
  signature: string,
  triggeringEventId: string,
): string {
  const digest = sha256Hex(
    canonicalJson({ caseId, detectorId, signature, triggeringEventId }),
  ).slice(0, 12);
  return `inc-${digest}`;
}

interface Finding {
  readonly incidentClass: IncidentClass;
  readonly detectorId: string;
  readonly signature: string;
  readonly severity: IncidentCandidate['severity'];
  readonly confidence?: number;
  readonly evidenceEventIds: readonly string[];
  readonly triggeringEvent: CanonicalEvent;
  /** The narrowest action class that could address it. Advisory to the policy. */
  readonly suggestedActionClass: SuggestedActionClass;
}

/**
 * What KIND of action could address the incident.
 *
 * Deliberately a class, not an action: the detector never names a target or
 * parameters. Choosing an actual action is the Policy Engine's job, and letting
 * a detector propose one would make the detector an authority.
 */
export const SUGGESTED_ACTION_CLASSES = [
  'none',
  'retry_idempotent_read',
  'escalate_to_operator',
  'observe_only',
] as const;
export type SuggestedActionClass = (typeof SUGGESTED_ACTION_CLASSES)[number];

export interface DetectedIncident extends IncidentCandidate {
  readonly signature: string;
  readonly suggestedActionClass: SuggestedActionClass;
}

export function detectIncidents(
  events: readonly CanonicalEvent[],
  config: DetectorConfig = DEFAULT_DETECTOR_CONFIG,
): DetectedIncident[] {
  const ordered = [...events].sort((a, b) => a.caseSequence - b.caseSequence);
  const findings: Finding[] = [
    ...detectRepeatedToolFailure(ordered, config),
    ...detectNoProgressLoop(ordered, config),
    ...detectUsageThreshold(ordered, config),
    ...detectContextDrift(ordered),
  ];

  const caseId = ordered[0]?.caseId ?? '';
  return (
    findings
      .map((finding) => ({
        incidentId: deriveIncidentId(
          caseId,
          finding.detectorId,
          finding.signature,
          finding.triggeringEvent.eventId,
        ) as DetectedIncident['incidentId'],
        caseId: caseId as DetectedIncident['caseId'],
        incidentClass: finding.incidentClass,
        detectorId: finding.detectorId,
        detectorVersion: DETECTOR_VERSION,
        severity: finding.severity,
        ...(finding.confidence !== undefined ? { confidence: finding.confidence } : {}),
        evidenceEventIds: finding.evidenceEventIds as DetectedIncident['evidenceEventIds'],
        openedAt: finding.triggeringEvent.sourceTime,
        state: 'open' as const,
        signature: finding.signature,
        suggestedActionClass: finding.suggestedActionClass,
      }))
      // Sorted so the output is a function of the input set, not of detector order.
      .sort((a, b) =>
        a.openedAt === b.openedAt
          ? a.incidentId.localeCompare(b.incidentId)
          : a.openedAt.localeCompare(b.openedAt),
      )
  );
}

/**
 * Repeated tool failure: the same normalized tool AND error class failing more
 * than the threshold within the window.
 *
 * Error class is part of the signature on purpose. A tool that times out three
 * times has one systematic problem; a tool that times out, then 404s, then
 * rate-limits has three different ones, and treating those as one incident would
 * point a recovery at the wrong cause.
 */
function detectRepeatedToolFailure(
  events: readonly CanonicalEvent[],
  config: DetectorConfig,
): Finding[] {
  const { threshold, windowEvents } = config.repeatedToolFailure;
  const findings: Finding[] = [];
  const emitted = new Set<string>();

  for (const [index, event] of events.entries()) {
    if (event.type !== 'tool.failed') continue;

    const tool = normalizeTool(event.payloadRedacted['tool']);
    const errorClass = normalizeTool(event.payloadRedacted['errorClass']);
    const signature = `${tool}|${errorClass}`;
    if (emitted.has(signature)) continue;

    const windowStart = Math.max(0, index - windowEvents + 1);
    const matching = events
      .slice(windowStart, index + 1)
      .filter(
        (candidate) =>
          candidate.type === 'tool.failed' &&
          normalizeTool(candidate.payloadRedacted['tool']) === tool &&
          normalizeTool(candidate.payloadRedacted['errorClass']) === errorClass,
      );

    if (matching.length < threshold) continue;
    emitted.add(signature);
    findings.push({
      incidentClass: 'repeated_tool_failure',
      detectorId: 'repeated-tool-failure',
      signature,
      severity: 'critical',
      evidenceEventIds: matching.map((e) => e.eventId),
      triggeringEvent: event,
      suggestedActionClass: 'retry_idempotent_read',
    });
  }
  return findings;
}

/**
 * No-progress loop: the same normalized action signature repeating with no
 * progress event between the first and last occurrence.
 */
function detectNoProgressLoop(
  events: readonly CanonicalEvent[],
  config: DetectorConfig,
): Finding[] {
  const { threshold, windowEvents } = config.noProgressLoop;
  const findings: Finding[] = [];
  const emitted = new Set<string>();

  for (const [index, event] of events.entries()) {
    if (event.type !== 'tool.requested') continue;

    const signature = `${normalizeTool(event.payloadRedacted['tool'])}|${event.correlations['agentInstanceId'] ?? 'case'}`;
    if (emitted.has(signature)) continue;

    const windowStart = Math.max(0, index - windowEvents + 1);
    const window = events.slice(windowStart, index + 1);
    const repeats = window.filter(
      (candidate) =>
        candidate.type === 'tool.requested' &&
        `${normalizeTool(candidate.payloadRedacted['tool'])}|${candidate.correlations['agentInstanceId'] ?? 'case'}` ===
          signature,
    );
    if (repeats.length < threshold) continue;

    const firstRepeat = repeats[0]!;
    const madeProgress = window.some(
      (candidate) =>
        candidate.caseSequence > firstRepeat.caseSequence && PROGRESS_EVENTS.has(candidate.type),
    );
    if (madeProgress) continue;

    emitted.add(signature);
    findings.push({
      incidentClass: 'no_progress_loop',
      detectorId: 'no-progress-loop',
      signature,
      severity: 'warning',
      evidenceEventIds: repeats.map((e) => e.eventId),
      triggeringEvent: event,
      suggestedActionClass: 'escalate_to_operator',
    });
  }
  return findings;
}

/** Cumulative recorded usage crossing a configured ceiling. */
function detectUsageThreshold(
  events: readonly CanonicalEvent[],
  config: DetectorConfig,
): Finding[] {
  const { maxOutputTokens, maxEstimatedCostUsd } = config.usageThreshold;
  const evidence: string[] = [];
  let tokens = 0;
  let cost = 0;

  for (const event of events) {
    if (event.type !== 'usage.recorded') continue;
    evidence.push(event.eventId);
    const t = event.payloadRedacted['outputTokens'];
    const c = event.payloadRedacted['estimatedCostUsd'];
    if (typeof t === 'number') tokens += t;
    if (typeof c === 'number') cost += c;

    if (tokens > maxOutputTokens || cost > maxEstimatedCostUsd) {
      return [
        {
          incidentClass: 'usage_threshold_breach',
          detectorId: 'usage-threshold',
          signature: tokens > maxOutputTokens ? 'output_tokens' : 'estimated_cost',
          severity: 'warning',
          evidenceEventIds: [...evidence],
          triggeringEvent: event,
          suggestedActionClass: 'escalate_to_operator',
        },
      ];
    }
  }
  return [];
}

/**
 * Context drift — ADVISORY ONLY.
 *
 * Fires when Model Armor blocked an input, because the Case's incoming context
 * demonstrably contained something hostile. It carries a confidence and
 * `observe_only`: FleetScope must never auto-act on drift, because the detector
 * cannot tell a successfully defended attack (which needs nothing) from a
 * partially successful one (which needs a human).
 */
function detectContextDrift(events: readonly CanonicalEvent[]): Finding[] {
  return events
    .filter((event) => event.type === 'armor.blocked')
    .map((event) => ({
      incidentClass: 'context_drift' as const,
      detectorId: 'armor-observer',
      signature: `blocked|${event.correlations['screenedInputId'] ?? event.eventId}`,
      severity: 'warning' as const,
      confidence: 0.5,
      evidenceEventIds: [event.eventId],
      triggeringEvent: event,
      suggestedActionClass: 'observe_only' as const,
    }));
}
