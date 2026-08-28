# The local Agent Viewer

The operational reference: the CLI, the API, the store, the streaming transport,
and the configuration. For *why* it is shaped this way, see
[`architecture.md`](architecture.md).

## The CLI

`apps/cli`, exposed as `fleetscope` (`node apps/cli/bin/fleetscope.js` works with
no install step).

### `fleetscope init`

Writes `.fleetscope/config.json` in the current directory and reports the
environment. It **installs nothing**: what is missing is named with the exact
command that fixes it.

```
Environment
● Node  v22.18.0
● Agent Viewer build  /…/apps/web/dist
● Python  Python 3.13.5
● google-adk  v1.20.0
● Gemini credential  present in the environment
```

The credential is reported as present or absent only. The value is never read,
never echoed, and never written to the FleetScope config.

Exit code: `0`. Missing optional tooling is a report, not a failure.

### `fleetscope watch [--port N] [--open]`

Starts the collector **and** the viewer on one port, in one process, and holds the
terminal until interrupted.

```
FleetScope

Watching local Gemini / ADK sessions...

● Collector ready
● Viewer ready

Viewer:
  http://127.0.0.1:4317

Point your agent at:
  FLEETSCOPE_ENDPOINT=http://127.0.0.1:4317

Waiting for agent activity...
```

When a session first appears:

```
Session detected

  Vendor Onboarding Agent
  session: ses_46ce1d89e76a

  Open:
  http://127.0.0.1:4317/sessions/ses_46ce1d89e76a
```

Each session is announced once. A running session publishes on every batch;
re-printing the banner would bury the URL.

**Port conflicts are diagnosed, never worked around.** A busy port is probed:

| State | Behaviour | Exit |
|---|---|---|
| free | starts | (runs) |
| an existing FleetScope | prints its URL and session count, then stops | `0` |
| something else | names the problem and the `--port` remedy | `1` |

It never increments to the next free port: the endpoint a developer put in their
agent, and the URL in their browser, both name the port they configured.

**Shutdown is clean.** `SIGINT`/`SIGTERM` closes the listener, closes the SQLite
handle so the WAL is checkpointed rather than abandoned, and kills any child this
process started.

Binds `127.0.0.1` only.

### `fleetscope open [--port N]`

Opens the browser at a viewer that is **already running**. If nothing is
listening it says so and names `fleetscope watch` instead of opening a dead port.
Exit `1` when there is nothing to open.

### `fleetscope run <command>...`

`watch`, then the command, with `FLEETSCOPE_ENDPOINT` set in its environment.
Everything after `run` — flags included — goes to the child:

```bash
fleetscope run python3 examples/vendor_agent.py --verbose
```

When the agent exits, the viewer stays up so the session can be inspected. The
CLI's exit code is the agent's.

## The API

Seven endpoints. Same-origin: the viewer is served by the collector, so no CORS
grant is involved and no page on another site can read a developer's sessions.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/ingest` | The ADK plugin's only entry point |
| `GET` | `/api/health` | `{ status, framework, sessions }` |
| `GET` | `/api/sessions` | Every stored session, newest first |
| `GET` | `/api/sessions/stream` | SSE: the session list changed |
| `GET` | `/api/sessions/:id` | Summary + agent tree + canonical events |
| `GET` | `/api/sessions/:id/events?after=N` | Canonical events after sequence `N` |
| `GET` | `/api/sessions/:id/events/stream` | SSE: history, then the live tail |

`POST /api/ingest` returns `201` for a new session and `200` for a continuation,
with `{ sessionId, caseId, accepted, rejected, isNewSession }`. A malformed batch
is `400` with each problem named. An unknown session is `404` — never an empty
session invented on the spot.

The ingest is **idempotent**: redelivering a batch accepts `0` events. A client
retry after a timeout cannot double anything.

### The wire format

```jsonc
{
  "framework": "google-adk",
  "frameworkVersion": "1.20.0",
  "sessionId": "ses_46ce1d89e76a",
  "appName": "Vendor Onboarding Agent",
  "events": [
    {
      "kind": "tool.start",          // session.start|end · agent.start|end
                                     // model.start|end|error · tool.start|end|error
      "seq": 15,                     // strictly increasing per session
      "at": "2026-08-28T17:25:32.101Z",
      "agent": "logistics",
      "parentAgent": "vendor_onboarding",
      "invocationId": "e-3d32…",
      "tool": "inventory_lookup",
      "callId": "adk-function-call-id",
      "args": { "vendor_code": "ACME-DEMO" }
      // error, errorClass, model, finishReason, inputTokens, outputTokens, result, summary
    }
  ]
}
```

Every field except `kind`, `seq` and `at` is optional, because ADK does not
report all of them on every callback. An absent field stays absent all the way to
the UI, where it renders as "Unknown".

## Storage

SQLite through `node:sqlite` — no daemon, no service, no extra dependency. The
file is `.fleetscope/fleetscope.db` in the directory `watch` was started from.

```sql
CREATE TABLE schema_meta (version INTEGER NOT NULL);

CREATE TABLE sessions (
  id, case_id, name, framework, framework_version, root_agent,
  status, started_at, ended_at, event_count, metadata, created_at
);

CREATE TABLE events (
  session_id, sequence, event_id, timestamp, type,
  agent_id, parent_agent_id, payload,
  PRIMARY KEY (session_id, sequence)
);
CREATE UNIQUE INDEX events_event_id ON events (session_id, event_id);
```

`payload` is the whole Canonical Event as JSON, already redacted. Migrations are
forward-only and numbered; a database written by a **newer** build is refused
rather than silently misread.

Deleting the file deletes the history. Nothing else on the machine is touched.

## Streaming

Server-Sent Events, not WebSocket: the only direction that carries data is
server → browser. SSE gets that with automatic reconnection, no framing protocol,
and no extra dependency.

`GET /api/sessions/:id/events/stream` sends **history first, then the live tail**,
keyed by canonical sequence, so the join point is exact:

1. the client sends the highest sequence it holds (`?after=`, or the browser's
   own `Last-Event-ID` on a reconnect);
2. the server writes everything after it from the store, and remembers where it
   got to;
3. it then forwards hub publications, dropping anything at or below that cursor.

No gap, and nothing delivered twice. Every frame carries an `id:` so a dropped
connection resumes exactly where it left off. A comment-shaped `ping` every 15 s
keeps an idle proxy from reaping the connection.

The hub never buffers history — the store is authoritative for that — and a
subscriber whose socket has already gone is dropped rather than allowed to fail
an ingest.

## Configuration

`.fleetscope/config.json`:

```json
{
  "port": 4317,
  "storage": ".fleetscope/fleetscope.db",
  "adapter": "google-adk",
  "redactFields": []
}
```

Four knobs and **no credentials**. FleetScope never needs a model key: the
developer's own agent process holds it, calls Gemini itself, and reports what
happened. A malformed config file is reported and then ignored — a developer
mid-demo needs the viewer to start, and the defaults are always usable.

The collector also honours `PORT`, `FLEETSCOPE_STORAGE` and
`FLEETSCOPE_VIEWER_ROOT` when run directly via `pnpm --filter @fleetscope/api start`.
The `.env` at the repository root belongs to the deferred enterprise endpoints
and is not read by the local viewer path.

## The Python plugin

`examples/fleetscope_adk`. Plain Python, no dependency beyond `google-adk`.

It hooks ADK's documented `BasePlugin` callbacks:
`before_run` / `after_run`, `before_agent` / `after_agent`,
`before_model` / `after_model` / `on_model_error`,
`before_tool` / `after_tool` / `on_tool_error`.

Chosen over the alternatives for concrete reasons:

- **not terminal scraping** — ADK's log lines are a human format with no
  compatibility promise, carry no invocation or call ids, and cannot distinguish
  a tool failure from a tool result that mentions an error;
- **not per-agent callbacks** — those must be attached to every agent
  individually, so a sub-agent added later is silently unobserved;
- **not a Runner subclass** — private surface that would break.

Behaviour worth knowing:

- **fail-open.** Three consecutive transport failures and it goes quiet for the
  rest of the process, printing one line. The agent is never affected.
- **off the critical path.** The POST runs in `asyncio.to_thread`, so its latency
  is not added to the agent's.
- **streaming-aware.** A partial `LlmResponse` is skipped; one model call is
  reported as one model call.
- **a tool that returns `{"status": "error"}` has FAILED**, even though it did not
  raise. Reporting that as a success would be the most misleading thing the
  plugin could do.
- **arguments and results are truncated at 400 characters** and reduced to
  JSON-safe values; an object that cannot be rendered becomes a short `repr`
  rather than being dropped silently.

## Deferred endpoints

`apps/api` also still serves `GET /health`, `GET /capability` and
`POST /live/decision` from the earlier enterprise direction. They are covered by
their own tests, no MVP surface calls them, and they are documented in
[`docs/archive/README.md`](archive/README.md).
