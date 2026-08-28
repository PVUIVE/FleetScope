# The demo

Three minutes, two terminals, one browser. Every command below is exact.

## Before you start

```bash
pnpm install
pnpm build:wasm          # once; needs Rust + `cargo install --locked trunk`
pnpm build
export GOOGLE_API_KEY=…  # your own key. FleetScope never reads it.
```

Check the environment if you want to be sure:

```bash
node apps/cli/bin/fleetscope.js init
```

## The run

**Terminal 1**

```bash
node apps/cli/bin/fleetscope.js watch
```

**Terminal 2**

```bash
python3 examples/vendor_agent.py
```

**Browser** — <http://127.0.0.1:4317>

---

## The script

### 00:00–00:15 · The problem

Show the landing page.

> When Gemini agents call tools and delegate to other agents, terminal logs stop
> being readable at about the third event. This is a real run: two agents, four
> model calls, three tool calls, one failure.

Scroll to **02 From logs to graph**. The left column is what you read without
FleetScope; the right is the same events with structure.

### 00:15–00:30 · Start FleetScope

Terminal 1 already shows:

```
● Collector ready
● Viewer ready

Viewer:
  http://127.0.0.1:4317

Waiting for agent activity...
```

Browser at `/sessions` shows the empty state with the two commands.

### 00:30–00:45 · Run the agent

Terminal 2:

```bash
python3 examples/vendor_agent.py
```

Terminal 1 prints **Session detected** with the URL. The browser row appears with
no reload.

### 00:45–01:20 · Watch it fill

Click the live session. The timeline fills as the run happens:

```
00:00.000   SESSION   Session started
00:00.030   AGENT     vendor_onboarding started
00:00.038   MODEL     gemini-3.5-flash
00:02.100   TOOL      vendor_lookup
00:02.400   HANDOFF   vendor_onboarding → logistics
00:02.410   AGENT     logistics started
00:04.900   TOOL      inventory_lookup
00:05.100   ERROR     inventory_lookup failed · timeout
```

The header reads **LIVE**. The graph draws the same run: the main agent, a Gemini
chip, tool chips, and a child node for `logistics`.

### 01:20–01:45 · The failure

Click **Jump to failure**. The details panel:

```
TOOL CALL
inventory_lookup

Error
timeout
logistics inventory service did not respond within 5000 ms

Agent      logistics
Status     Failed
Started    …
Duration   … ms
Input      { "vendor_code": "ACME-DEMO" }
Result     { "status": "error", "error_class": "timeout", … }
```

The point: agent, tool, duration, input, error, and what came immediately before
— in one click, from a run nobody instrumented by hand.

### 01:45–02:10 · One branch

Click **logistics** in the agent tree. The rest of the timeline dims and the
graph focuses that node. Every row left bright belongs to the delegated agent.

Click it again to unfocus.

### 02:10–02:30 · Historical

Click an earlier row — the first Gemini call.

```
HISTORICAL
Recorded session state. Nothing is executing.
```

The graph rewinds with it. Nothing re-runs: the view is re-derived from events
already on the client. If the session is still going, the banner also shows
`+N new events`, and the cursor stays exactly where you put it.

Click **Return to live**.

### 02:30–02:45 · It persists

Go back to **Sessions**. The finished run is there, with its event count,
duration and status. Reopen it: the whole timeline, the graph and every detail
are still inspectable. Restart `fleetscope watch` and it is still there — the
store is a file.

### 02:45–03:00 · Where it goes

> FleetScope starts with one developer and one local agent session, then scales
> toward fleet-wide observability and governance.

Stop there. The enterprise direction is one sentence, not the demo.

---

## What is real, and what is a stub

| | |
|---|---|
| Google ADK 1.20.0 | real |
| Gemini model calls | real — the model decides which tool to call and when to delegate |
| The plugin capture | real — ADK's own `BasePlugin` callbacks |
| Canonicalization, redaction, storage, streaming | real |
| `vendor_lookup` | a local table |
| `inventory_lookup` | a local stub that fails deterministically for `ACME-DEMO` |

The business tools are stubs so the failure happens every time and the demo does
not depend on an external ERP being reachable. Sampling is switched off
(`temperature=0`) for the same reason: the model still decides, but a run that
took the golden path once takes it again.

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `port 4317 is not available` | something else owns it | `fleetscope watch --port 4318` |
| `FleetScope is already running` | a collector is up | use its URL, or `--port` |
| The graph area says it could not render | no wasm build | `pnpm build:wasm` |
| No session appears | the agent cannot reach the collector | check `FLEETSCOPE_ENDPOINT` |
| `429 RESOURCE_EXHAUSTED` | Gemini free-tier quota | wait, or `FLEETSCOPE_DEMO_MODEL=…` |
| The agent answers without delegating | model non-determinism | rerun; `temperature=0` makes this rare |

The last one is worth knowing: FleetScope shows exactly what happened, so a run
that did not delegate renders as a run that did not delegate. That is the product
working, not failing.

## Proving it yourself

```bash
pnpm e2e                      # one browser run against a real agent
FLEETSCOPE_E2E_RUNS=3 pnpm e2e
```

30 checks, including that seeking backwards issues no request and that there are
no console errors at 1440×900, 1280×720 and 1180×800.
