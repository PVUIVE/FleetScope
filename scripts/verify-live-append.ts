/**
 * Verify that a live result becomes canonical evidence.
 *
 * Takes a `/live/decision` response and puts its Source Events through the exact
 * pipeline recorded evidence goes through: canonicalize onto the existing
 * stream, project, compile, validate. Nothing about a live result may skip it.
 *
 * Usage: pnpm tsx scripts/verify-live-append.ts <response.json>
 */
import { readFileSync } from 'node:fs';
import { canonicalizeAppend } from '@fleetscope/canonicalizer';
import { loadCanonicalEvents } from '@fleetscope/fixtures/node';
import { project } from '@fleetscope/projector';
import { compileZoetropeScene, validateRenderManifest } from '@fleetscope/scenario-compiler';

const response = JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')) as {
  caseId: string;
  mode: string;
  sourceEvents: unknown[];
};

const existing = loadCanonicalEvents(response.caseId);
const appended = canonicalizeAppend(existing, response.sourceEvents, response.caseId, {
  acceptedTimeFor: (e) => e.ingestionTime ?? e.sourceTime,
});

const before = compileZoetropeScene(existing);
const after = compileZoetropeScene(appended.stream);
const projected = project(appended.stream);

const problems: string[] = [];
const check = (ok: boolean, m: string) => {
  if (!ok) problems.push(m);
};

check(appended.rejected.length === 0, `rejected: ${JSON.stringify(appended.rejected)}`);
check(
  appended.streamProblems.length === 0,
  `stream problems: ${appended.streamProblems.join('; ')}`,
);
// Settled evidence keeps its sequences; only the new events are added.
check(
  JSON.stringify(appended.stream.slice(0, existing.length)) === JSON.stringify(existing),
  'the recorded prefix was modified',
);
check(appended.appended[0]?.caseSequence === existing.length, 'sequences did not continue');
// The redaction boundary applies to a live payload like any other.
const serialized = JSON.stringify(appended.appended);
for (const forbidden of ['AIza', 'Bearer ', '-----BEGIN']) {
  check(!serialized.includes(forbidden), `appended evidence contains ${forbidden}`);
}
check(after.main.startsWith(before.main), 'the recorded prefix recompiled differently');
check(validateRenderManifest(after.manifest).length === 0, 'the extended manifest is inconsistent');
check(after.invariantViolations.length === 0, 'a security-ordering invariant was violated');
check(projected.state.invariantViolations.length === 0, 'the projection recorded a violation');

console.log(
  JSON.stringify(
    {
      mode: response.mode,
      appendedEvents: appended.appended.length,
      appendedTypes: appended.appended.map((e) => e.type),
      caseSequences: appended.appended.map((e) => e.caseSequence),
      streamRevision: appended.streamRevision,
      newStateHash: projected.stateHash,
      rendererEntriesBefore: before.manifest.rendererEntryCount,
      rendererEntriesAfter: after.manifest.rendererEntryCount,
      pass: problems.length === 0,
      problems,
    },
    null,
    1,
  ),
);
process.exit(problems.length === 0 ? 0 : 1);
