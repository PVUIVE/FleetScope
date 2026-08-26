import type { CanonicalEvent } from '@fleetscope/event-schema';
import type { RenderManifest } from '@fleetscope/scenario-compiler';

/**
 * The guided walkthrough of a Case.
 *
 * # Why these are predicates, not numbers
 *
 * A phase button that seeks to "62%" or to "caseSequence 24" is wrong the moment
 * the Case gains an event — and a live proof appends events on purpose. Each
 * phase is therefore a QUESTION asked of the recorded evidence ("where was
 * incoming content first blocked?"), answered against the stream at build time.
 * A Case that never blocked anything simply has no Armor phase, rather than a
 * button that seeks somewhere arbitrary and claims something that did not
 * happen.
 *
 * The renderer is then positioned through the Render Manifest, never by ratio.
 */

export interface DemoPhase {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  /** What the operator should be looking at once the seek lands. */
  readonly hint: string;
  readonly caseSequence: number;
  readonly eventId: string;
}

interface PhaseSpec {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly find: (events: readonly CanonicalEvent[]) => CanonicalEvent | undefined;
}

const first = (
  events: readonly CanonicalEvent[],
  predicate: (event: CanonicalEvent) => boolean,
): CanonicalEvent | undefined => events.find(predicate);

const last = (
  events: readonly CanonicalEvent[],
  predicate: (event: CanonicalEvent) => boolean,
): CanonicalEvent | undefined => [...events].reverse().find(predicate);

const isType =
  (...types: string[]) =>
  (event: CanonicalEvent): boolean =>
    types.includes(event.type);

const SPECS: readonly PhaseSpec[] = [
  {
    id: 'start',
    label: 'Start',
    hint: 'The Case opens and the Registry binds it to one Agent Version.',
    find: (events) => first(events, isType('case.created')),
  },
  {
    id: 'memory',
    label: 'Memory',
    hint: 'A durable fact is written with the Canonical Event that produced it.',
    find: (events) => first(events, isType('memory.written')),
  },
  {
    id: 'waiting',
    label: 'Waiting',
    hint: 'The Runtime parks. The Case survives the gap; the Session does not.',
    find: (events) => first(events, isType('runtime.waiting')),
  },
  {
    id: 'resume',
    label: 'Simulated Day Resume',
    hint: 'A new Session resumes the same Case across a simulated day boundary.',
    find: (events) =>
      first(
        events,
        (event) =>
          event.type === 'runtime.resumed' &&
          typeof event.payloadRedacted['simulatedDayBoundary'] === 'number',
      ),
  },
  {
    id: 'armor',
    label: 'Armor',
    hint: 'Incoming content is blocked before it can reach context, memory or a tool.',
    find: (events) => first(events, isType('armor.blocked')),
  },
  {
    id: 'gateway',
    label: 'Gateway',
    hint: 'Delegation to a second agent passes through the Gateway first.',
    find: (events) => first(events, isType('gateway.routed')),
  },
  {
    id: 'failure',
    label: 'Failure',
    hint: 'The delegated tool fails repeatedly with the same error class.',
    find: (events) => first(events, isType('tool.failed')),
  },
  {
    id: 'incident',
    label: 'Incident',
    hint: 'A detector opens an incident. A finding is not proof and grants no authority.',
    find: (events) =>
      first(
        events,
        (event) =>
          event.type === 'incident.opened' && event.payloadRedacted['advisoryOnly'] !== true,
      ) ?? first(events, isType('incident.opened')),
  },
  {
    id: 'policy',
    label: 'Policy',
    hint: 'Policy picks exactly one disposition, capped by the action’s side-effect class.',
    find: (events) => first(events, isType('policy.evaluated')),
  },
  {
    id: 'warden',
    label: 'Warden',
    hint: 'The intervention lifecycle: proposed, authorized, requested, acknowledged, result.',
    find: (events) => first(events, isType('intervention.proposed')),
  },
  {
    id: 'identity',
    label: 'Identity',
    hint: 'Agent Identity denies a role the Agent Version was never granted.',
    find: (events) =>
      first(events, isType('identity.denied')) ?? first(events, isType('identity.allowed')),
  },
  {
    id: 'approval',
    label: 'Approval',
    hint: 'An externally visible write waits for a person, then runs under that approval.',
    find: (events) => first(events, isType('human_escalation.opened')),
  },
  {
    id: 'result',
    label: 'Result',
    hint: 'The Runtime reports the terminal result. FleetScope never infers one.',
    find: (events) =>
      last(events, isType('runtime.completed')) ?? last(events, isType('runtime.failed')),
  },
];

/**
 * Resolve the phases this Case actually supports.
 *
 * A phase whose evidence is absent, or whose event compiled to nothing the
 * renderer can show, is dropped rather than pointed somewhere plausible.
 */
export function demoPhases(
  events: readonly CanonicalEvent[],
  manifest: RenderManifest,
): DemoPhase[] {
  const drawable = new Set(
    manifest.entries.filter((entry) => entry.rendererEntryCount > 0).map((entry) => entry.eventId),
  );
  const seen = new Set<string>();
  const resolved: Omit<DemoPhase, 'index'>[] = [];

  for (const spec of SPECS) {
    const event = spec.find(events);
    if (event === undefined) continue;
    if (!drawable.has(event.eventId)) continue;
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    resolved.push({
      id: spec.id,
      label: spec.label,
      hint: spec.hint,
      caseSequence: event.caseSequence,
      eventId: event.eventId,
    });
  }

  // Chronological, so clicking through them tells the Case's story in order.
  return resolved
    .sort((a, b) => a.caseSequence - b.caseSequence)
    .map((phase, index) => ({ ...phase, index: index + 1 }));
}
