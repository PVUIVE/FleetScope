/**
 * Regenerates `expected-state.json` for every recorded Case by running the
 * projector over its canonical events.
 *
 * Run this ONLY when a fixture or the projector version changed on purpose.
 * A diff here means replay output moved; review it like a behavior change.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_CASE_IDS } from '@fleetscope/fixtures';
import {
  fixtureCaseDir,
  loadCanonicalEvents,
  loadEvidenceManifest,
} from '@fleetscope/fixtures/node';
import { PROJECTOR_VERSION, project } from '@fleetscope/projector';
import type { ExpectedState } from '@fleetscope/fixtures';

for (const caseId of FIXTURE_CASE_IDS) {
  const events = loadCanonicalEvents(caseId);
  const manifest = loadEvidenceManifest(caseId);

  // Significant prefixes: every milestone and every platform-evidence marker,
  // so a hash regression points at the exact event that changed.
  const significant = [
    ...manifest.milestones.map((m) => m.caseSequence),
    ...manifest.platformEvidence.map((m) => m.caseSequence),
  ];
  const cuts = [...new Set(significant)].sort((a, b) => a - b);

  const expected: ExpectedState = {
    caseId,
    projectorVersion: PROJECTOR_VERSION,
    eventCount: events.length,
    terminalStateHash: project(events).stateHash,
    prefixHashes: cuts.map((caseSequence) => ({
      caseSequence,
      eventId: events.find((e) => e.caseSequence === caseSequence)?.eventId ?? 'unknown',
      stateHash: project(events, { throughCaseSequence: caseSequence }).stateHash,
    })),
  };

  const path = join(fixtureCaseDir(caseId), 'expected-state.json');
  writeFileSync(path, JSON.stringify(expected, null, 2) + '\n', 'utf8');
  console.log(`blessed ${caseId}: ${events.length} events, terminal ${expected.terminalStateHash}`);
}
