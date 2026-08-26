import type { CanonicalEvent } from '@fleetscope/event-schema';
import { canonicalJson, sha256Hex } from '@fleetscope/shared';
import { PROJECTOR_VERSION, project } from './project.js';

/**
 * The Case evidence export.
 *
 * Everything an auditor needs to reconstruct the Case independently: the
 * canonical events, the schema and projector versions they were read with, the
 * decisions each platform capability made, the full Intervention lifecycle, the
 * authoritative Runtime result, and an integrity manifest over the whole thing.
 *
 * # What the integrity manifest is, and what it is not
 *
 * It is an **application-level append-only evidence record with a content
 * digest**. Recomputing the digest detects accidental corruption and any
 * modification by a party who cannot also rewrite the digest.
 *
 * It is NOT cryptographic non-repudiation. There is no signing key, no trusted
 * timestamp authority and no write-once medium, so a party who controls the
 * export controls the digest too. FleetScope says so in the export itself rather
 * than letting a hash imply a guarantee it does not provide — a claim of
 * regulatory immutability that turned out to be a SHA-256 of a JSON file would
 * be worse than no claim at all.
 */

export const AUDIT_EXPORT_VERSION = '1.0.0';

export interface AuditExportOptions {
  /** Export the prefix up to this event. Omit for the whole Case. */
  readonly throughCaseSequence?: number;
  /** Known gaps in the evidence, stated plainly. */
  readonly knownEvidenceGaps?: readonly string[];
  /** How each platform capability's evidence was produced. */
  readonly executionModes?: Readonly<Record<string, string>>;
}

export interface IntegrityManifest {
  readonly note: string;
  readonly guarantee: string;
  readonly notGuaranteed: readonly string[];
  readonly algorithm: 'sha256';
  /** Digest over the canonically serialized Canonical Events. */
  readonly streamRevision: string;
  /** Digest over the canonically serialized Observable Case State. */
  readonly stateHash: string;
  /** Digest over this export, excluding the digest field itself. */
  readonly exportDigest: string;
  readonly eventCount: number;
}

export interface AuditExport {
  readonly exportVersion: string;
  readonly caseId: string;
  readonly generatedFrom: {
    readonly projectorVersion: string;
    readonly schemaVersions: readonly string[];
    readonly eventCursor: number;
    readonly atEdge: boolean;
  };
  readonly caseRecord: unknown;
  readonly agentVersionRef: string | null;
  readonly runtimeSessions: unknown;
  readonly memoryProvenance: unknown;
  readonly platformDecisions: {
    readonly identity: readonly unknown[];
    readonly gateway: readonly unknown[];
    readonly armor: readonly unknown[];
    readonly registry: readonly unknown[];
    readonly memory: readonly unknown[];
  };
  readonly agentActivity: unknown;
  readonly incidents: unknown;
  readonly policyDecisions: unknown;
  readonly approvals: unknown;
  readonly interventions: unknown;
  readonly runtimeResult: {
    readonly caseState: string;
    readonly terminal: boolean;
    readonly lastAcceptedAt: string | null;
  };
  readonly usage: unknown;
  readonly executionModes: Readonly<Record<string, string>>;
  readonly knownEvidenceGaps: readonly string[];
  readonly invariantViolations: readonly string[];
  readonly canonicalEvents: readonly CanonicalEvent[];
  readonly integrity: IntegrityManifest;
}

/**
 * The honest description of what the integrity manifest covers. Product copy
 * lives beside the mechanism so the two cannot drift.
 */
const GUARANTEE =
  'Application-level append-only evidence with a content digest. Recomputing the digest over the exported events detects accidental corruption and any modification by a party who cannot also rewrite this manifest.';

const NOT_GUARANTEED = [
  'Cryptographic non-repudiation — the export is not signed and there is no key.',
  'Regulatory immutability — there is no write-once medium and no trusted timestamp.',
  'Reconstruction of hidden model reasoning, which FleetScope neither records nor claims to reconstruct.',
  'Reconstruction of unrecorded external reality or of a tool side effect that happened outside FleetScope.',
];

export function buildAuditExport(
  caseId: string,
  events: readonly CanonicalEvent[],
  options: AuditExportOptions = {},
): AuditExport {
  const projection = project(
    events,
    options.throughCaseSequence === undefined
      ? {}
      : { throughCaseSequence: options.throughCaseSequence },
  );
  const state = projection.state;
  const prefix =
    options.throughCaseSequence === undefined
      ? [...events].sort((a, b) => a.caseSequence - b.caseSequence)
      : [...events]
          .sort((a, b) => a.caseSequence - b.caseSequence)
          .filter((event) => event.caseSequence <= options.throughCaseSequence!);

  const badgesOf = (service: string): unknown[] =>
    state.platformBadges.filter((badge) => badge.service === service);

  const body = {
    exportVersion: AUDIT_EXPORT_VERSION,
    caseId,
    generatedFrom: {
      projectorVersion: PROJECTOR_VERSION,
      schemaVersions: [...new Set(prefix.map((event) => event.schemaVersion))].sort(),
      eventCursor: state.cursor.caseSequence,
      atEdge: state.cursor.atEdge,
    },
    caseRecord: state.caseRecord,
    // The version the Case is BOUND to, which is not necessarily the newest one
    // the Registry has published since.
    agentVersionRef: state.caseRecord?.agentVersionRef ?? null,
    runtimeSessions: state.sessions,
    memoryProvenance: state.memoryRecords,
    platformDecisions: {
      identity: badgesOf('identity'),
      gateway: badgesOf('gateway'),
      armor: badgesOf('armor'),
      registry: badgesOf('registry'),
      memory: badgesOf('memory'),
    },
    agentActivity: state.agents,
    incidents: state.incidents,
    policyDecisions: state.policyDecisions,
    approvals: state.approvals,
    interventions: state.interventions,
    runtimeResult: {
      caseState: state.caseState,
      terminal: ['completed', 'failed', 'cancelled'].includes(state.caseState),
      lastAcceptedAt: state.lastAcceptedAt,
    },
    usage: state.usage,
    executionModes: options.executionModes ?? {},
    knownEvidenceGaps: options.knownEvidenceGaps ?? [],
    invariantViolations: state.invariantViolations,
    canonicalEvents: prefix,
  };

  const streamRevision = `sha256:${sha256Hex(canonicalJson(prefix))}`;

  return {
    ...body,
    integrity: {
      note: 'Recompute exportDigest over this document with `integrity.exportDigest` removed to verify it.',
      guarantee: GUARANTEE,
      notGuaranteed: NOT_GUARANTEED,
      algorithm: 'sha256',
      streamRevision,
      stateHash: projection.stateHash,
      exportDigest: `sha256:${sha256Hex(canonicalJson(body))}`,
      eventCount: prefix.length,
    },
  };
}

/**
 * Verify an export against its own integrity manifest.
 *
 * Returns the problems found; an empty array means the document is internally
 * consistent — which is exactly as strong a statement as `GUARANTEE` says.
 */
export function verifyAuditExport(exported: AuditExport): string[] {
  const problems: string[] = [];
  const { integrity, ...body } = exported;

  const recomputedExport = `sha256:${sha256Hex(canonicalJson(body))}`;
  if (recomputedExport !== integrity.exportDigest) {
    problems.push('exportDigest does not match the exported document');
  }

  const recomputedStream = `sha256:${sha256Hex(canonicalJson(exported.canonicalEvents))}`;
  if (recomputedStream !== integrity.streamRevision) {
    problems.push('streamRevision does not match the exported Canonical Events');
  }

  if (exported.canonicalEvents.length !== integrity.eventCount) {
    problems.push('eventCount does not match the exported Canonical Events');
  }

  // The strongest check available: re-project the exported events and confirm
  // the state hash. This is the replay claim, verified from the export alone.
  const reprojected = project(exported.canonicalEvents);
  if (reprojected.stateHash !== integrity.stateHash) {
    problems.push('re-projecting the exported events does not reproduce stateHash');
  }

  return problems;
}
