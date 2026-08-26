import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCanonicalEventsJsonl, type CanonicalEvent } from '@fleetscope/event-schema';
import type { EvidenceManifest, ExpectedState, FixtureCaseDescriptor } from './types.js';

/** Node-only fixture loading. Never import this from browser code. */
const casesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'cases');

export const fixtureCaseDir = (caseId: string): string => join(casesDir, caseId);

const readJson = <T>(caseId: string, file: string): T =>
  JSON.parse(readFileSync(join(fixtureCaseDir(caseId), file), 'utf8')) as T;

export function loadCaseDescriptor(caseId: string): FixtureCaseDescriptor {
  return readJson<FixtureCaseDescriptor>(caseId, 'case.json');
}

export function loadEvidenceManifest(caseId: string): EvidenceManifest {
  return readJson<EvidenceManifest>(caseId, 'evidence-manifest.json');
}

export function loadExpectedState(caseId: string): ExpectedState {
  return readJson<ExpectedState>(caseId, 'expected-state.json');
}

/** Throws on any malformed line — a fixture that does not parse is a build break. */
export function loadCanonicalEvents(caseId: string): CanonicalEvent[] {
  const text = readFileSync(join(fixtureCaseDir(caseId), 'canonical-events.jsonl'), 'utf8');
  const { events, failures } = parseCanonicalEventsJsonl(text);
  if (failures.length > 0) {
    throw new Error(
      `Fixture ${caseId} has ${failures.length} invalid event line(s):\n` +
        failures.map((f) => `  line ${f.line}: ${f.problem}`).join('\n'),
    );
  }
  return events;
}
