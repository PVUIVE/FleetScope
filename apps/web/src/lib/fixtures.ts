import { parseCanonicalEventsJsonl, type CanonicalEvent } from '@fleetscope/event-schema';
import { project, type ProjectionResult } from '@fleetscope/projector';
import type { EvidenceManifest, FixtureCaseDescriptor } from '@fleetscope/fixtures';

/**
 * Fixture loading for the static build.
 *
 * `import.meta.glob(..., { eager: true })` resolves at BUILD time, so recorded
 * evidence is inlined into the static bundle. That is what makes the public
 * demo work with the network disabled after first load.
 */
const caseFiles = import.meta.glob<{ default: FixtureCaseDescriptor }>(
  '../../../../packages/fixtures/cases/*/case.json',
  { eager: true },
);
const manifestFiles = import.meta.glob<{ default: EvidenceManifest }>(
  '../../../../packages/fixtures/cases/*/evidence-manifest.json',
  { eager: true },
);
const eventFiles = import.meta.glob<string>(
  '../../../../packages/fixtures/cases/*/canonical-events.jsonl',
  { eager: true, query: '?raw', import: 'default' },
);
const agentVersionFiles = import.meta.glob<{ default: unknown[] }>(
  '../../../../packages/fixtures/cases/*/agent-versions.json',
  { eager: true },
);

const byCaseId = <T>(files: Record<string, T>): Map<string, T> => {
  const map = new Map<string, T>();
  for (const [path, value] of Object.entries(files)) {
    const match = /cases\/([^/]+)\//.exec(path);
    if (match?.[1] !== undefined) map.set(match[1], value);
  }
  return map;
};

const cases = byCaseId(caseFiles);
const manifests = byCaseId(manifestFiles);
const events = byCaseId(eventFiles);
const agentVersions = byCaseId(agentVersionFiles);

export const listCaseIds = (): string[] => [...cases.keys()].sort();

export function getCaseDescriptor(caseId: string): FixtureCaseDescriptor | null {
  return cases.get(caseId)?.default ?? null;
}

export function getEvidenceManifest(caseId: string): EvidenceManifest | null {
  return manifests.get(caseId)?.default ?? null;
}

export function getAgentVersions(caseId: string): unknown[] {
  return agentVersions.get(caseId)?.default ?? [];
}

export function getCanonicalEvents(caseId: string): CanonicalEvent[] {
  const raw = events.get(caseId);
  if (raw === undefined) return [];
  const { events: parsed, failures } = parseCanonicalEventsJsonl(raw);
  if (failures.length > 0) {
    throw new Error(`Fixture ${caseId} failed to parse at build time: ${failures[0]?.problem}`);
  }
  return parsed;
}

/** Project a recorded Case. Pure — safe to call during static rendering. */
export function projectCase(caseId: string, throughCaseSequence?: number): ProjectionResult | null {
  const canonical = getCanonicalEvents(caseId);
  if (canonical.length === 0) return null;
  return project(canonical, throughCaseSequence === undefined ? {} : { throughCaseSequence });
}
