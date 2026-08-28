import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseCanonicalEvent, type CanonicalEvent } from '@fleetscope/event-schema';
import type { ViewerStatus } from '@fleetscope/viewer';
import { MIGRATIONS, SCHEMA_VERSION } from './schema.js';

/**
 * The local session store.
 *
 * SQLite through `node:sqlite`, so the MVP adds no dependency, no daemon and no
 * service to run. One developer, one machine, one file. Postgres, Redis and a
 * message bus are all the wrong shape for that and are deliberately absent.
 *
 * The store holds CANONICAL events — already validated, already redacted. It is
 * a persistence layer, not a second place where meaning is assigned.
 */

export interface SessionRow {
  readonly id: string;
  readonly caseId: string;
  readonly name: string;
  readonly framework: string;
  readonly frameworkVersion: string | null;
  readonly rootAgent: string | null;
  readonly status: ViewerStatus;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly eventCount: number;
  readonly createdAt: string;
}

interface RawSession {
  id: string;
  case_id: string;
  name: string;
  framework: string;
  framework_version: string | null;
  root_agent: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  event_count: number;
  created_at: string;
}

const toSession = (raw: RawSession): SessionRow => ({
  id: raw.id,
  caseId: raw.case_id,
  name: raw.name,
  framework: raw.framework,
  frameworkVersion: raw.framework_version,
  rootAgent: raw.root_agent,
  status: (raw.status === 'completed' || raw.status === 'failed'
    ? raw.status
    : 'running') as ViewerStatus,
  startedAt: raw.started_at,
  endedAt: raw.ended_at,
  eventCount: raw.event_count,
  createdAt: raw.created_at,
});

export interface UpsertSessionInput {
  readonly id: string;
  readonly caseId: string;
  readonly name: string;
  readonly framework: string;
  readonly frameworkVersion?: string | null;
  readonly rootAgent?: string | null;
  readonly status: ViewerStatus;
  readonly startedAt?: string | null;
  readonly endedAt?: string | null;
  readonly eventCount: number;
  readonly createdAt: string;
}

export class SessionStore {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * Open (and migrate) the store.
   *
   * `:memory:` is supported and is what the tests use, so persistence is proved
   * by the same code path the product runs.
   */
  static open(path: string): SessionStore {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL)');

    const row = db.prepare('SELECT version FROM schema_meta LIMIT 1').get() as
      { version: number } | undefined;
    const current = row?.version ?? 0;

    if (current > SCHEMA_VERSION) {
      db.close();
      throw new Error(
        `store at ${path} is schema version ${current}; this build understands ${SCHEMA_VERSION}. ` +
          'Upgrade FleetScope or point --storage at a different file.',
      );
    }

    for (let version = current; version < SCHEMA_VERSION; version += 1) {
      for (const statement of MIGRATIONS[version] ?? []) db.exec(statement);
    }
    if (current === 0)
      db.prepare('INSERT INTO schema_meta (version) VALUES (?)').run(SCHEMA_VERSION);
    else if (current < SCHEMA_VERSION)
      db.prepare('UPDATE schema_meta SET version = ?').run(SCHEMA_VERSION);

    return new SessionStore(db);
  }

  close(): void {
    this.db.close();
  }

  upsertSession(input: UpsertSessionInput): void {
    this.db
      .prepare(
        `INSERT INTO sessions
           (id, case_id, name, framework, framework_version, root_agent, status,
            started_at, ended_at, event_count, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           framework_version = COALESCE(excluded.framework_version, sessions.framework_version),
           root_agent = COALESCE(excluded.root_agent, sessions.root_agent),
           status = excluded.status,
           started_at = COALESCE(sessions.started_at, excluded.started_at),
           ended_at = excluded.ended_at,
           event_count = excluded.event_count`,
      )
      .run(
        input.id,
        input.caseId,
        input.name,
        input.framework,
        input.frameworkVersion ?? null,
        input.rootAgent ?? null,
        input.status,
        input.startedAt ?? null,
        input.endedAt ?? null,
        input.eventCount,
        input.createdAt,
      );
  }

  /**
   * Append canonical events.
   *
   * Idempotent by `(session_id, event_id)`: a redelivered event is ignored
   * rather than duplicated, which is what makes an ingest retry safe.
   * Returns how many rows were genuinely new.
   */
  appendEvents(sessionId: string, events: readonly CanonicalEvent[]): number {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO events
         (session_id, sequence, event_id, timestamp, type, agent_id, parent_agent_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let added = 0;
    this.db.exec('BEGIN');
    try {
      for (const event of events) {
        const result = insert.run(
          sessionId,
          event.caseSequence,
          event.eventId,
          event.sourceTime,
          event.type,
          event.correlations['agentInstanceId'] ?? null,
          event.correlations['parentAgentInstanceId'] ?? null,
          JSON.stringify(event),
        );
        added += Number(result.changes);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return added;
  }

  listSessions(): SessionRow[] {
    return (
      this.db
        .prepare('SELECT * FROM sessions ORDER BY created_at DESC, id DESC')
        .all() as unknown as RawSession[]
    ).map(toSession);
  }

  getSession(id: string): SessionRow | null {
    const raw = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      RawSession | undefined;
    return raw === undefined ? null : toSession(raw);
  }

  /**
   * Canonical events for a session, in sequence order.
   *
   * `afterSequence` is EXCLUSIVE, which is what an SSE reconnect needs: the
   * client sends the last sequence it holds and gets exactly what it missed.
   * A row whose stored JSON no longer parses is skipped rather than crashing
   * the read — the rest of the session is still inspectable.
   */
  getEvents(sessionId: string, afterSequence = -1): CanonicalEvent[] {
    const rows = this.db
      .prepare(
        'SELECT payload FROM events WHERE session_id = ? AND sequence > ? ORDER BY sequence ASC',
      )
      .all(sessionId, afterSequence) as unknown as { payload: string }[];

    const events: CanonicalEvent[] = [];
    for (const row of rows) {
      try {
        const parsed = parseCanonicalEvent(JSON.parse(row.payload));
        if (parsed.success) events.push(parsed.data);
      } catch {
        continue;
      }
    }
    return events;
  }

  /** Agent instances already spawned in this session. Keeps re-spawns out. */
  knownAgents(sessionId: string): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT agent_id FROM events
          WHERE session_id = ? AND type = 'agent.spawned' AND agent_id IS NOT NULL`,
      )
      .all(sessionId) as unknown as { agent_id: string }[];
    return new Set(rows.map((row) => row.agent_id));
  }

  deleteSession(id: string): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM events WHERE session_id = ?').run(id);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
