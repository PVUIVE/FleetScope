import { describe, expect, it } from 'vitest';
import {
  GOLDEN_SESSION,
  loadRecordedSessionEvents,
  loadRecordedSessionMeta,
} from '@fleetscope/fixtures/node';
import { compileZoetropeScene, validateRenderManifest } from '@fleetscope/scenario-compiler';
import { buildAgentTree, projectViewerEvents, summarizeSession } from '@fleetscope/viewer';
import { sceneDelta } from '../src/features/viewer/scene-delta';
import { formatDuration, formatOffset, UNKNOWN } from '../src/lib/format';
import { sessionIdFromLocation } from '../src/lib/local-api';

/**
 * The Agent Viewer's presentation layer, proved against the REAL recorded run.
 *
 * These are the claims the landing page and the viewer both make. Proving them
 * against a genuine Google ADK capture rather than a hand-written fixture is
 * what stops the UI drifting away from what the product actually records.
 */
const meta = loadRecordedSessionMeta(GOLDEN_SESSION);
const events = loadRecordedSessionEvents(GOLDEN_SESSION);
const rows = projectViewerEvents(events);

describe('the recorded golden session', () => {
  it('is a real two-agent run with a delegation and a failure', () => {
    const session = summarizeSession(meta.sessionId, meta.name, meta.framework, events, rows);
    expect(meta.framework).toBe('google-adk');
    expect(session.status).toBe('completed');
    expect(session.handoffCount).toBe(1);
    expect(session.errorCount).toBe(1);
    expect(session.models).toEqual([meta.model]);
    expect(buildAgentTree(events, rows).map((agent) => agent.depth)).toEqual([0, 1]);
  });

  it('carries no prompt, no completion and no reasoning', () => {
    // The plugin never reads them, and the redaction policy would drop them.
    // This asserts the recorded bytes, which is the only claim that matters.
    const text = JSON.stringify(events).toLowerCase();
    for (const field of [
      '"prompt"',
      '"thinking"',
      '"reasoning"',
      '"chainofthought"',
      '"content"',
    ]) {
      expect(text).not.toContain(field);
    }
  });

  it('carries no credential-shaped material', () => {
    const text = JSON.stringify(events);
    expect(text).not.toMatch(/AIza[0-9A-Za-z_-]{35}/);
    expect(text).not.toMatch(/\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i);
  });

  it('compiles to a renderer scene whose manifest is internally consistent', () => {
    const scene = compileZoetropeScene(events);
    expect(validateRenderManifest(scene.manifest)).toEqual([]);
    expect(scene.invariantViolations).toEqual([]);
    expect(scene.subagents).toHaveLength(1);
    expect(scene.manifest.rendererEntryCount).toBeGreaterThan(events.length);
  });
});

describe('growing a live scene', () => {
  it('takes the suffix, so the renderer is fed exactly what is new', () => {
    const half = Math.floor(events.length / 2);
    const before = compileZoetropeScene(events.slice(0, half));
    const after = compileZoetropeScene(events);
    const delta = sceneDelta(before, after);

    expect(delta.isEmpty).toBe(false);
    expect(delta.entries).toHaveLength(events.length - half);
    expect(delta.entries[0]?.caseSequence).toBe(events[half]?.caseSequence);
    // The prefix is byte-identical, which is what makes a suffix correct at all.
    expect(after.main.startsWith(before.main)).toBe(true);
  });

  it('sends a subagent meta exactly once', () => {
    const scene = compileZoetropeScene(events);
    const first = sceneDelta(null, scene);
    const again = sceneDelta(scene, scene);
    expect(first.subagents[0]?.meta).not.toBe('');
    expect(again.isEmpty).toBe(true);
  });

  it('reports an unchanged scene as empty rather than re-appending it', () => {
    const scene = compileZoetropeScene(events);
    expect(sceneDelta(scene, scene).mainTail).toBe('');
  });
});

describe('formatting', () => {
  it('renders an unobserved value as Unknown, never as zero', () => {
    expect(formatDuration(null)).toBe(UNKNOWN);
    expect(formatDuration(undefined)).toBe(UNKNOWN);
    expect(formatDuration(Number.NaN)).toBe(UNKNOWN);
    expect(formatDuration(0)).toBe('0 ms');
  });

  it('scales a duration to a unit a developer reads at a glance', () => {
    expect(formatDuration(480)).toBe('480 ms');
    expect(formatDuration(1490)).toBe('1.49 sec');
    expect(formatDuration(42_100)).toBe('42.1 sec');
    expect(formatDuration(125_000)).toBe('2 min 5 sec');
  });

  it('shows timeline offsets from the session start', () => {
    const start = '2026-08-28T10:00:00.000Z';
    expect(formatOffset('2026-08-28T10:00:03.580Z', start)).toBe('00:03.580');
    expect(formatOffset('2026-08-28T10:01:12.004Z', start)).toBe('01:12.004');
  });
});

describe('session routing', () => {
  it('reads the id out of a clean per-session path', () => {
    expect(sessionIdFromLocation('/sessions/ses_abc')).toBe('ses_abc');
    expect(sessionIdFromLocation('/sessions/ses_abc/')).toBe('ses_abc');
  });

  it('does not mistake the shell route for a session id', () => {
    expect(sessionIdFromLocation('/sessions/view')).toBeNull();
    expect(sessionIdFromLocation('/sessions/')).toBeNull();
  });
});
