import { describe, expect, it } from 'vitest';
import { loadCanonicalEvents } from '@fleetscope/fixtures/node';
import { DEFAULT_FIXTURE_CASE_ID } from '@fleetscope/fixtures';
import { PROJECTOR_VERSION, hashState, project } from '@fleetscope/projector';

const events = loadCanonicalEvents(DEFAULT_FIXTURE_CASE_ID);

describe('project — determinism (Invariant 7)', () => {
  it('produces an identical state hash across repeated runs', () => {
    const runs = Array.from({ length: 5 }, () => project(events).stateHash);
    expect(new Set(runs).size).toBe(1);
  });

  it('is insensitive to input array order, because caseSequence is authoritative', () => {
    const shuffled = [...events].reverse();
    expect(project(shuffled).stateHash).toBe(project(events).stateHash);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(events);
    project(events);
    expect(JSON.stringify(events)).toBe(before);
  });

  it('hashes the returned state consistently with the reported hash', () => {
    const result = project(events);
    expect(hashState(result.state)).toBe(result.stateHash);
  });

  it('reports the projector version it used', () => {
    expect(project(events).state.projectorVersion).toBe(PROJECTOR_VERSION);
  });

  it('gives every distinct prefix a distinct hash', () => {
    const hashes = events.map(
      (e) => project(events, { throughCaseSequence: e.caseSequence }).stateHash,
    );
    expect(new Set(hashes).size).toBe(events.length);
  });

  it('reprojecting a prefix reproduces that prefix hash exactly', () => {
    for (const cut of [0, 7, 13, 30, 44, events.length - 1]) {
      const a = project(events, { throughCaseSequence: cut }).stateHash;
      const b = project(
        [...events].sort(() => 0),
        { throughCaseSequence: cut },
      ).stateHash;
      expect(b).toBe(a);
    }
  });
});

describe('project — purity (Invariant 8)', () => {
  it('the projector source contains no network, clock, or filesystem access', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(
      fileURLToPath(new URL('../src/project.ts', import.meta.url)),
      'utf8',
    );
    // Deliberately textual: it fails loudly the moment someone reaches for a
    // side effect, long before it can silently corrupt replay.
    for (const forbidden of [
      'fetch(',
      'XMLHttpRequest',
      'node:fs',
      'node:http',
      'Date.now(',
      'new Date(',
      'Math.random(',
      'process.env',
      'localStorage',
    ]) {
      expect(source, `projector must not use ${forbidden}`).not.toContain(forbidden);
    }
  });
});
