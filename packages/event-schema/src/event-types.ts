/**
 * The Canonical Event families required by
 * docs/requirements/fleetscope/audit-and-replay.md and docs/design/system.md.
 *
 * This list is a closed set on purpose: an unknown `type` must be rejected at
 * canonicalization rather than silently projected.
 */
export const EVENT_TYPES = [
  'registry.version_resolved',

  'case.created',
  'case.milestone_changed',

  'runtime.started',
  'runtime.waiting',
  'runtime.resumed',
  'runtime.completed',
  'runtime.failed',
  'runtime.controlled',

  'memory.written',
  'memory.recalled',
  'memory.rejected',

  'identity.allowed',
  'identity.denied',

  'gateway.routed',
  'gateway.denied',

  'armor.allowed',
  'armor.blocked',
  'armor.sanitized',
  'armor.flagged',

  'model.requested',
  'model.responded',
  'model.failed',

  'agent.spawned',
  'agent.started',
  'agent.completed',
  'agent.failed',

  'tool.requested',
  'tool.succeeded',
  'tool.failed',

  'usage.recorded',

  'incident.opened',
  'incident.updated',
  'incident.resolved',

  'policy.evaluated',

  'intervention.proposed',
  'intervention.authorized',
  'intervention.rejected',
  'intervention.requested',
  'intervention.acknowledged',
  'intervention.succeeded',
  'intervention.failed',
  'intervention.timed_out',

  'human_escalation.opened',
  'human_escalation.resolved',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Which platform capability, if any, is authoritative for an event family. */
export const EVENT_FAMILY_OWNER: Readonly<Record<string, string>> = {
  registry: 'Agent Registry',
  runtime: 'Agent Runtime',
  memory: 'Memory Bank',
  identity: 'Agent Identity',
  gateway: 'Agent Gateway',
  armor: 'Model Armor',
  case: 'FleetScope Case API',
  agent: 'Agent Runtime',
  model: 'Agent Runtime model gateway',
  tool: 'Agent Runtime tool gateway',
  usage: 'Agent Observability',
  incident: 'FleetScope Incident Detector',
  policy: 'FleetScope Policy Engine',
  intervention: 'FleetScope Control Adapter',
  human_escalation: 'FleetScope',
};

export function eventFamily(type: EventType): string {
  const [family] = type.split('.');
  return family ?? type;
}
