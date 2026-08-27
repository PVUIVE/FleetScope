/**
 * ONE complete run of the Recorded Case, from Source Events to audit export.
 *
 * Prints a single JSON line describing everything that must be reproducible.
 * `recorded-reliability.ts` runs this in a FRESH PROCESS ten times and compares:
 * a fresh process means no cached module state, no warmed map iteration order and
 * no accumulated singletons, so agreement across runs is evidence about the
 * pipeline rather than about one process's memory.
 *
 * Usage: pnpm tsx scripts/recorded-run.ts [CASE-ID]
 */
import {
  loadCanonicalEvents,
  loadCaseDescriptor,
  loadExpectedState,
  loadSourceEvents,
} from '@fleetscope/fixtures/node';
import { DEFAULT_FIXTURE_CASE_ID } from '@fleetscope/fixtures';
import { canonicalize, streamRevisionOf } from '@fleetscope/canonicalizer';
import {
  PROJECTOR_VERSION,
  buildAuditExport,
  project,
  verifyAuditExport,
} from '@fleetscope/projector';
import { compileZoetropeScene, validateRenderManifest } from '@fleetscope/scenario-compiler';
import {
  POLICY_VERSION,
  Warden,
  detectIncidents,
  evaluate,
  propose,
  transition,
  type ControlAdapter,
} from '@fleetscope/warden';
import { canonicalJson, sha256Hex } from '@fleetscope/shared';
import type { SourceEvent } from '@fleetscope/event-schema';

const caseId = process.argv[2] ?? DEFAULT_FIXTURE_CASE_ID;
const problems: string[] = [];
const check = (condition: boolean, message: string): void => {
  if (!condition) problems.push(message);
};

// ── 1. Canonicalization, from the recorded adversarial arrival order ────────
const blessed = loadCanonicalEvents(caseId);
const arriving = loadSourceEvents(caseId);
const descriptor = loadCaseDescriptor(caseId);

const canonicalized = canonicalize(arriving, caseId, {
  acceptedTimeFor: (event: SourceEvent) =>
    new Date(Date.parse(event.sourceTime) + 120).toISOString(),
  eventIdFor: (event: SourceEvent) => event.dedupeKey,
});

check(canonicalized.rejected.length === 0, 'canonicalization rejected an event');
check(canonicalized.streamProblems.length === 0, 'the canonical stream is malformed');
check(canonicalized.duplicatesCollapsed.length === 1, 'the recorded redelivery was not collapsed');
check(
  canonicalJson(canonicalized.accepted) === canonicalJson(blessed),
  'canonicalization did not reproduce the blessed canonical stream',
);

const events = canonicalized.accepted;

// ── 2. Projection ───────────────────────────────────────────────────────────
const projection = project(events);
const expected = loadExpectedState(caseId);

check(
  projection.stateHash === expected.terminalStateHash,
  `terminal state hash ${projection.stateHash} != blessed ${expected.terminalStateHash}`,
);
check(
  projection.state.invariantViolations.length === 0,
  'the projection recorded an invariant violation',
);

for (const prefix of expected.prefixHashes) {
  const at = project(events, { throughCaseSequence: prefix.caseSequence });
  check(at.stateHash === prefix.stateHash, `prefix hash at #${prefix.caseSequence} drifted`);
}

// Replay purity: every prefix reconstructs without touching a control adapter.
const controlCalls: string[] = [];
const replayAdapter: ControlAdapter = {
  mode: 'recorded',
  async request(intervention) {
    controlCalls.push(`request:${intervention.interventionId}`);
    return { runtimeOperationId: 'op', acknowledgedAt: '' };
  },
  async observe(runtimeOperationId) {
    controlCalls.push(`observe:${runtimeOperationId}`);
    return { runtimeOperationId, outcome: 'applied' as const, observedAt: '' };
  },
};
for (const event of events) project(events, { throughCaseSequence: event.caseSequence });
// The load-bearing claim: reconstructing every prefix of a Case that CONTAINS an
// Intervention performs zero control-plane execution.
const replayControlCalls = controlCalls.length;
check(replayControlCalls === 0, 'historical replay reached the Control Adapter');

// ── 3. Warden: detect, decide, act — with a recording adapter ───────────────
const incidents = detectIncidents(events);
const failureIncident = incidents.find((i) => i.incidentClass === 'repeated_tool_failure');
check(failureIncident !== undefined, 'the repeated tool failure was not detected');

let interventionResult = 'not_run';
if (failureIncident !== undefined) {
  const decision = evaluate(
    {
      incident: failureIncident,
      authorization: { attemptsUsed: 0, attemptBudget: 1 },
    },
    failureIncident.openedAt,
  );
  check(decision.disposition === 'auto_act', `policy returned ${decision.disposition}`);
  check(decision.policyVersion === POLICY_VERSION, 'policy version drifted');

  const proposal = propose({
    caseId,
    evaluation: decision,
    target: 'agent-logistics-1',
    attempt: 1,
    proposedAt: failureIncident.openedAt,
  });
  check(proposal.ok, 'the Warden refused to propose an authorized action');

  if (proposal.ok) {
    const authorized = transition(proposal.intervention, 'authorized');
    check(authorized.ok, 'the Intervention could not be authorized');
    if (authorized.ok) {
      const warden = new Warden(replayAdapter);
      const first = await warden.execute(authorized.intervention);
      // Redelivery must not reach the adapter a second time.
      const again = await warden.execute(authorized.intervention);
      check(
        controlCalls.filter((c) => c.startsWith('request:')).length === 1,
        'the Intervention reached the Control Adapter more than once',
      );
      check(again.ok && again.outcome.deduplicated, 'redelivery was not deduplicated');
      interventionResult = first.ok ? first.outcome.intervention.state : 'failed_to_execute';
      check(interventionResult === 'succeeded', `intervention ended ${interventionResult}`);
    }
  }
}

// The RECORDED intervention, as replayed from evidence.
const recordedIntervention = projection.state.interventions[0];
check(recordedIntervention?.state === 'succeeded', 'the recorded Intervention is not succeeded');

// ── 4. Renderer compilation ─────────────────────────────────────────────────
const scene = compileZoetropeScene(events);
check(validateRenderManifest(scene.manifest).length === 0, 'the render manifest is inconsistent');
check(
  scene.invariantViolations.length === 0,
  'the compiler recorded a security-ordering violation',
);

// Cursor mapping must be invertible in both directions, every time.
for (const entry of scene.manifest.entries.filter((e) => e.rendererEntryCount > 0)) {
  const back = scene.manifest.entries
    .filter((e) => e.rendererEntryCount > 0)
    .filter((e) => e.rendererEntryStart <= entry.rendererEntryStart)
    .at(-1);
  check(back?.eventId === entry.eventId, `cursor round-trip failed at #${entry.caseSequence}`);
}

// ── 5. Audit export ─────────────────────────────────────────────────────────
const exported = buildAuditExport(caseId, events);
const exportProblems = verifyAuditExport(exported);
check(
  exportProblems.length === 0,
  `audit export failed verification: ${exportProblems.join('; ')}`,
);

// ── The line ────────────────────────────────────────────────────────────────
console.log(
  JSON.stringify({
    caseId,
    fixtureVersion: descriptor.fixtureVersion ?? 'unversioned',
    streamRevision: streamRevisionOf(events),
    projectorVersion: PROJECTOR_VERSION,
    policyVersion: POLICY_VERSION,
    terminalStateHash: projection.stateHash,
    eventCount: events.length,
    rendererEntryCount: scene.manifest.rendererEntryCount,
    subagentCount: scene.subagents.length,
    sceneDigest: `sha256:${sha256Hex(canonicalJson({ main: scene.main, subagents: scene.subagents, manifest: scene.manifest }))}`,
    incidentCount: incidents.length,
    interventionResult,
    recordedInterventionState: recordedIntervention?.state ?? 'none',
    // Two different facts, kept apart so neither can be misread as the other.
    replayControlAdapterCalls: replayControlCalls,
    wardenControlAdapterCalls: controlCalls.length,
    auditExportDigest: exported.integrity.exportDigest,
    auditExportVerified: exportProblems.length === 0,
    invariantViolations: projection.state.invariantViolations.length,
    pass: problems.length === 0,
    problems,
  }),
);

process.exit(problems.length === 0 ? 0 : 1);
