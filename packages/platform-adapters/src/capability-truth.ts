import type { AdapterMode } from './mode.js';
import type { PlatformService } from '@fleetscope/domain';

/**
 * The platform capability truth table.
 *
 * One place, read by the Audit view and by the final report, stating for each of
 * the seven capabilities: what mode its evidence was produced in, what actually
 * exists behind the boundary, and what a viewer may therefore conclude.
 *
 * # The rule this table encodes
 *
 * An interface is not an integration. A configured service produces no badge.
 * Only RECORDED EVIDENCE does. Every row says which of those it is, in the
 * product's own words, so a demo viewer can never mistake a synthetic decision
 * for a vendor response.
 */
export interface CapabilityTruth {
  readonly service: PlatformService;
  readonly label: string;
  readonly mode: AdapterMode;
  /** What actually exists behind the boundary today. */
  readonly reality: string;
  /** What a viewer is entitled to conclude from evidence in this mode. */
  readonly claim: string;
}

export const CAPABILITY_TRUTH: Readonly<Record<PlatformService, CapabilityTruth>> = {
  registry: {
    service: 'registry',
    label: 'Agent Registry',
    mode: 'recorded',
    reality:
      'Agent Version metadata, approval state and digest are replayed from bundled canonical evidence.',
    claim:
      'The Case is bound to the exact Agent Version recorded at launch. FleetScope did not resolve it against a live Registry.',
  },
  runtime: {
    service: 'runtime',
    label: 'Agent Runtime',
    mode: 'recorded',
    reality:
      'Session start, wait, resume, control and terminal result are replayed from bundled canonical evidence.',
    claim:
      'The Runtime results shown are the ones recorded. FleetScope observed no live wait or resume, and controlled no live session.',
  },
  memory: {
    service: 'memory',
    label: 'Memory Bank',
    mode: 'recorded',
    reality:
      'Memory writes, recalls and rejections are replayed with their recorded provenance and scope.',
    claim:
      'Each Memory Record names the Canonical Event it came from. Provenance is recorded, not reconstructed.',
  },
  identity: {
    service: 'identity',
    label: 'Agent Identity',
    mode: 'synthetic',
    reality:
      'Authorization decisions are enforced by FleetScope-local policy against a synthetic ERP. No external identity provider was contacted.',
    claim:
      'The allow/deny ORDERING is real and enforced — a denied request produces no downstream ERP action. The identity provider is not.',
  },
  gateway: {
    service: 'gateway',
    label: 'Agent Gateway',
    mode: 'synthetic',
    reality:
      'Route decisions are enforced by FleetScope-local route policy. No external gateway was contacted.',
    claim:
      'The delegation ORDERING is real and enforced — a denied route produces no child agent. The gateway service is not.',
  },
  armor: {
    service: 'armor',
    label: 'Model Armor',
    mode: 'synthetic',
    reality:
      'Screening decisions are enforced by FleetScope-local policy. No external screening service was contacted.',
    claim:
      'The screening ORDERING is real and enforced — blocked content reaches no context, memory or tool. The screening engine is not.',
  },
  observability: {
    service: 'observability',
    label: 'Agent Observability',
    mode: 'recorded',
    reality: 'Usage and cost totals are sums of recorded usage events.',
    claim:
      'Totals cover recorded usage only. Where no usage event exists the value is unknown, and is shown as unknown rather than as zero.',
  },
};

/** Rows in a stable display order. */
export const CAPABILITY_TRUTH_ROWS: readonly CapabilityTruth[] = [
  CAPABILITY_TRUTH.registry,
  CAPABILITY_TRUTH.runtime,
  CAPABILITY_TRUTH.memory,
  CAPABILITY_TRUTH.identity,
  CAPABILITY_TRUTH.gateway,
  CAPABILITY_TRUTH.armor,
  CAPABILITY_TRUTH.observability,
];
