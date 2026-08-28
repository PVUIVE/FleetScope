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

// ── Compiled renderer artifacts ─────────────────────────────────────────────
//
// Blessed by `pnpm fixtures:bless`. Both the TypeScript suite and the Rust
// Fleet Cockpit tests read these exact bytes, so a compiler change that breaks
// the renderer cannot pass one suite while failing the other silently.

export interface RendererSubagentFile {
  readonly agentId: string;
  readonly meta: string;
  readonly transcript: string;
}

export const rendererDir = (caseId: string): string => join(fixtureCaseDir(caseId), 'renderer');

export function loadRendererMain(caseId: string): string {
  return readFileSync(join(rendererDir(caseId), 'main.jsonl'), 'utf8');
}

export function loadRendererSubagents(caseId: string): RendererSubagentFile[] {
  return JSON.parse(
    readFileSync(join(rendererDir(caseId), 'subagents.json'), 'utf8'),
  ) as RendererSubagentFile[];
}

export function loadRenderManifest<T>(caseId: string): T {
  return JSON.parse(readFileSync(join(rendererDir(caseId), 'render-manifest.json'), 'utf8')) as T;
}

/**
 * The Source Events a recorded Case was canonicalized from.
 *
 * Stored in a deliberately adversarial ARRIVAL order — reversed, with one event
 * delivered twice — so that canonicalizing it and getting the blessed canonical
 * stream back is a real proof rather than a tautology. Returns raw JSON: these
 * are untrusted inputs and validating them is the Canonicalizer's job.
 */
export function loadSourceEvents(caseId: string): unknown[] {
  const text = readFileSync(join(fixtureCaseDir(caseId), 'source-events.jsonl'), 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as unknown);
}

// ── Recorded local agent sessions ───────────────────────────────────────────
//
// A recorded Gemini / Google ADK run, captured through the real ADK plugin.
// It is a PRODUCT asset, not a test leftover: the landing page derives every
// figure it prints from this file, and the browser E2E replays it, so a claim
// on the marketing page cannot outrun what the product actually captured.

const sessionsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'sessions');

export interface RecordedSessionMeta {
  readonly sessionId: string;
  readonly name: string;
  readonly framework: string;
  readonly frameworkVersion: string;
  readonly model: string | null;
  readonly recordedAt: string;
  /** What was real in this recording and what was a local stub. */
  readonly provenance: string;
}

export const recordedSessionDir = (slug: string): string => join(sessionsDir, slug);

export function loadRecordedSessionMeta(slug: string): RecordedSessionMeta {
  return JSON.parse(
    readFileSync(join(recordedSessionDir(slug), 'session.json'), 'utf8'),
  ) as RecordedSessionMeta;
}

/** Throws on a malformed line: a fixture that does not parse is a build break. */
export function loadRecordedSessionEvents(slug: string): CanonicalEvent[] {
  const text = readFileSync(join(recordedSessionDir(slug), 'canonical-events.jsonl'), 'utf8');
  const { events, failures } = parseCanonicalEventsJsonl(text);
  if (failures.length > 0) {
    throw new Error(
      `Recorded session ${slug} has ${failures.length} invalid event line(s):\n` +
        failures.map((f) => `  line ${f.line}: ${f.problem}`).join('\n'),
    );
  }
  return events;
}

/** The golden demo recording the landing page and the E2E suite both use. */
export const GOLDEN_SESSION = 'vendor-onboarding';
