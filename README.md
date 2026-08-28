# FleetScope

**FleetScope is a local Agent Viewer for Gemini and Google ADK that turns agent
sessions into a live execution graph and inspectable timeline.**

When a Gemini agent calls tools and delegates to other agents, terminal logs stop
being readable at about the third event. FleetScope captures the run through
Google ADK's own plugin callbacks, normalizes it into a stable session model, and
renders it as a graph you can scrub, a timeline you can click, and event details
you can actually read.

Everything runs on your machine. Nothing is sent anywhere.

---

## Quick start

```bash
pnpm install
pnpm build:wasm      # once — the WebGL renderer. Needs Rust and `cargo install --locked trunk`.
pnpm build           # the static Agent Viewer
```

Without `build:wasm` everything still works except the execution graph, and the
viewer says so where the graph would be instead of drawing a fake one.

Terminal 1 — start FleetScope:

```bash
node apps/cli/bin/fleetscope.js watch
```

```
FleetScope

Watching local Gemini / ADK sessions...

● Collector ready
● Viewer ready

Viewer:
  http://127.0.0.1:4317

Waiting for agent activity...
```

Terminal 2 — run an agent:

```bash
export GOOGLE_API_KEY=...            # your key; FleetScope never reads it
python3 examples/vendor_agent.py
```

The session appears in the browser as it runs. Open
<http://127.0.0.1:4317> and click it.

> `pnpm link --global` in `apps/cli` (or adding `apps/cli/bin` to `PATH`) makes
> `fleetscope` available as a bare command. Every example below spells out the
> `node apps/cli/bin/fleetscope.js` form so it works with no setup at all.

## What you get

| Surface      | Route            | What it is                                         |
| ------------ | ---------------- | -------------------------------------------------- |
| Landing      | `/`              | The product story, built from a real recorded run  |
| Sessions     | `/sessions`      | Every run captured on this machine, live           |
| Agent Viewer | `/sessions/<id>` | Agent tree · execution graph · timeline · details  |
| Setup        | `/docs`          | The commands, the plugin snippet, what is recorded |

The Agent Viewer shows, for one run:

- **the agent tree** — who ran, who delegated to whom, who failed;
- **the execution graph** — a WebGL render of the run, scrubbable;
- **the timeline** — every model call, tool call, handoff and error with a
  duration;
- **the details panel** — for the selected event: agent, status, duration, input,
  result, error class;
- **live and historical modes** — seek backwards and the whole view rewinds.
  Nothing re-executes; a banner says so.

## The CLI

```bash
fleetscope init                            # write .fleetscope/config.json, check the environment
fleetscope watch [--port N] [--open]       # start the collector and the viewer
fleetscope open  [--port N]                # open a viewer that is already running
fleetscope run <command>...                # start the viewer, then run an agent against it
```

`fleetscope run python3 examples/vendor_agent.py` does both terminals at once.

## Watching your own agent

Register the plugin once on your `Runner`:

```python
from fleetscope_adk import FleetScopePlugin

runner = Runner(
    app_name="My Agent",
    agent=root_agent,
    session_service=session_service,
    plugins=[FleetScopePlugin()],   # reads FLEETSCOPE_ENDPOINT, defaults to :4317
)
```

`examples/fleetscope_adk` is a plain Python package with no dependencies beyond
`google-adk` itself. It uses ADK's documented `BasePlugin` callbacks, so every
agent in the invocation is observed — including sub-agents created at runtime —
and no terminal output is parsed.

If the collector is not running, the plugin gives up after three failed sends and
the agent continues unaffected. FleetScope is an observer; it never changes a run.

## What is recorded, and what is not

**Recorded:** agent names, parentage, model names, tool names, timings, token
counts the framework reported, tool arguments and tool results, error classes.

**Not recorded:** prompts, completions, model reasoning. The plugin does not read
them.

Every payload crosses a redaction boundary _before_ anything is written to disk:
API keys, bearer tokens, PEM private keys, `sk-`/`ghp_`/`xoxb-` secrets and home
directory paths are replaced with a marker. FleetScope holds no model credential
of its own — your agent process calls Gemini, and FleetScope only hears what
happened.

Sessions live in `.fleetscope/fleetscope.db` (SQLite) in the directory you ran
`fleetscope watch` from. Delete the file to delete the history.

## Repository

```
apps/
  cli/        the `fleetscope` command
  api/        the local collector + viewer host (Hono)
  web/        the Agent Viewer and the landing page (Astro, static)
packages/
  adk-adapter/      Google ADK events → FleetScope Source Events
  event-schema/     Source and Canonical Event schemas (Zod)
  canonicalizer/    validate → REDACT → dedupe → order → sequence
  viewer/           Canonical Events → ViewerEvent / ViewerSession
  session-store/    the local SQLite store
  scenario-compiler/ Canonical Events → renderer scene + Render Manifest
  domain/           the Event Cursor, live vs historical
  projector/        deterministic Observable State (internal)
  fixtures/         a real recorded ADK run, and the legacy CASE-1042
  warden/ platform-adapters/   deferred enterprise capabilities
crates/
  fleet-cockpit/      host-testable renderer core (Rust)
  fleet-cockpit-web/  the wasm32 browser shell
vendor/zoetrope/      the pinned upstream renderer
examples/
  fleetscope_adk/   the ADK plugin
  vendor_agent.py   the golden two-agent demo
```

## Development

```bash
pnpm test          # 368 tests
pnpm typecheck
pnpm lint
pnpm build         # the static viewer
pnpm build:wasm    # the renderer (needs `cargo install --locked trunk`)
pnpm e2e           # browser end-to-end against a REAL ADK run (spends a few Gemini calls)
cargo test --manifest-path crates/fleet-cockpit/Cargo.toml
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — how a run becomes a graph
- [`docs/local-agent-viewer.md`](docs/local-agent-viewer.md) — the CLI, the API, the store, streaming
- [`docs/demo.md`](docs/demo.md) — the exact three-minute demo
- [`DESIGN.md`](DESIGN.md) — the visual system
- [`docs/archive/`](docs/archive/README.md) — the enterprise direction this MVP defers

## Licence

MIT. Third-party attribution — including the vendored Zoetrope renderer — is in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
