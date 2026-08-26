/**
 * Regenerates the derived artifacts of every recorded Case:
 *
 *   expected-state.json      the blessed projection + prefix hashes
 *   renderer/main.jsonl      the compiled Zoetrope main transcript
 *   renderer/subagents.json  its subagent sidecars
 *   renderer/render-manifest.json  the canonical <-> renderer mapping
 *
 * Run this ONLY when a fixture, the projector, or the compiler changed on
 * purpose. A diff here means replay or renderer output moved; review it like a
 * behavior change. Both the TypeScript suite and the Rust Cockpit tests read the
 * blessed renderer artifacts, so they can never drift apart silently.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileZoetropeScene, validateRenderManifest } from '@fleetscope/scenario-compiler';
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

  // ── The Source Event stream ────────────────────────────────────────────
  //
  // Recorded evidence is a CANONICAL stream, but a canonical stream is something
  // the Canonicalizer produced — so the fixture also carries the Source Events it
  // was produced from, in a deliberately adversarial arrival order: reversed,
  // with one event delivered twice. Canonicalizing this file must reproduce the
  // blessed canonical stream exactly, which is what makes "duplicates are
  // idempotent" and "arrival order does not matter" claims about the real Case
  // rather than about a synthetic test.
  const sourceEvents = events.map((event) => ({
    dedupeKey: event.eventId,
    caseId: event.caseId,
    sessionId: event.sessionId,
    type: event.type,
    sourceTime: event.sourceTime,
    actor: event.actor,
    correlations: event.correlations,
    payload: event.payloadRedacted,
  }));
  const arrivalOrder = [...sourceEvents].reverse();
  const redelivered = sourceEvents[Math.floor(sourceEvents.length / 2)];
  if (redelivered !== undefined) {
    // A redelivery, dropped in at an arbitrary point in the arrival stream.
    arrivalOrder.splice(3, 0, redelivered);
  }
  writeFileSync(
    join(fixtureCaseDir(caseId), 'source-events.jsonl'),
    arrivalOrder.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8',
  );

  const scene = compileZoetropeScene(events);
  const problems = validateRenderManifest(scene.manifest);
  if (problems.length > 0) {
    throw new Error(`${caseId} render manifest is inconsistent:\n  ${problems.join('\n  ')}`);
  }
  if (scene.invariantViolations.length > 0) {
    console.warn(
      `${caseId}: compiler recorded ${scene.invariantViolations.length} invariant violation(s)`,
    );
  }

  const rendererDir = join(fixtureCaseDir(caseId), 'renderer');
  mkdirSync(rendererDir, { recursive: true });
  writeFileSync(join(rendererDir, 'main.jsonl'), scene.main, 'utf8');
  writeFileSync(
    join(rendererDir, 'subagents.json'),
    JSON.stringify(scene.subagents, null, 2) + '\n',
    'utf8',
  );
  writeFileSync(
    join(rendererDir, 'render-manifest.json'),
    JSON.stringify(scene.manifest, null, 2) + '\n',
    'utf8',
  );

  console.log(
    `blessed ${caseId}: ${events.length} events, terminal ${expected.terminalStateHash}, ` +
      `${scene.manifest.rendererEntryCount} renderer entries, ${scene.subagents.length} subagent(s)`,
  );
}
