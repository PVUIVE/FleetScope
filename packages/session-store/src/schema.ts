/**
 * The local store schema, versioned.
 *
 * Migrations are forward-only and numbered. `SCHEMA_VERSION` is the number the
 * code expects; a database at a lower version is migrated on open, and one at a
 * HIGHER version is refused rather than silently misread — a newer FleetScope
 * may have written columns this build does not understand.
 */
export const SCHEMA_VERSION = 1;

export const MIGRATIONS: readonly (readonly string[])[] = [
  // 0 → 1
  [
    `CREATE TABLE IF NOT EXISTS sessions (
       id                TEXT PRIMARY KEY,
       case_id           TEXT NOT NULL,
       name              TEXT NOT NULL,
       framework         TEXT NOT NULL,
       framework_version TEXT,
       root_agent        TEXT,
       status            TEXT NOT NULL,
       started_at        TEXT,
       ended_at          TEXT,
       event_count       INTEGER NOT NULL DEFAULT 0,
       metadata          TEXT NOT NULL DEFAULT '{}',
       created_at        TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS events (
       session_id      TEXT NOT NULL,
       sequence        INTEGER NOT NULL,
       event_id        TEXT NOT NULL,
       timestamp       TEXT NOT NULL,
       type            TEXT NOT NULL,
       agent_id        TEXT,
       parent_agent_id TEXT,
       payload         TEXT NOT NULL,
       PRIMARY KEY (session_id, sequence)
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS events_event_id ON events (session_id, event_id)`,
    `CREATE INDEX IF NOT EXISTS sessions_created ON sessions (created_at DESC)`,
  ],
];
