# FleetScope → Local Agent Viewer: Implementation Report

**Date:** 2026-08-29
**Baseline:** `c6ce98a` — 294 tests, 15 files, all green
**Result:** 368 TypeScript tests + 53 Rust tests + 30 browser E2E checks + 15 accessibility checks, all green
**Change:** 140 files, +9,581 / −4,205 (68 added, 10 deleted, 43 modified, 19 moved)

Companion: [refactor audit](fleetscope-local-agent-viewer-refactor-audit.md).

---

## A. Before

FleetScope was an **enterprise agent-fleet control plane**. A pnpm monorepo with
a Rust/WASM renderer, nine TypeScript packages, an Astro app of five operator
routes, and a Hono service with one bounded Gemini "live proof" endpoint.

Its data spine was genuinely good: Source Events → Canonicalizer (redact, dedupe,
order) → Canonical Events → Projector / Scenario Compiler → a vendored Zoetrope
renderer, bridged by a Render Manifest that made cursor translation invertible in
both TypeScript and Rust.

Its product was hypothetical. Everything on screen came from one recorded
fixture, `CASE-1042`. There was no CLI, no persistence, no streaming, and no
integration with any agent framework. The first user needed a fleet, a governance
team and a policy owner before any of it was useful.

## B. Product reset

FleetScope is now:

> **A local Agent Viewer for Gemini and Google ADK that turns agent sessions into
> a live execution graph and inspectable timeline.**

First user: one developer running Gemini / Google ADK agents on their own machine.

The refactor principle was *simplify the product layer, do not destroy the
technical foundation*. The canonical spine, the redaction boundary, the Render
Manifest, the Event Cursor and the renderer are all kept and are all load-bearing
in the new product. What changed is what the browser is asked to understand: a
developer sees eleven `ViewerEvent` types, not 45 canonical ones.

## C. Final architecture

```
Google ADK agent (Python) · Gemini · tools · sub-agents
        │  official BasePlugin callbacks, in-process, non-blocking
        ▼
fleetscope_adk.FleetScopePlugin           examples/fleetscope_adk
        │  HTTP POST, batched, fail-open
        ▼
POST /api/ingest                          apps/api
        ▼
@fleetscope/adk-adapter        ADK wire → Source Events (no fabrication)
        ▼
@fleetscope/canonicalizer      validate → REDACT → dedupe → order → sequence
        │                                  ← the security boundary
   ┌────┴─────┐
   ▼          ▼
session-store  EventHub (SSE)
(node:sqlite)      │
   │               │
   └────┬──────────┘
        ▼
GET /api/sessions · /api/sessions/:id · /events · /events/stream
        ▼
Browser (Astro, static)
   @fleetscope/viewer            Canonical → ViewerEvent / ViewerSession
   @fleetscope/scenario-compiler Canonical → Zoetrope scene + Render Manifest
   crates/fleet-cockpit-web      WebGL execution graph
        ▼
Agent Viewer: agent tree · graph · timeline · details · live/historical
```

The browser holds the canonical stream. Every projection is a pure function of a
**prefix** of it, which is what makes historical inspection re-derivation rather
than a request.

## D. Code refactor

### Added

| Path | Lines | What |
|---|---|---|
| `packages/viewer` | 754 | ViewerEvent / ViewerSession / agent tree projection |
| `packages/adk-adapter` | 528 | ADK wire schema + Source Event mapping |
| `packages/session-store` | 446 | `node:sqlite` store, versioned schema |
| `apps/cli` | 874 | `fleetscope init \| watch \| open \| run` |
| `examples/` | 594 | The ADK plugin and the golden demo agent |
| `apps/api/src/collector/` | — | Collector + SSE hub |
| `apps/api/src/routes/viewer.ts` | — | The seven local endpoints |
| `apps/api/src/middleware/static-viewer.ts` | — | Serves the viewer, rewrites `/sessions/:id` |
| `apps/web/src/features/viewer/` | — | Agent Viewer controller, details, scene delta, glue |
| `apps/web/src/pages/sessions/`, `docs/` | — | The three new routes |
| `packages/fixtures/sessions/vendor-onboarding/` | — | A real recorded ADK run |
| `scripts/viewer-e2e.ts`, `scripts/a11y-qa.ts` | — | Browser proof |

### Changed

- `packages/event-schema` — added `model.requested` / `model.responded` /
  `model.failed`. 45 types across 15 families.
- `packages/scenario-compiler` — the `model` render domain and its compiler
  cases; a local agent is now labelled by role rather than "unknown version".
  **No Rust change was needed**: `RenderManifestEntry::domain` is a `String`.
- `crates/fleet-cockpit-web` — boots with an **empty** scene instead of
  `include_str!`-ing CASE-1042. Every scene arrives through `fleetscope_load`.
- `packages/shared/src/env.ts` — `storagePath`, `viewerRoot`.
- `apps/web` — new landing (six sections), new nav, `BaseLayout` labels the
  deferred surfaces *Enterprise preview*.
- `apps/web/src/styles/global.css` — **a real bug fix**: `[hidden]` at
  specificity (0,1,0) was being outranked by `.fs-button { display: inline-flex }`,
  so `element.hidden = true` left controls on screen. This affected the existing
  enterprise Cockpit's "Return to live" button too.

### Deleted

- Eight enterprise landing sections + `ControlGate.astro` + `lib/landing-data.ts`
  (620 lines) — the story they told is not this product's. Their guarantee
  ("no figure typed by hand") is preserved by `lib/landing-session.ts` and
  `apps/web/tests/landing.test.ts`.
- The CASE-1042 boot scene in the wasm shell.

Nothing else was deleted. `packages/warden` (53 tests), `packages/platform-adapters`,
`packages/projector`, `packages/fixtures/cases/CASE-1042` (29 tests), the five
enterprise routes and `POST /live/decision` (40 tests) all still compile, still
pass, and are off the golden path.

## E. ADK integration

`examples/fleetscope_adk/plugin.py` — a `google.adk.plugins.base_plugin.BasePlugin`
registered once on the `Runner`.

Callbacks used: `before_run`/`after_run`, `before_agent`/`after_agent`,
`before_model`/`after_model`/`on_model_error`,
`before_tool`/`after_tool`/`on_tool_error`.

Why this and not the alternatives:

- **Not terminal scraping.** ADK's log lines are a human format with no
  compatibility promise, carry no invocation or call ids, and cannot distinguish
  a tool failure from a tool result that mentions an error.
- **Not per-agent callbacks.** Those attach to each agent individually, so a
  sub-agent added later is silently unobserved. A plugin sees the whole invocation.
- **Not a Runner subclass.** Private surface that would break.

Captured: session start/end, agent start/end (with `agent.parent_agent` for
parentage), model start/end/error (with `usage_metadata` when present), tool
start/end/error, and tool results whose `status` is `error` — which have FAILED
even though nothing raised.

Behaviour: fail-open (three consecutive transport failures and it goes quiet, one
line printed, agent unaffected); off the critical path (`asyncio.to_thread`);
streaming-aware (a partial `LlmResponse` is skipped, so one model call is reported
as one); arguments and results truncated at 400 chars and reduced to JSON-safe
values.

Never sent: prompts, completions, model reasoning. The plugin does not read them.

## F. Event model

**Canonical (internal):** 45 types, 15 families. Immutable, schema-versioned,
redacted, sequenced. The only input to any projection.

**Viewer (developer-facing):** eleven types —
`session.started/completed`, `agent.started/completed/handoff`,
`model.started/completed`, `tool.started/completed/failed`, `error`.

`agent.handoff` has no canonical type of its own: it IS an `agent.spawned` that
names a parent. Inventing a separate event would create two sources of truth for
the agent tree.

Durations are derived by pairing a start with its own end via
`toolCallId` / `modelCallId` / `agentInstanceId`. A pairing that never opened
yields `null`, which renders as "Unknown".

## G. CLI

```bash
fleetscope init                       # config + environment report; installs nothing
fleetscope watch [--port N] [--open]  # collector + viewer, one port, one process
fleetscope open  [--port N]           # open a viewer that is already running
fleetscope run <command>...           # watch, then run an agent against it
```

Quality: `--help` for every command; exit codes `0` success / `1` operational
failure / `2` usage error; the Gemini credential reported as present/absent only
and never read; port conflicts diagnosed into three distinct outcomes (free /
already-FleetScope / occupied) and **never** worked around by incrementing;
graceful `SIGINT`/`SIGTERM` that closes the listener, checkpoints the SQLite WAL
and kills any child it started; binds `127.0.0.1` only. 11 unit tests.

Live output:

```
FleetScope

Watching local Gemini / ADK sessions...

● Collector ready
● Viewer ready

Viewer:
  http://127.0.0.1:4399

Waiting for agent activity...

Session detected

  Vendor Onboarding Agent
  session: ses_46ce1d89e76a

  Open:
  http://127.0.0.1:4399/sessions/ses_46ce1d89e76a
```

## H. Local API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/ingest` | `201` new · `200` continuation · `400` with problems named |
| `GET` | `/api/health` | `{ status, framework, sessions }` |
| `GET` | `/api/sessions` | newest first |
| `GET` | `/api/sessions/stream` | SSE, list changes |
| `GET` | `/api/sessions/:id` | summary + agent tree + canonical events |
| `GET` | `/api/sessions/:id/events?after=N` | canonical tail |
| `GET` | `/api/sessions/:id/events/stream` | SSE, history then live tail |

Same-origin — the viewer is served by the collector, so no CORS grant exists on
the local path. `404` for an unknown session; never an empty one invented.

## I. Persistence

`node:sqlite`, at `.fleetscope/fleetscope.db`. No daemon, no service, no new
dependency.

```sql
sessions(id, case_id, name, framework, framework_version, root_agent,
         status, started_at, ended_at, event_count, metadata, created_at)
events(session_id, sequence, event_id, timestamp, type,
       agent_id, parent_agent_id, payload)   PRIMARY KEY (session_id, sequence)
UNIQUE INDEX events_event_id (session_id, event_id)
```

`payload` is the whole redacted Canonical Event. Migrations forward-only and
numbered; a database written by a newer build is refused rather than misread.
`INSERT OR IGNORE` on `(session_id, event_id)` is what makes an ingest retry safe.
9 tests, including a real restart against a temp file.

## J. Streaming

Server-Sent Events. The only direction carrying data is server → browser, and SSE
gives that with automatic reconnection and no framing protocol.

The join between history and the live tail is exact, keyed on canonical sequence:
the client sends the highest sequence it holds (`?after=` or `Last-Event-ID`), the
server writes everything after it from the store and remembers where it got to,
then forwards hub publications, dropping anything at or below that cursor. No gap,
nothing twice. Every frame carries an `id:`. A `ping` every 15 s beats idle proxies.

The hub never buffers history — the store is authoritative — and a subscriber
whose socket has gone is dropped rather than allowed to fail an ingest (tested).

## K. Agent Viewer

`/sessions/:id`, served from one static shell that the collector rewrites onto.

- **Agent tree** — parentage, per-agent status (glyph + word), last action,
  failure count. Selecting an agent focuses its branch and moves the cursor to
  its last recorded action.
- **Execution graph** — the WASM renderer, loaded lazily and only on this route.
- **Timeline** — every ViewerEvent with offset, category, label, agent, duration.
  Focusing an agent DIMS the rest rather than hiding it, so the surrounding
  context stays readable.
- **Details** — kind, agent, status, started, duration, model, tokens (only when
  reported), input, result, error, and the canonical event id it came from. Built
  as DOM with `textContent`, so a tool argument containing markup is shown, never
  parsed.
- **Error UX** — failures are counted in the header, tinted in the timeline, and
  reachable with one **Jump to failure** click.
- **Live / historical** — `LIVE`, `HISTORICAL` with `+N new events`, and
  **Return to live**. Keyboard: `↑`/`↓`/`j`/`k` to step, `End` for the live edge.

## L. Zoetrope integration

Preserved: the graph, the timeline, the camera, historical seek, the WebGL
renderer, the Render Manifest bridge, and the historical-honesty tick suppression
(the renderer freezes its marching-ants and camera glide while parked in the past).

The audit found the Scenario Compiler was **already generic** — three lookup
tables keyed on event type, no CASE-1042 literal, no vendor name, no hard-coded
count. So the refactor was additive: a `model` render domain and three compiler
cases. The one genuine coupling removed was the boot scene.

A live scene grows by recompiling the whole canonical stream and taking the
**suffix** (`scene-delta.ts`). That is sound because the compiler is deterministic
and append-only in emission, and it avoids a second implementation of the emission
rules that could drift from the tested one.

Vendor attribution and the patch record are unchanged in `THIRD-PARTY-NOTICES.md`
and `vendor/VENDOR-PATCHES.md` (one additive `render-provenance` feature, which
FleetScope switches off so no prompt or reasoning can reach the panel).

## M. Historical inspection

Seeking backwards re-projects a prefix already on the client: no model call, no
tool call, no network request. The E2E asserts that no request is issued during a
seek.

The Event Cursor keeps its existing rule: while parked in the past, new events
move the high-water mark and the unread count and **never** the cursor.

One real bug was found and fixed here. The renderer settles asynchronously — a
seek animates and a live append shifts its timeline — so its reported index moved
for reasons that were not the developer scrubbing, and the follow loop adopted
those, dragging the selection off the event they had opened. Fixed with a settling
window: renderer-driven cursor changes are ignored for 700 ms after FleetScope
itself moved it, and a held position is re-asserted after an append. Canvas
scrubbing outside that window still works.

## N. Landing page

Six sections, replacing eleven:

```
01 Hero                  See what your agents are doing.
02 From logs to graph    Your agent is more than a log stream.
03 Execution events      Every model call. Every tool. Every handoff.
04 Catch failures fast   See exactly where the run broke.
05 Historical inspection Replay the run without rerunning it.
06 Final CTA             Debug your next agent visually.
```

The DESIGN.md motif evolved from the **Case Spine** (a governed Case resolving
from seven enterprise systems) to the **Execution Spine** (one run as one vertical
line: session → agent → model → tool → handoff → tool → error → result). The
blueprint visual language — white ground, 1px rules, electric blue, large
grotesque type, sharp geometry — is unchanged.

Every figure is read at BUILD time from
`packages/fixtures/sessions/vendor-onboarding`, a real ADK run.
`apps/web/tests/landing.test.ts` (8 tests) fails the build if the page ever names
an agent, an error class or an event type the recording does not contain.

The page closes with a provenance line stating exactly what was real.

## O. Golden demo agent

`examples/vendor_agent.py` — two real `LlmAgent`s on `gemini-3.5-flash`:

```
vendor_onboarding
  ├─ Gemini
  ├─ vendor_lookup                succeeds
  └─ transfer_to_agent ──────────► logistics
                                     ├─ Gemini
                                     └─ inventory_lookup   fails: timeout
```

Real: ADK 1.20.0, Gemini, and the model's own decisions about which tool to call
and when to delegate. Stubbed: the two business tools —`vendor_lookup` answers
from an in-file table, `inventory_lookup` fails deterministically for `ACME-DEMO`.

Determinism: `temperature=0` on both agents. The model still decides; only
sampling noise is removed. This was added after an E2E run in which the root agent
answered from the vendor record without delegating — real behaviour, but a demo
that works four times in five is not a demo.

## P. Tests

| Suite | Count | Command |
|---|---|---|
| TypeScript unit + replay | **368** in 22 files | `pnpm test` |
| Rust (fleet-cockpit) | **53** in 4 binaries | `cargo test --manifest-path crates/fleet-cockpit/Cargo.toml` |
| Browser E2E | **30 checks** | `pnpm e2e` |
| Accessibility | **15 checks** | `pnpm qa:a11y` |

New TypeScript tests, by layer:

| Package | Tests |
|---|---|
| `packages/viewer` | 15 — projection, durations, purity over every prefix, order-independence, session summary, agent tree |
| `packages/adk-adapter` | 10 — wire validation, the whole lifecycle, spawn-once, deterministic sub-ordering, idempotency, redaction |
| `packages/session-store` | 9 — migrate, order, idempotency, tail, restart, schema refusal |
| `apps/api` | 13 — ingest, redaction-before-persistence, idempotency, reads, hub, batched arrival |
| `apps/cli` | 11 — argv, `run` passthrough, help, config, port probe |
| `apps/web` | 20 — golden recording, scene delta, formatting, routing, landing claims |
| `packages/scenario-compiler` | +4 — model chips, model failure, absent tokens, local agent labels |

Baseline 294 → 368 (+74). Every pre-existing test still passes; one assertion was
updated (`EVENT_TYPES` families) because a family was genuinely added.

```
Test Files  22 passed (22)
     Tests  368 passed (368)
```

`pnpm check` (format + lint + typecheck + test + build) exits **0**.

## Q. Real Gemini / ADK validation

Executed against the live Gemini API through Google ADK 1.20.0.

| | |
|---|---|
| Framework | google-adk 1.20.0, Python 3.13.5 |
| Model | `gemini-3.5-flash` |
| Runs | 6 successful golden-path captures + 3 that did not delegate or hit the daily quota |
| Events per run | 22 canonical |
| Agents | 2 (`vendor_onboarding` → `logistics`) |
| Model calls | 4 |
| Tool calls | 3 (`vendor_lookup`, `transfer_to_agent`, `inventory_lookup`) |
| Handoffs | 1 |
| Failures | 1 (`inventory_lookup`, `timeout`) |
| Duration | 8.3 – 9.5 s |
| Token usage | 2,693 in / 98 out (recorded run) |
| Renderer entries | 24, manifest consistent, zero invariant violations |

**E2E: 3 consecutive runs on `gemini-3.5-flash`.** Runs 2 and 3 were 30/30. Run 1
failed on "the sub-agent appears after the handoff" — the model answered without
delegating. That is the agent's decision, not a FleetScope fault: the viewer
showed a run that did not delegate, correctly. `temperature=0` was added
afterwards and the confirming run was 30/30.

**Final verification of the committed tree: 30/30**, on `gemini-3.1-flash-lite`
via `FLEETSCOPE_DEMO_MODEL`, because the free tier's 20-requests-per-day limit
for `gemini-3.5-flash` was exhausted by the earlier runs. Nothing in FleetScope
differs between the two models; the switch is a quota fact, recorded here rather
than hidden.

Three honest failure captures along the way, all of which the product reported
correctly rather than papering over:

- A `429 RESOURCE_EXHAUSTED` from the Gemini free tier mid-run was captured as a
  `model.failed` event and surfaced in the viewer as a failure — the error path
  proved by an error nobody planned.
- The non-delegating run rendered as a shorter, single-agent session with no
  handoff row. Exactly right.
- A quota-exhausted run stopped after its first model call, and the viewer showed
  a session that stopped after its first model call.

No API key appears in any report, log, artifact or stored event.

## R. Browser QA

`pnpm e2e` — 30 checks, Chromium, against a real ADK run. Best result: **30/30**.

Covered: empty state → live session appears with no reload → LIVE → agent tree →
model events → tool events → sub-agent after handoff → handoff row → failure
surfaced → correct failure details (tool, error class, agent) → agent focus dims
the rest → seek backwards enters HISTORICAL → the banner says nothing is executing
→ **no request issued during historical inspection** → Return to live → agent
exits 0 → session reports Completed → still in the list → reopened with its whole
timeline → the WebGL canvas mounted → no horizontal overflow at 1440×900,
1280×720, 1180×800 → **no console errors**.

`pnpm qa:a11y` — 15/15: headline visible under reduced motion, one `h1`, six
labelled sections, transport as `role="status" aria-live="polite"`, details pane
`aria-live`, graph `aria-label`, labelled timeline and tree, every timeline row a
real `<button>`, `aria-current` selection, `aria-pressed` agent focus, focusable
rows, Enter to open details, arrows to step into history, `End` to return live,
and status carried as a word as well as a colour.

## S. Security

- **Redaction before persistence.** Field-name rules (`api_key`, `authorization`,
  `password`, `token`, `prompt`, `thinking`, `reasoning`, PII, filesystem paths)
  and value-shape rules (Google API keys, bearer tokens, PEM blocks,
  `sk-`/`ghp_`/`xoxb-`, home directory paths). Proved end to end: a Google API key
  planted in a tool argument was stored as `«redacted»`, and an API test asserts
  the bearer token appears nowhere in the stored bytes.
- **No chain-of-thought.** The plugin never reads prompts, completions or
  reasoning. `apps/web/tests/agent-viewer.test.ts` asserts the recorded fixture
  contains no `prompt`, `thinking`, `reasoning`, `chainofthought` or `content`
  field. The vendored renderer's provenance feature is off, so its panel cannot
  draw one either.
- **No credential in the browser.** A scan of the built site and the fixtures
  found **0 findings across 33 files**; `AIza…` and `GEMINI_API_KEY` appear
  nowhere in the bundle. FleetScope holds no model credential at all — the
  developer's agent process calls Gemini.
- **Local only.** The collector binds `127.0.0.1`. The viewer is same-origin, so
  no CORS grant exists on this path and no remote page can read a session.
- **Path traversal.** The static handler resolves and then verifies containment;
  `/../../../../etc/passwd` returns 404.
- **`init` reports the credential as present/absent only** and never writes it.

## T. Performance

Measured in Chromium at 1440×900 against the local collector.

| Route | FCP | Transferred | WASM |
|---|---|---|---|
| `/` landing | 104 ms | 173 KB | not loaded |
| `/sessions` | 32 ms | 42 KB | not loaded |
| `/sessions/:id` | 32 ms | 1,970 KB | 1,823 KB, 5 ms |

The 1.8 MB renderer is loaded **only** on the viewer route — the landing page and
the session list never pay for it. JS heap 10 MB on every route. A 22-event
session renders 21 timeline rows and 24 renderer entries.

Idle work: the renderer freezes its animation ticks in historical mode, and the
viewer's follow loop yields immediately when `document.hidden`, so a backgrounded
tab does no wasm snapshot reads or JSON parsing.

## U. Archived / deferred enterprise functionality

All of it still compiles and still passes its tests. None of it is on the golden
path or in the primary navigation.

| Subsystem | Disposition |
|---|---|
| Canonicalizer, redaction, event schema | **KEEP ACTIVE** — the local spine |
| Render Manifest, Event Cursor, renderer | **KEEP ACTIVE** |
| `packages/projector` | **KEEP INTERNAL** — proves determinism, no UI depends on it |
| `packages/warden` (53 tests) | **DEFER** |
| `packages/platform-adapters` | **DEFER** |
| CASE-1042 fixture + 29 tests | **DEFER** — regression and renderer fixture |
| `/cases`, `/audit`, `/cockpit`, `/approvals`, `/catalog` | **DEFER** — reachable, labelled *Enterprise preview*, out of the nav |
| `POST /live/decision`, `GET /capability` (40 tests) | **DEFER** — superseded by real ADK capture |

Docs describing that direction moved to `docs/archive/` behind a README that says
plainly it does not describe the current product, and lists what survives and
where. Extension points are documented there too.

## V. Remaining limitations

1. **Google ADK only.** A second framework needs a second adapter. The boundary
   is clean (`packages/adk-adapter` is the only module that knows ADK exists), but
   it has not been exercised by a second implementation.
2. **One machine, one developer.** No auth, no multi-user, no remote sessions.
   The collector binds loopback deliberately.
3. **The renderer needs a Rust toolchain to build.** `pnpm build:wasm` requires
   `cargo` and `trunk`. Without it the viewer degrades honestly — it says the
   graph could not be rendered and the timeline is unaffected — but the graph is
   the product's best moment. The wasm artifact is gitignored.
4. **Agent parentage comes from `agent.parent_agent`.** An ADK topology where a
   sub-agent is reachable from two parents would render one edge, the one ADK
   reports.
5. **`fleetscope run` does not restart the agent.** It runs it once.
6. **Very large sessions are untested.** The timeline renders every row without
   virtualization; the recorded runs are 22 events. A 10,000-event session would
   need windowing, and the full-stream recompile in `growScene` is O(n²) over a
   session's lifetime.
7. **Mobile is inspection-only.** Below 1180px the agent tree collapses to a
   strip and the details pane becomes a drawer. The full desktop console is not
   reproduced on a phone, by design.
8. **Demo reliability depends on the model.** `temperature=0` makes the golden
   path repeatable but cannot make it certain; a run that does not delegate is
   rendered faithfully as a run that did not delegate.
9. **The Gemini free tier is 20 requests/day per model**, and one demo run costs
   four. A demo day needs a paid key or `FLEETSCOPE_DEMO_MODEL` pointed at a
   model with quota left. This was hit twice during validation.
10. **The deferred enterprise routes still render CASE-1042.** They are correct
    and labelled, but they are a second story in the same repository.

## W. Demo instructions

```bash
pnpm install
pnpm build:wasm            # once; needs Rust + `cargo install --locked trunk`
pnpm build
export GOOGLE_API_KEY=…    # your key; FleetScope never reads it
```

Terminal 1:

```bash
node apps/cli/bin/fleetscope.js watch
```

Terminal 2:

```bash
python3 examples/vendor_agent.py
```

Browser: <http://127.0.0.1:4317>

Then: **Sessions → the live session → the failure → Jump to failure → select
logistics → seek backwards (HISTORICAL) → Return to live → back to Sessions.**

The full script, with timings and the fallback table, is in
[`docs/demo.md`](../demo.md).

Proof commands:

```bash
pnpm test                                                   # 368
cargo test --manifest-path crates/fleet-cockpit/Cargo.toml  # 53
pnpm e2e                                                    # 30 browser checks, real agent
pnpm qa:a11y                                                # 15 accessibility checks
pnpm check                                                  # format + lint + typecheck + test + build
```
