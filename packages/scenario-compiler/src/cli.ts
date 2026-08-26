/**
 * `pnpm scenario:compile <CASE-ID> [--out <dir>]`
 *
 * Compiles recorded canonical evidence into a Cockpit-loadable transcript plus
 * a copy of the evidence manifest, so the Cockpit and the DOM evidence rail read
 * the same marker positions.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isFixtureCaseId, FIXTURE_CASE_IDS } from '@fleetscope/fixtures';
import { loadCanonicalEvents, loadEvidenceManifest } from '@fleetscope/fixtures/node';
import { compileScenario } from './compile.js';
import { interimJsonlAdapter } from './renderer-adapter.js';

const args = process.argv.slice(2);
const caseId = args[0];
const outFlag = args.indexOf('--out');
const outDir = outFlag >= 0 ? args[outFlag + 1] : undefined;

if (caseId === undefined) {
  console.error(`usage: pnpm scenario:compile <CASE-ID> [--out <dir>]`);
  console.error(`known cases: ${FIXTURE_CASE_IDS.join(', ')}`);
  process.exit(2);
}

if (!isFixtureCaseId(caseId)) {
  console.error(`Unknown Case "${caseId}". Known: ${FIXTURE_CASE_IDS.join(', ')}`);
  process.exit(2);
}

const target = outDir ?? join('apps', 'web', 'public', 'transcripts', caseId);
mkdirSync(target, { recursive: true });

const events = loadCanonicalEvents(caseId);
const transcript = compileScenario(events);

const transcriptPath = join(target, `transcript.${interimJsonlAdapter.extension}`);
writeFileSync(transcriptPath, interimJsonlAdapter.render(transcript), 'utf8');

const manifestPath = join(target, 'evidence-manifest.json');
writeFileSync(manifestPath, JSON.stringify(loadEvidenceManifest(caseId), null, 2) + '\n', 'utf8');

console.log(`adapter:    ${interimJsonlAdapter.id}`);
console.log(`events:     ${events.length}`);
console.log(`agents:     ${transcript.agents.length}`);
console.log(`entries:    ${transcript.entries.length}`);
console.log(`transcript: ${transcriptPath}`);
console.log(`manifest:   ${manifestPath}`);
