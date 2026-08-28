import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@fleetscope/event-schema';
import { SCHEMA_VERSION, SessionStore } from '../src/index.js';

/**
 * The store is where a session survives the process that captured it. What is
 * tested is exactly what a developer relies on: what went in comes back, in
 * order, after a restart, and a retried ingest does not duplicate it.
 */
const dirs: string[] = [];
const tempDb = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'fleetscope-store-'));
  dirs.push(dir);
  return join(dir, 'nested', 'fleetscope.db');
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const event = (
  caseSequence: number,
  type: CanonicalEvent['type'] = 'tool.requested',
): CanonicalEvent => ({
  eventId: `evt-${caseSequence}`,
  caseId: 'ses_1',
  caseSequence,
  sessionId: 'ses_1',
  sessionSequence: caseSequence,
  schemaVersion: '1.0.0',
  type,
  sourceTime: `2026-08-28T10:00:${String(caseSequence).padStart(2, '0')}.000Z`,
  acceptedTime: '2026-08-28T10:00:00.000Z',
  actor: { kind: 'agent', id: 'root' },
  correlations: { agentInstanceId: 'root' },
  payloadRedacted: { tool: 'x' },
});

const session = (eventCount: number) => ({
  id: 'ses_1',
  caseId: 'ses_1',
  name: 'Demo',
  framework: 'google-adk',
  status: 'running' as const,
  startedAt: '2026-08-28T10:00:00.000Z',
  eventCount,
  createdAt: '2026-08-28T10:00:00.000Z',
});

describe('session store', () => {
  it('creates its directory and migrates to the current schema', () => {
    const path = tempDb();
    const store = SessionStore.open(path);
    store.close();
    // Reopening must be a no-op, not a second migration.
    const again = SessionStore.open(path);
    expect(again.listSessions()).toEqual([]);
    again.close();
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
  });

  it('returns events in sequence order regardless of insert order', () => {
    const store = SessionStore.open(':memory:');
    store.upsertSession(session(3));
    store.appendEvents('ses_1', [event(2), event(0), event(1)]);
    expect(store.getEvents('ses_1').map((e) => e.caseSequence)).toEqual([0, 1, 2]);
    store.close();
  });

  it('ignores a redelivered event instead of duplicating it', () => {
    const store = SessionStore.open(':memory:');
    store.upsertSession(session(2));
    expect(store.appendEvents('ses_1', [event(0), event(1)])).toBe(2);
    expect(store.appendEvents('ses_1', [event(0), event(1)])).toBe(0);
    expect(store.getEvents('ses_1')).toHaveLength(2);
    store.close();
  });

  it('serves the tail a reconnecting subscriber asks for', () => {
    const store = SessionStore.open(':memory:');
    store.upsertSession(session(4));
    store.appendEvents('ses_1', [event(0), event(1), event(2), event(3)]);
    expect(store.getEvents('ses_1', 1).map((e) => e.caseSequence)).toEqual([2, 3]);
    expect(store.getEvents('ses_1', 3)).toEqual([]);
    store.close();
  });

  it('survives a restart with the events byte-identical', () => {
    const path = tempDb();
    const store = SessionStore.open(path);
    store.upsertSession(session(2));
    store.appendEvents('ses_1', [event(0), event(1)]);
    const before = store.getEvents('ses_1');
    store.close();

    const reopened = SessionStore.open(path);
    expect(reopened.getEvents('ses_1')).toEqual(before);
    expect(reopened.getSession('ses_1')?.name).toBe('Demo');
    reopened.close();
  });

  it('keeps the original start time when a session is updated', () => {
    const store = SessionStore.open(':memory:');
    store.upsertSession(session(1));
    store.upsertSession({
      ...session(9),
      status: 'completed',
      startedAt: '2026-08-28T23:00:00.000Z',
      endedAt: '2026-08-28T10:00:09.000Z',
    });
    const row = store.getSession('ses_1');
    // A later batch must not rewrite when the run began.
    expect(row?.startedAt).toBe('2026-08-28T10:00:00.000Z');
    expect(row?.status).toBe('completed');
    expect(row?.eventCount).toBe(9);
    store.close();
  });

  it('reports the agents already spawned so they are not spawned twice', () => {
    const store = SessionStore.open(':memory:');
    store.upsertSession(session(2));
    store.appendEvents('ses_1', [event(0, 'agent.spawned'), event(1)]);
    expect([...store.knownAgents('ses_1')]).toEqual(['root']);
    store.close();
  });

  it('refuses a store written by a newer build rather than misreading it', async () => {
    const path = tempDb();
    const store = SessionStore.open(path);
    store.close();
    const { DatabaseSync } = await import('node:sqlite');
    const raw = new DatabaseSync(path);
    raw.prepare('UPDATE schema_meta SET version = ?').run(SCHEMA_VERSION + 1);
    raw.close();
    expect(() => SessionStore.open(path)).toThrow(/schema version/);
  });

  it('lists nothing for an unknown session rather than throwing', () => {
    const store = SessionStore.open(':memory:');
    expect(store.getSession('nope')).toBeNull();
    expect(store.getEvents('nope')).toEqual([]);
    store.close();
  });
});
