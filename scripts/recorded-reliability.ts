/**
 * Ten consecutive complete runs of the Recorded Case.
 *
 * Each run is a FRESH PROCESS. That matters: within one process a "deterministic"
 * pipeline can agree with itself because of cached module state, a warmed map
 * iteration order, or an accumulated singleton. Agreement across ten cold
 * processes is evidence about the pipeline.
 *
 * Every field that must be reproducible is compared against run 1. A single
 * disagreement fails the whole harness — a flaky run is not a passing run with an
 * asterisk, and the demo is not stable until ten consecutive runs agree.
 *
 * Usage: pnpm reliability [runs] [CASE-ID]
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runs = Number(process.argv[2] ?? 10);
const caseId = process.argv[3] ?? 'CASE-1042';
const runner = fileURLToPath(new URL('./recorded-run.ts', import.meta.url));

/** Fields that must be identical across every run. */
const REPRODUCIBLE = [
  'fixtureVersion',
  'streamRevision',
  'projectorVersion',
  'policyVersion',
  'terminalStateHash',
  'eventCount',
  'rendererEntryCount',
  'subagentCount',
  'sceneDigest',
  'incidentCount',
  'interventionResult',
  'recordedInterventionState',
  'replayControlAdapterCalls',
  'wardenControlAdapterCalls',
  'auditExportDigest',
  'invariantViolations',
] as const;

interface RunResult {
  readonly [key: string]: unknown;
  readonly pass: boolean;
  readonly problems: readonly string[];
}

const results: RunResult[] = [];
let failures = 0;

console.log(`FleetScope Recorded Case reliability — ${runs} consecutive cold runs of ${caseId}\n`);

for (let run = 1; run <= runs; run++) {
  const started = Date.now();
  const child = spawnSync('npx', ['tsx', runner, caseId], { encoding: 'utf8' });
  const durationMs = Date.now() - started;

  const line = child.stdout.trim().split('\n').at(-1) ?? '';
  let result: RunResult;
  try {
    result = JSON.parse(line) as RunResult;
  } catch {
    result = {
      pass: false,
      problems: [
        `run produced no parsable result (exit ${child.status}): ${child.stderr.slice(0, 400)}`,
      ],
    };
  }
  results.push(result);

  const drift =
    run === 1
      ? []
      : REPRODUCIBLE.filter((field) => result[field] !== results[0]![field]).map(
          (field) => `${field}: ${String(result[field])} != run 1 ${String(results[0]![field])}`,
        );

  const ok = result.pass && drift.length === 0;
  if (!ok) failures += 1;

  console.log(
    `run ${String(run).padStart(2)} ${ok ? 'PASS' : 'FAIL'}  ` +
      `events=${String(result['eventCount'])} ` +
      `renderer=${String(result['rendererEntryCount'])} ` +
      `incidents=${String(result['incidentCount'])} ` +
      `intervention=${String(result['interventionResult'])} ` +
      `replay-control-calls=${String(result['replayControlAdapterCalls'])} ` +
      `warden-control-calls=${String(result['wardenControlAdapterCalls'])} ` +
      `audit=${result['auditExportVerified'] === true ? 'verified' : 'FAILED'} ` +
      `hash=${String(result['terminalStateHash']).slice(0, 12)} ` +
      `${durationMs}ms`,
  );
  for (const problem of result.problems ?? []) console.log(`        problem: ${problem}`);
  for (const d of drift) console.log(`        drift:   ${d}`);
}

const first = results[0];
console.log('\n─────────────────────────────────────────────────────────────');
if (first !== undefined) {
  console.log(`fixture version        ${String(first['fixtureVersion'])}`);
  console.log(`stream revision        ${String(first['streamRevision'])}`);
  console.log(`projector version      ${String(first['projectorVersion'])}`);
  console.log(`policy version         ${String(first['policyVersion'])}`);
  console.log(`terminal state hash    ${String(first['terminalStateHash'])}`);
  console.log(`canonical events       ${String(first['eventCount'])}`);
  console.log(`renderer entries       ${String(first['rendererEntryCount'])}`);
  console.log(`compiled scene digest  ${String(first['sceneDigest'])}`);
  console.log(`audit export digest    ${String(first['auditExportDigest'])}`);
  console.log(`intervention result    ${String(first['interventionResult'])}`);
  console.log(
    `replay control calls   ${String(first['replayControlAdapterCalls'])} (historical replay MUST be zero)`,
  );
  console.log(
    `warden control calls   ${String(first['wardenControlAdapterCalls'])} (one request + one observe: at-most-once)`,
  );
}
console.log('─────────────────────────────────────────────────────────────');
console.log(`${runs - failures}/${runs} runs passed`);

if (failures > 0) {
  console.error(
    '\nThe Recorded Case is NOT stable. Diagnose, fix, and restart the count from one.',
  );
  process.exit(1);
}
console.log('The Recorded Case is stable across every run.');
