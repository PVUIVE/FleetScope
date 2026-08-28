# Zoetrope audit and FleetScope implementation plan

Status: **audit complete and EXECUTED.** The plan below was carried out on
2026-08-26. The implementation report — including where the plan turned out to be
wrong — is `docs/reports/fleetscope-end-to-end-implementation-2026-08-26.md`.
Audit date: 2026-08-26
Author: technical lead

> **Read this first.** Four things in the plan below did not survive contact with
> the code. They are corrected in the report and summarized here so nobody
> implements the superseded version:
>
> | Plan said | What is true |
> |---|---|
> | `crates/fleet-cockpit` must leave the root workspace (§F.3, "the most important structural finding") | **No.** It stays a root member and stays HOST-TESTABLE. Zoetrope's portable core builds on the host; only `ratzilla` is wasm-only. The split is `fleet-cockpit` (host) / `fleet-cockpit-web` (wasm32), which is what lets `cargo test` prove the renderer integration on a laptop. |
> | Bridge `caseSequence` to the renderer via `fold_at_fraction` / the evidence manifest, "no core change needed" (§C.6) | **Insufficient.** 60 Canonical Events compile to 69 renderer entries, so no arithmetic bridge is correct. A **Render Manifest** records the real mapping — see [ADR 0004](../decisions/0004-render-manifest-cursor-mapping.md). |
> | "`unread` on the timeline… ~15 lines in `timeline.rs`" (§C.6) | **Not built, and must not be.** Canonical unread is FleetScope's, derived from accepted Canonical Events. A renderer-side count is a different unit and would make a rendering decision authoritative over the audit spine. |
> | "Redact at compile time" (§A boundary 5) | **Too late.** By then the event is already persisted. The Canonicalizer is the primary boundary; the compiler is defence in depth — see [ADR 0005](../decisions/0005-redaction-boundaries.md). |
>
> Two further items the plan classified as needing core changes were solved at the
> **wrapper** level instead, leaving the vendored source untouched: historical
> animation honesty (skip the presentation-time ticks while the transport is
> historical) and unknown-not-zero (omit `message.usage` at compile time so there
> is no zero to draw). Two patches proved unavoidable and are recorded in
> `vendor/VENDOR-PATCHES.md`: the `render-provenance` feature and product naming.

> **Where this file lives and why.** The task brief suggested
> `docs/fleetscope/zoetrope-audit-and-implementation-plan.md`. This repository
> already has a settled documentation hierarchy (`docs/requirements/`,
> `docs/design/`, `docs/product/`, `docs/plans/`, `docs/decisions/`) described in
> `docs/README.md`. A `docs/fleetscope/` directory would duplicate the repository
> root's own subject. This document is an audit **and** a delivery plan, so it
> sits in `docs/plans/` beside `six-day-delivery.md` and `demo-validation.md`.
> Section F recommends the ADR amendments that must follow it.

---

## A. Executive verdict

**YES, WITH BOUNDARIES.**

FleetScope should adopt Zoetrope as a **pinned, vendored rendering substrate**
underneath the FleetScope domain — not fork it as the repository base, and not
rewrite it.

Three findings drive this, and all three are unusual:

**1. Zoetrope is demonstrably the upstream FleetScope already chose.** The
existing decision record `docs/design/budget-demo.md` (decision D8) commits to
"a pinned, MIT-licensed browser/WASM visualization core" and describes it without
naming it. Every discriminating detail it lists matches the audited commit:

| `budget-demo.md` claim | Measured at `077707d` | Match |
|---|---|---|
| MIT-licensed and current | `LICENSE` MIT, HEAD dated at audit | ✅ |
| 182 upstream library tests pass locally | `cargo test` → **182 passed** | ✅ |
| "about 14K lines" of Rust | `find src -name '*.rs' \| xargs wc -l` → **13,665** | ✅ |
| graph, timeline, time travel, camera, chips, WASM, upload, live append | all present, §C | ✅ |
| "existing load and append exports already form a usable browser boundary" | exactly two exports: `zoetrope_load`, `zoetrope_append` | ✅ |
| hard coupling is "the Claude-specific parser/model" | coupling concentrated in 2 of 20 source files, §D | ✅ |

`vendor/README.md` and `docs/decisions/0002-cockpit-renderer-boundary.md` were
written to receive precisely this dependency. The audit's job was to verify the
fit, not to invent a strategy.

**2. FleetScope is not greenfield.** Contrary to the framing of the audit brief,
commit `b4abce1` already delivers the domain model, the Canonical Event schema,
a pure versioned projector with blessed state hashes, the CASE-1042 fixture (60
events), the Scenario Compiler, the seven platform-adapter interfaces, the
bounded API, and an Astro product shell with **all six required routes**. Its own
baseline is green (`cargo test` 9 passed, `pnpm test` 91 passed). The only
missing piece in the whole product is the renderer behind
`crates/fleet-cockpit/src/abi.rs`. That single gap is what this plan closes.

**3. The two systems meet at a seam that already exists on both sides.**
FleetScope's `CockpitAdapter` (`apps/web/src/features/cockpit/lib/cockpit-adapter.ts`)
calls `fleetscope_seek(fraction)`; Zoetrope's `App::seek_to_fraction(f64)` is
public, event-indexed, and already implements the two semantics FleetScope's
`Cursor` enforces. The integration is a wrapper, not a port.

### The boundaries

1. **Do not fork Zoetrope as the repository base.** FleetScope's repository is
   the product; Zoetrope is a dependency of one surface. Inverting that would
   move ~10,000 lines of working FleetScope TypeScript for no gain.
2. **Do not adopt Zoetrope's Astro site.** It is a Starlight marketing/docs site
   for a CLI tool. FleetScope's `apps/web` is a product shell with the routes the
   requirements demand. Same framework, so this is not "a second frontend".
3. **Do not make the Rust core the FleetScope projector.** Two projectors, by
   design — see §I.
4. **Do not modify Zoetrope's Claude parser.** Bridge to it with the Scenario
   Compiler; the parser is the adapter's problem, not the domain's.
5. **Redact at compile time, not in Rust.** Zoetrope's detail panel renders raw
   prompt text and assistant *reasoning* — see §C.7 and the security finding in
   §R. FleetScope must never emit those into a compiled transcript.

---

## B. Upstream baseline

### Pinned revision

```text
repository   https://github.com/furkankly/zoetrope.git
branch       main
commit SHA   077707da679955c0402c39ca992bf56cdc6b0264
commit       docs: document the homebrew and prebuilt binary installs
status       clean (git status --short → empty)
license      MIT — Copyright (c) 2026 Furkan Kalaycioglu
```

**This SHA is the audited revision. Do not follow upstream past it during the
hackathon** (`budget-demo.md` risk row: "Upstream changes during hackathon — pin
inspected commit; do not chase upstream after Slice 0").

### Toolchain measured on the audit machine

| Tool | Version | Note |
|---|---|---|
| rustc / cargo | 1.90.0 | Zoetrope declares `rust-version = "1.88"`, `edition = "2024"` |
| node | 22.18.0 | FleetScope `engines` requires ≥22 |
| pnpm | 11.24.0 | FleetScope `packageManager` pin |
| wasm32-unknown-unknown | installed | required by both crates |
| trunk | **0.21.14** — installed during the audit (`cargo install --locked trunk`, 6m10s) | the only prerequisite that was missing; now proven |
| Astro (Zoetrope) | ^7.2.2 + Starlight ^0.41.7 | its own `web/pnpm-lock.yaml` |
| Astro (FleetScope) | `apps/web` | separate, product shell |

### Upstream build results — all commands actually executed

| Command | Exit | Result |
|---|---:|---|
| `cargo build` | **0** | clean, 48.99s |
| `cargo test` | **0** | **182 lib + 8 bin passed**, 0 failed, 0 ignored |
| `cargo clippy --all-targets -- -D warnings` | **0** | zero warnings |
| `cargo fmt --all -- --check` | **0** | clean |
| `cargo check --no-default-features` (portable core) | **0** | clean — this is the config FleetScope consumes |
| `cd web/wasm && cargo check --locked --target wasm32-unknown-unknown` | **0** | clean, 2m43s; `zoetrope` + `zoetrope-web` both check |
| `cd web && pnpm install --frozen-lockfile` | **0** | 386 packages |
| `cd web && pnpm run build:site` | **1** | ❌ **FAILED** — diagnosed below (pnpm-11 drift, not a source defect) |
| `cargo install --locked trunk` | **0** | trunk 0.21.14, 6m10s |
| **`bash web/scripts/build-wasm.sh`** | **0** | ✅ **PASS** — `release` in 31.78s, then wasm-bindgen 0.2.127 + wasm-opt v123 → `✅ success` |

Two load-bearing property tests are among the 182 and are named in the output:

- `state::session::tests::final_state_is_arrival_order_invariant`
- `state::timeline::tests::live_delivery_converges_to_bulk_ordering`

These are the machine proofs of the order-independence invariant that FleetScope's
replay determinism will sit on top of.

### The WASM build, proven end to end

`web/scripts/build-wasm.sh` ran unmodified and produced deployable artifacts:

```text
Finished `release` profile [optimized] target(s) in 31.78s
INFO downloading wasm-bindgen version="0.2.127"
INFO downloading wasm-opt version="version_123"
INFO applying new distribution
INFO ✅ success

web/public/wasm/
  web_bg.wasm   2,311,273 B   (release, wasm-opt -Oz)
  web.js           57,708 B   (wasm-bindgen glue)
  env.js              889 B   (libm + critical-section shims)
```

**This is the single most important de-risking result in the audit.** The two
known wasm traps — `critical-section` linking and the libm `env` imports — are
both solved upstream by `env.js` plus the import map in `index.html`, and the
toolchain resolves and runs on a clean machine. Risk #1 drops from
"unvalidated" to "reproduce the same three files under
`crates/fleet-cockpit-web/`".

Bundle size note: 2.3 MB of wasm is acceptable for a static, gzip-served expert
surface, and it is behind the `/cockpit/[caseId]` route only — the Case
Workspace, Catalog, Approvals, and Audit surfaces do not load it.

### The one upstream build failure — diagnosed, not bypassed

```text
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.2
[ERROR] Command failed with exit code 1: pnpm install
```

**Root cause:** pnpm 11 stopped reading the `pnpm.onlyBuiltDependencies` field in
`package.json`. Zoetrope's `web/package.json` still declares its build allowances
there, and `web/` has no `pnpm-workspace.yaml`. pnpm therefore refuses to run
esbuild's postinstall, and Astro's dependency-status check fails the build.

**Proof of diagnosis.** No file in the pinned clone was modified. The `web/`
directory was copied to a throwaway path, a `pnpm-workspace.yaml` declaring
`allowBuilds: {esbuild, sharp}` was added there, and the build was re-run:

```text
[build] 6 page(s) built in 5.91s
[build] Complete!
```

**Impact on FleetScope: none.** This is upstream pnpm-version drift in a site
FleetScope does not adopt. FleetScope's own `pnpm-workspace.yaml` already uses
the correct location (`allowBuilds: esbuild/sharp`), so the class of failure
cannot reach it.

### FleetScope's own baseline, for comparison

| Command | Exit | Result |
|---|---:|---|
| `cargo test` | **0** | 9 passed (`fleet-cockpit` cursor + transcript) |
| `pnpm test` | **0** | **91 passed** across 8 files (unit + replay projects) |

---

## C. Zoetrope architecture — implementation-backed

### C.1 Crate topology, and why `web/wasm` is separate (audit brief §5)

Two crates, two workspaces. This is **deliberate and correct**, and the upstream
manifests document it in-line rather than leaving it to be guessed.

`Cargo.toml` (root):

```toml
[workspace]
exclude = ["web/wasm"]
```

The stated reason, verified: `rataflow` gates its `ratzilla` `From` impls on
`all(feature = "ratzilla", target_arch = "wasm32")`. A **host-target** check of
`zoetrope-web` therefore fails to typecheck. Membership would expose that to
`cargo check --workspace` and, more importantly, to rust-analyzer — "two permanent
phantom errors in the editor". `default-members` would not fix it, because it does
not constrain `--workspace` or the editor. Cargo's own answer
(`per-package-target` / `forced-target`) is nightly-only.

`web/wasm/.cargo/config.toml` compensates:

```toml
[build]
target = "wasm32-unknown-unknown"
```

placed in the crate root because that is where `trunk` runs from, so cargo's
config discovery and the editor pick up the same default with one copy.

**Verified consequences:**

- `cargo check --no-default-features` (root) → exit 0. This is the *portable
  core*: model, timeline, graph projection, UI rendering, parser — no tokio, no
  crossterm, no filesystem. CI job `core` exists specifically to keep it honest.
- `cd web/wasm && cargo check --target wasm32-unknown-unknown` → exit 0.
- Two lockfiles. The upstream `DESIGN.md` states which packages must **not**
  drift between them: the `ratatui` tree (`ratatui`, `ratatui-core`,
  `ratatui-widgets`, `unicode-width`, `lru`, `line-clipping`, `instability`) plus
  rataflow's `rust-sugiyama`. Everything else (wasm-bindgen, getrandom, ratzilla)
  is *expected* to drift.

**Should FleetScope preserve this layout? Yes — and FleetScope must adopt it,
because it does not currently have it.** See the structural finding in §F.3.

### C.2 Module map (`src/`, 13,665 LOC, 20 files)

```text
src/
├── lib.rs           40   portable core root: state, tailer, transcript, ui
├── main.rs         567   native bin `zoe`, CLI, `inspect` subcommand
├── tui.rs          187   native terminal loop (16ms tick)
├── handler.rs      598   native input routing
├── autopilot.rs    476   native scripted demo pilot (ZOETROPE_DEMO=1)
├── transcript.rs  1370   ★ Claude JSONL serde model + fs discovery
├── state/
│   ├── mod.rs     1417   App: owns Flow + SessionModel + Timeline + SessionInfo
│   ├── session.rs 2319   ★ SessionModel — the fold
│   ├── timeline.rs1253   Timeline — ts-ordered items + playhead + scrubber math
│   ├── graph.rs    433   SessionModel → rataflow Flow projection (incremental)
│   └── info.rs      96   SessionInfo — untimed session metadata
├── tailer/
│   ├── mod.rs      162   wire types: TailRequest/UiEvent/Update/Source
│   ├── item.rs     501   PORTABLE: ReplayItem, Timing, replay_from_jsonl/_session
│   ├── live.rs     650   native live poll loop
│   ├── replay.rs   324   native up-front replay assembly
│   └── bytes.rs    406   native incremental byte reader
└── ui/
    ├── mod.rs     1052   draw: canvas + scrubber + status bar + overlays
    ├── nodes.rs    291   AgentNode card / cell (semantic zoom)
    ├── edges.rs     43   AgentEdge (animated while target Running)
    ├── chips.rs    865   ephemeral tool-call chips (single reconcile pass)
    └── panel.rs    615   ★ detail panel — renders prompt + reasoning
```

★ = carries Claude coupling or a FleetScope security concern.

`web/wasm/src/main.rs` (549 LOC) is the entire browser frontend.

### C.3 The browser data path (audit brief §6)

```text
include_str!("../../../assets/demo.jsonl")        ← compiled-in demo
   │  or  JS: File System Access API / drag-drop / <input webkitdirectory>
   ▼
zoetrope_load(main_text, subagents_json, live)     web/wasm/src/main.rs:~270
   ▼
replay_from_session(main, &[DemoSubagent])         src/tailer/item.rs:251
   ├── parse_line()                                src/transcript.rs:651
   ├── date_and_sort()  (Timing::Dated/Pending/Leader)  src/tailer/item.rs:109
   └── routes untimed flat metadata → SessionInfo
   ▼
UiEvent::ReplayLoaded { items, speed, info }       src/tailer/mod.rs:66
   ▼
App::handle_ui_event                               src/state/mod.rs:315
   ├── Timeline::load_replay(items, speed)         src/state/timeline.rs:146
   └── App::fold_to(items[0..fold_target()])
        ▼
   SessionModel::apply_update(&Update)             src/state/session.rs:398
        ▼
   graph::sync(&mut flow, &model, false)           src/state/graph.rs:115
        ▼
   ui::draw(frame, &mut app)                       src/ui/mod.rs
        ▼
   ratzilla WebGl2Backend → <div id="terminal-container">
```

Per-frame loop in the browser (`terminal.draw_web`, driven by
`requestAnimationFrame`) runs the *same* ticks the native loop does:
`flow.tick_auto_pan` → `flow.tick_animation` → `app.tick_camera` →
`app.tick_timeline` → `app.status_tick` → `ui::draw`. The only differences from
native are the IO source and that `status_tick` is called every frame instead of
being ~1s-gated.

Native path, for contrast: `tailer::run` → `run_live`/`run_replay` →
`bytes.rs` incremental reader (stat / read-appended / split-`\n` / buffer-partial,
with `(dev,ino)` rotation detection) → `UiEvent::Batch` over a bounded mpsc →
the same `App::handle_ui_event`.

### C.4 The state model (audit brief §7)

`SessionModel` — `src/state/session.rs:~310`:

| Field | Type | Role |
|---|---|---|
| `session_id` | `String` | identity stamp; App drops non-current events |
| `agents` | `BTreeMap<String, AgentInfo>` | key = `"main"` \| 17-hex `agentId` \| workflow id |
| `spawn_order` | `Vec<String>` | stable discovery order (BTreeMap order ≠ spawn order) |
| `completed_spawns` | `tool_use_id → (is_err, ack_ts)` | **join store** — the Agent-tool *spawn ack* |
| `task_terminal` | `agent_id → AgentStatus` | **join store** — `<task-notification>`, authoritative |
| `journal_done` | `{agent_id}` | **join store** — workflow journal `result` |
| `spawn_context` | `tool_use_id → SpawnContext` | provenance: prompt + reasoning excerpt |
| `prompts` | `Vec<PromptInfo>` | prompt eras; attribution via `prompt_for_ts` |
| `last_main_text` | `Option<String>` | cross-line reasoning fallback |

`AgentInfo` — authoritative vs derived is explicit:

| Field | Authoritative? |
|---|---|
| `kind` (`Main`/`Subagent`/`WorkflowGroup`), `agent_type`, `parent`, `spawned_by_tool_use`, `model`, `first_ts`, `last_ts`, `tool_calls`, `output_tokens` | **authoritative** (recorded) |
| `terminal: bool` | **authoritative** — pins against time-derived revival |
| `status: AgentStatus` | **derived**, reversible (`recompute_liveness`, `recompute_workflow_status`, `resolve_spawn_status`) |
| `interactive` | derived from `kind`/`agent_type == "fork"` |

Graph entities (`src/state/graph.rs`): nodes are **agents, not messages** — one
node per agent plus one group node per workflow run. Edge ids: `toolUseId` for
`main → direct subagent`, the workflow id for `main → workflow`, and
`workflow → its subagents`. Node ids are stable, which is why selection and
positions survive a rebuild (`graph::restore_positions`, `src/state/graph.rs:245`).

**Portable vs Claude-specific concepts:**

| Portable | Claude-specific |
|---|---|
| agent, parent/child, status, tool call (pending/ok/err), timestamps, token counts, timeline item, graph node/edge, selection, playhead, transport | session-as-Claude-session, prompt era, `<task-notification>`, spawn ack, workflow journal, subagents directory layout, 17-hex agentId |

### C.5 The fold — idempotency, order independence, reversibility (§8)

Verified against `docs/ARCHITECTURE.md` §1 **and** the test names in the run.

- **Order independence:** the model is "a pure function of the set of facts
  folded into it — never of their arrival order." Guarded by
  `final_state_is_arrival_order_invariant` (shuffle-invariance) and
  `live_delivery_converges_to_bulk_ordering` (400 random per-file interleavings
  land the same ts sequence as the bulk sort).
- **Idempotency:** re-applying a line is a no-op. `graph::sync` relies on it too
  — a duplicate-id `add_node` returns `Err` and is treated as a no-op.
- **Joins arrive in any order:** `completed_spawns`, `task_terminal`,
  `journal_done` are keyed stores precisely so a completion can be read *before*
  its spawn. Prompt/era attribution is timestamp-derived (`prompt_for_ts`), not a
  join store, so it is arrival-order independent by construction.
- **Backward replay: rebuild by folding the prefix, not snapshot restore.**
  `App::rebuild_to` constructs a fresh `SessionModel` + `Flow` from
  `items[0..target]` and carries view state across by node id. Forward seek folds
  in place (cheap). This is *why* order-independence is non-negotiable: the
  rebuild must land exactly where playing there would have.
- **Forward replay / live convergence:** `Timeline::append_live` compares cursor
  vs head. Behind the edge the cursor paces forward; only at the edge does it pin
  and snap in appends. A scrubbed-back live session catches up, then follows.
- **Reversibility:** "Derived state is never monotonic." A workflow rollup that
  concluded `Done` reverts to `Running` when a late child appears
  (`recompute_workflow_status` re-derives every call). A subagent settled to
  `Done` by 120s of quiet flips back to `Running` the moment it resumes or a tool
  goes pending.

The discipline that keeps it honest, quoted from upstream:

> Derive only where no ground truth exists, and never let a derivation override
> ground truth sitting in the model.

**Known soft spot, documented upstream and inherited by FleetScope:**
`resolve_spawn_status` classifies an async agent that has a spawn ack but no own
activity *yet* as terminal `Done` — a definitive conclusion from absence of
evidence. Irrelevant to FleetScope in practice, because the Scenario Compiler
emits deterministic fixtures in which every agent has activity. Recorded here so
it is not rediscovered as a bug.

### C.6 Timeline semantics (§9) — what FleetScope gets for free

`Timeline` (`src/state/timeline.rs:41`) fields: `items`, `replay`, `cursor`,
`folded`, `follow_head`, `speed`, `compress_gaps`.

**The two clocks — do not collapse them.** This is the single most important
concept FleetScope inherits, and `docs/ARCHITECTURE.md` §1.2 is emphatic:

| | Content-time | Presentation-time |
|---|---|---|
| a.k.a. | `cursor`, playhead | watch-time |
| advances by | the session's own timestamps | real seconds, only while playing |
| governs | folding, liveness, pending state, run grouping | camera glide, chip afterglow, marching ants |
| on seek | *is* the position | **not replayed** |

FleetScope's Event Cursor is a **content-time** concept. Nothing in the FleetScope
requirements needs presentation-time — but the Cockpit's animations use it, and
the requirement "historical mode MUST not look live"
(`docs/requirements/fleetscope/fleet-cockpit.md`) is a presentation-time rule.

**Free for FleetScope:**

| Capability | Where | FleetScope requirement satisfied |
|---|---|---|
| **Event-indexed scrubber** — `progress()`, `fold_at_fraction(f)`, `bar_fraction_for_index(i)` over `[floor, len]` | `timeline.rs:427/439/447` | "Position is allocated by event index, not wall-clock time" (`crates/fleet-cockpit/src/cursor.rs`) — a 12-day idle gap must not allocate 12 days of width. **Already satisfied.** |
| **Appends never yank a historical cursor** — `append_live` only snaps when `follow_head` | `timeline.rs:166` | "Events arriving during historical inspection do not move the cursor". **Already satisfied.** |
| Gap compression — graded log curve `compress_gap`, not a flat cap | `timeline.rs:283` | multi-week Case stays watchable |
| Gap markers `»` at ≥60s | `gap_markers()` `timeline.rs:458` | simulated day boundary is visually legible |
| Seek / pause / resume / jump-to-live | `App::seek_to_fraction:244`, `seek:504`, `go_live:300`, `toggle_play_pause:782` | Cockpit transport |
| Emergent transport `Live/Playing/Paused/History/Idle` | `App::transport():218` | live/historical mode indicator |
| Prompt-era stepping `[` / `]` | `App::seek_prompt:260` | reusable as *milestone* stepping |
| Activity sparkline over event ranges | `ui/mod.rs render_scrubber` | timeline density |

**Must change for FleetScope:**

| Gap | Why |
|---|---|
| No `unread` counter | FleetScope's `Cursor::unread()` counts events accepted while historical. Zoetrope has no equivalent. **Small addition.** |
| Cursor is `Option<DateTime<Utc>>`, not an index | FleetScope addresses by `caseSequence`. Bridge via `fold_target()` / `fold_at_fraction()` / the evidence manifest — **no core change needed**. |
| Markers are spawn `❋` / failure `✗` / gap `»` | FleetScope needs milestone / memory / identity / gateway / armor / incident / intervention markers. **Targeted `ui/mod.rs` change, or defer to the DOM rail.** |
| `replay` flag is launch intent | FleetScope is always recorded. Set `Mode::Replay`. No change. |

### C.7 What the UI renders — the security-relevant part

`src/ui/panel.rs:232` `render_provenance` — "Why does this agent exist" — renders
two things into the detail panel:

- `↳ prompt` — the triggering **user prompt text** (excerpt), and
- `↳ thought` — the **assistant's reasoning** right before the spawn
  (`SpawnContext::reasoning`, `src/state/session.rs:113`).

`AgentNode` cards render agent type, description, tool count, last tool name,
status word, and output token count. Chips render tool names.

FleetScope forbids exposing hidden chain-of-thought and requires Decision
Evidence instead. See §R for the mitigation (compile-time, not a Rust change).

---

## D. Claude coupling classification (audit brief §12)

Measured by grep across `src/` for `Claude|claude|task-notification|subagent_type|isSidechain|promptId|toolUseResult|agentId|sidechain`, then read.

**The coupling is concentrated in 2 of 20 files.**

| File | Hits | Class |
|---|---:|---|
| `src/transcript.rs` | 65 | **D — Claude-only** (parser + `~/.claude` discovery) |
| `src/state/session.rs` | 35 | **C/B — mostly test fixtures; ~6 production sites** |
| `src/state/timeline.rs` | 7 | B — prompt-era marker gating |
| `src/tailer/item.rs` | 5 | B — mostly test fixtures |
| `src/ui/nodes.rs`, `graph.rs`, `main.rs` | 3 each | A/D |
| everything else (`ui/mod.rs`, `chips.rs`, `panel.rs`, `edges.rs`, `state/mod.rs`, `tailer/*`) | ≤2 each | **A — portable** |

### The classification

**A. Portable — reuse unchanged**

- `src/state/timeline.rs` — the entire time-travel engine. Operates on
  `ReplayItem`; Claude-agnostic.
- `src/state/graph.rs` — `SessionModel → Flow` projection, incremental sync,
  `restore_positions`.
- `src/ui/*` — nodes, edges, chips, panel, scrubber, overlays, camera.
- `src/state/mod.rs` — `App`, seek, camera, transport.
- `src/tailer/item.rs` — `ReplayItem`, `Timing`, `date_and_sort`.
- The whole rendering stack: rataflow Sugiyama layout, ratzilla WebGl2.

**B. Portable with adapter — reuse, feed it compiled input**

- `SessionModel::apply_update` and the fold. It consumes
  `Update::Entry { source, entry }`. If FleetScope's Scenario Compiler emits
  Claude-shaped `Entry` values, the fold works unmodified and its 182 tests keep
  their meaning. **This is the strategy.**
- `is_spawn_tool(name)` — `src/transcript.rs:179`, matches `"Agent" | "Task" |
  "Workflow"`. The compiler must use one of those names to create a child agent.
- `apply_meta` — subagent `meta.json` shape `{agentType, description, toolUseId}`.
  The compiler emits these for the Logistics / Compliance / Warden agents.
- `parse_task_notification` — `src/transcript.rs:600`. Optional; the compiler can
  use a *non-superseded spawn ack* instead to terminate an agent, which is simpler.

**C. Must generalize — small targeted core change**

- **`unread` on the timeline.** ~15 lines in `timeline.rs` + accessor.
- **"Unknown renders as unknown, not zero."** `ui/nodes.rs` shows `0 tok` for an
  agent with no recorded usage; `fleet-cockpit.md` forbids that. ~10 lines.
- **"Historical mode MUST not look live."** `edges.rs` animates on
  `target Running` regardless of transport. Gate on
  `App::transport() != Transport::History`. ~5 lines.
- **Branding.** `ui/mod.rs` status bar renders the gold `zoetrope` wordmark;
  `ui/mod.rs`/`panel.rs` key hints. A `const BRAND` is enough.

**D. Claude-only — isolate, do not ship on the product path**

- `src/transcript.rs:684-846` — `claude_projects_root()`, `project_dir()`,
  `sanitize_cwd()`, `is_session_file()`, `latest_session_file()`,
  `scan_subagent_files()`, `subagents_dir()`, `workflow_journal()`. All are
  filesystem discovery, all are **native-only in practice** and unreachable from
  the browser build. No action needed beyond not calling them.
- `src/main.rs`, `tui.rs`, `handler.rs`, `autopilot.rs`, `tailer/{live,replay,bytes}.rs`
  — the whole `native` feature. **Excluded automatically** by
  `default-features = false`, which is exactly how `zoetrope-web` depends on the
  library today. **Do not delete them** (audit brief §45).

**Conclusion: the Rust domain model does not need rewriting.** The coupling that
matters is a *serde schema*, and a compiler can speak it.

---

## E. FleetScope gap analysis

| FleetScope requirement | Status | Where |
|---|---|---|
| Canonical Event envelope + closed type set | **already exists** | `packages/event-schema/src/{canonical-event,event-types}.ts` — 42 types |
| Canonicalizer / validation / idempotency | **already exists** | `validateCanonicalStream`; 16 schema tests |
| Pure versioned Session Projector + state hash | **already exists** | `packages/projector/src/project.ts`, `PROJECTOR_VERSION = 1.0.0`, `hashState` |
| Blessed prefix hashes | **already exists** | `packages/fixtures/cases/CASE-1042/expected-state.json`, terminal hash `cb99db39…` |
| CASE-1042 fixture | **already exists** | 60 canonical events, 3 sessions, multi-week |
| Evidence Manifest with `fraction` per marker | **already exists** | `evidence-manifest.json` — purpose-built for `fleetscope_seek` |
| Scenario Compiler + `RendererAdapter` seam | **partially** | `compile.ts` emits the *interim* transcript; needs a **second adapter** for Zoetrope |
| Astro shell: `/catalog`, `/cases`, `/cases/[id]`, `/approvals`, `/cockpit/[id]`, `/audit/[id]` | **already exists** | `apps/web/src/pages/**` — all six routes build |
| DOM evidence rail wired to `seekToCaseSequence` | **already exists** | `CockpitMount.astro`, `EvidencePanel.astro` |
| Cockpit ABI contract + wrapper | **already exists (stub)** | `crates/fleet-cockpit/src/abi.rs`, `cockpit-adapter.ts` |
| **Cockpit renderer (graph/timeline/camera/chips)** | **MUST BUILD — via vendoring** | `vendor/` empty |
| Seven platform adapter interfaces + mode contract | **already exists** | `packages/platform-adapters/src/*` |
| Bounded live API + live-mode guard | **already exists (501 stub)** | `apps/api/src/**`; Gemini call not implemented |
| Incident Detector / Policy Engine / Warden | **partially** | `INTERVENTION_TRANSITIONS` + projector states exist; detector/policy modules do not |
| Redaction boundary | **partially** | `payloadRedacted`/`payloadDigest` in the envelope; no compiler-side redaction test |

**One sentence: everything exists except the renderer.**

---

## F. Repository strategy decision

### The four strategies, scored

| Criterion (1 = bad, 5 = good) | A: transform Zoetrope in place | **B: vendor Zoetrope under FleetScope** | C: extract portable core | D: rewrite visualization |
|---|---:|---:|---:|---:|
| Six-day delivery risk | 2 | **5** | 3 | 1 |
| Amount of code moved | 1 (moves ~10k lines of TS) | **5** (moves nothing) | 2 | 4 |
| Build stability | 3 | **5** (upstream builds proven) | 3 | 2 |
| WASM stability | 4 | **5** | 3 | 1 |
| Ability to extend Astro | 2 (Starlight docs site) | **5** (product shell exists) | 5 | 5 |
| Domain cleanliness | 1 (Claude vocabulary at the root) | **5** (Case is the root) | 4 | 5 |
| Test preservation | 3 | **5** (182 + 91 + 9 all kept) | 2 (splits the crate) | 1 |
| License / upstream clarity | 2 (fork blurs authorship) | **5** (`vendor/` + notices) | 3 | 5 |
| Future maintainability / rebasability | 2 | **5** (isolated commits, rebasable) | 2 | 3 |
| **Total (max 45)** | **20** | **45** | **27** | **27** |

**Notes on the losers, so the choice is not taken on faith:**

- **A (fork Zoetrope, evolve in place).** Would make a Claude-Code TUI the
  repository root of an enterprise control plane. FleetScope's `Case` is the root
  concept, not `session` (audit brief §14). It would also strand ~10,000 lines of
  already-green FleetScope TypeScript, and it muddies attribution — the MIT
  notice would sit at the root of a product that is 60% not upstream.
- **C (extract the portable core).** Attractive in the abstract; the audit says
  no. The extraction boundary is *already drawn* by upstream — it is the
  `native` Cargo feature, and `default-features = false` gives FleetScope the
  portable core with **zero** code movement. Doing it again by hand would split
  `session.rs` from its 182 inline tests (upstream has no `tests/` dir; everything
  is `#[cfg(test)]` inline) and destroy the shuffle-invariance guarantee.
- **D (rewrite).** Would require rebuilding Sugiyama layout, camera glide,
  semantic zoom, the chip reconcile pass, the gap-compression curve, the
  event-indexed scrubber, and the ratzilla WebGl2 integration. Upstream's own
  `ARCHITECTURE.md` documents a *session's worth* of bug-hunting to get the chip
  and liveness semantics right. Not a six-day proposition.

### F.1 Decision

> **Strategy B.** FleetScope stays the repository. Zoetrope is vendored at
> `vendor/zoetrope/` pinned to `077707da679955c0402c39ca992bf56cdc6b0264`.
> `crates/fleet-cockpit` becomes the FleetScope-branded browser frontend that
> depends on it with `default-features = false`, implementing the
> `fleetscope_*` ABI over the real renderer.

This is exactly the procedure `vendor/README.md` already prescribes. The audit
confirms it and corrects three of its steps.

### F.2 Correction 1 — vendor by `exclude`, not by `members`

`vendor/README.md` step 4 says "Add `vendor/<name>` to the `Cargo.toml` workspace
members." **Do not do this.** Zoetrope's root `Cargo.toml` carries its own
`[workspace]` table with `exclude = ["web/wasm"]`. Adding it as a member would
require deleting that table, which:

- violates the same file's rule "Never rewrite upstream history or strip a
  license header" in spirit, and makes rebasing harder;
- would drag `vendor/zoetrope/web/wasm` into FleetScope's workspace resolution,
  reintroducing the exact phantom-error problem §C.1 documents;
- collides on `edition` / `rust-version` inheritance.

**Correct form** — FleetScope root `Cargo.toml`:

```toml
[workspace]
resolver = "2"
members  = ["crates/fleet-cockpit"]
exclude  = ["vendor/zoetrope"]      # its own workspace; wasm32-only frontend inside
```

A path dependency does not require workspace membership. `vendor/zoetrope`
resolves as its own workspace with its own lockfile and target dir — the same
shape upstream already validates.

### F.3 Correction 2 — `crates/fleet-cockpit` must leave the root workspace

**This is the most important structural finding in the audit.**

Today `crates/fleet-cockpit` is a root workspace member, host-testable, with
`abi.rs` behind `#[cfg(target_arch = "wasm32")]`. That works because it has no
wasm-only dependency. The moment it depends on `rataflow` with the `ratzilla`
feature, it inherits Zoetrope's constraint: **it can no longer be host-checked**,
because rataflow gates those `From` impls on `target_arch = "wasm32"`.

If it stays a member:
- `cargo check --workspace` breaks;
- rust-analyzer shows permanent phantom errors;
- `pnpm test:rust` (`cargo test --manifest-path crates/fleet-cockpit/Cargo.toml`)
  breaks — and that command currently passes 9 tests.

**Resolution — mirror upstream's proven split:**

| Crate | Workspace | Target | Purpose |
|---|---|---|---|
| `crates/fleet-cockpit` | **root member, host-testable** | host + wasm | keeps `transcript.rs` + `cursor.rs` and their 9 tests; **no ratzilla** |
| `crates/fleet-cockpit-web` | **own workspace (`exclude`d)** | wasm32 only | the `bin`; ratzilla + rataflow/ratzilla + `vendor/zoetrope`; owns `abi.rs` |

`crates/fleet-cockpit-web/.cargo/config.toml` sets
`[build] target = "wasm32-unknown-unknown"`, and `Trunk.toml` moves there.
`scripts/build-wasm.sh` retargets to `crates/fleet-cockpit-web/index.html`.

This preserves every existing test, keeps the editor honest, and reuses the
layout upstream already proved. It is a small, additive change — not a
reorganization (audit brief §23).

### F.4 Correction 3 — MSRV and edition

FleetScope's root `Cargo.toml` declares `edition = "2021"`, `rust-version = "1.82"`.
Zoetrope is `edition = "2024"`, `rust-version = "1.88"`. `fleet-cockpit-web`
depends on it, so **bump `workspace.package.rust-version` to `1.88`** (or set it
per-crate). `vendor/zoetrope` keeps its own values untouched.

Also note FleetScope's `[profile.release]` sets `panic = "abort"`;
`console_error_panic_hook` still functions, so no conflict.

### F.5 Licensing strategy (audit brief §2)

| Item | Finding | FleetScope obligation |
|---|---|---|
| `LICENSE` | MIT, © 2026 Furkan Kalaycioglu | Copy **verbatim** to `vendor/zoetrope/LICENSE`. Never edit. |
| `Cargo.toml` `license = "MIT"` | both crates | Preserve. |
| `rataflow`, `ratatui`, `ratzilla`, `rust-sugiyama` | crates.io deps, not vendored | Covered by `Cargo.lock`; `cargo tree --format '{p} {l}'` for the report |
| `assets/fonts/JetBrainsMono-*.ttf` | JetBrains Mono TTFs, bundled **with no accompanying OFL text** in the repository (`find` for `OFL`/font licence files returns only the root MIT `LICENSE`). Not compiled in — the crate `include` allow-list excludes `assets/`. | **Do not redistribute them.** FleetScope's `apps/web` uses its own type. If FleetScope ever self-hosts JetBrains Mono it must ship the OFL-1.1 text itself; do not rely on the upstream copy. |
| `assets/demo.jsonl` + `assets/demo/**` | Zoetrope's demo transcript, `include_str!`d by `zoetrope-web` | **FleetScope must not ship it.** `crates/fleet-cockpit-web` compiles in the FleetScope CASE-1042 transcript instead. |
| `assets/*.gif|mp4|png`, `zoetrope.svg`, `icon.svg` | upstream branding | **Do not use.** Not vendored, or vendored and unreferenced. |
| `web/` (Starlight site) | upstream marketing site | Not adopted. May be omitted from the subtree or vendored and unbuilt. |

**Attribution, one commit, no lag** (`vendor/README.md` rule): the commit that
adds `vendor/zoetrope/` must also update `/THIRD-PARTY-NOTICES.md` with project
name, URL, pinned SHA `077707da679955c0402c39ca992bf56cdc6b0264`, and a
statement of FleetScope's modifications. Per decision **D8**, these notices stay
in repository licensing files and **do not** appear in product navigation.

FleetScope's own `LICENSE` (MIT, © FleetScope contributors) is compatible; no
license change is required.

---

## G. Target architecture

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                        FleetScope (the repository)                        │
│                                                                           │
│  packages/fixtures ── CASE-1042 ── canonical-events.jsonl (60 events)      │
│         │                          evidence-manifest.json                 │
│         │                          expected-state.json (blessed hashes)   │
│         ▼                                                                 │
│  packages/event-schema ── Canonical Event envelope · closed 42-type set    │
│         │                 validateCanonicalStream (idempotent, ordered)    │
│         ▼                                                                 │
│  ┌──────┴───────────────────────────────┐                                 │
│  │                                      │                                 │
│  ▼  PROJECTION (authoritative)          ▼  VISUALIZATION (derived)        │
│  packages/projector                     packages/scenario-compiler        │
│   project(events, cursor)                compileScenario(events)          │
│   → ObservableCaseState                  → CockpitTranscript (interim)    │
│   → stateHash (sha256)                        │                           │
│   PURE: no clock/net/fs/env                   ▼  RendererAdapter          │
│         │                                zoetropeJsonlAdapter  ◄── NEW    │
│         │                                → Claude-shaped JSONL            │
│         │                                  + subagent sidecars            │
│         ▼                                     │                           │
│  apps/web (Astro, static)                     │                           │
│   /catalog  /cases  /cases/[id]               │                           │
│   /approvals  /audit/[id]                     │                           │
│   /cockpit/[id] ──────────────────────────────┤                           │
│        │  DOM evidence rail                   │                           │
│        │  cockpit-adapter.ts                  │                           │
│        │  seekToCaseSequence(seq, last)       │                           │
│        ▼                                      ▼                           │
│  ┌──────────────────────────────────────────────────────────┐             │
│  │  crates/fleet-cockpit-web   (own workspace, wasm32 only)  │             │
│  │  ── abi.rs: fleetscope_load / append / seek / go_live /   │             │
│  │             snapshot / select                             │             │
│  │  ── FleetScope branding                                   │             │
│  │            │ depends on (default-features = false)        │             │
│  │            ▼                                              │             │
│  │  vendor/zoetrope  @ 077707d   [MIT, unmodified]           │             │
│  │   state::{App, SessionModel, Timeline, graph}             │             │
│  │   ui::{nodes, edges, chips, panel, scrubber}              │             │
│  │   transcript::parse_line   tailer::replay_from_session    │             │
│  │   + rataflow (Sugiyama) + ratzilla (WebGl2)               │             │
│  └──────────────────────────────────────────────────────────┘             │
│                                                                           │
│  crates/fleet-cockpit  (root member, host-testable)                       │
│   transcript.rs · cursor.rs — 9 tests, kept                               │
│                                                                           │
│  apps/api  (optional, LIVE_MODE=false default, min=0/max=1)               │
└───────────────────────────────────────────────────────────────────────────┘
```

**Provenance legend**

| Marker | Meaning | Examples |
|---|---|---|
| **reused unchanged** | vendored, not edited | `vendor/zoetrope/src/state/**`, `ui/**`, `transcript.rs`, `tailer/item.rs` |
| **modified** | small, isolated, rebasable commits | `unread`, unknown-vs-zero, history-not-live edges, branding |
| **new FleetScope** | written this phase | `crates/fleet-cockpit-web/`, `zoetropeJsonlAdapter`, incident/policy modules |
| **existing FleetScope, untouched** | already green | `packages/{domain,event-schema,projector,fixtures,shared,platform-adapters}` |
| **post-hackathon** | explicitly deferred | live platform adapters, real Warden control, Audit Store persistence |

---

## H. Proposed repository tree

Additive. **No existing file moves.**

```text
FleetScope/
├── Cargo.toml                     M  members += fleet-cockpit-web? NO — exclude
│                                     exclude = ["vendor/zoetrope",
│                                                "crates/fleet-cockpit-web"]
│                                     workspace.package.rust-version = "1.88"
├── THIRD-PARTY-NOTICES.md         M  Zoetrope name/URL/SHA/modifications
├── vendor/
│   ├── README.md                  M  correct step 4 (exclude, not members)
│   └── zoetrope/                  NEW  git subtree @ 077707d  [MIT, verbatim]
│       ├── LICENSE                     verbatim, never edited
│       ├── Cargo.toml                  keeps its own [workspace]
│       ├── src/**                      13,665 LOC, 182 tests
│       └── web/                        upstream site — vendored, never built
├── crates/
│   ├── fleet-cockpit/             KEEP root member, host-testable
│   │   ├── src/{lib,transcript,cursor}.rs   9 tests preserved
│   │   └── src/abi.rs             MOVED OUT → fleet-cockpit-web
│   └── fleet-cockpit-web/         NEW  own workspace, wasm32 only
│       ├── Cargo.toml                  [workspace]; bin "cockpit"
│       ├── .cargo/config.toml          [build] target = wasm32-unknown-unknown
│       ├── Trunk.toml                  dist ../../apps/web/public/wasm
│       ├── index.html                  trunk entry + env.js importmap
│       ├── env.js                      libm + critical-section shims
│       └── src/
│           ├── main.rs                 ratzilla loop over vendored App
│           ├── abi.rs                  fleetscope_* exports
│           └── brand.rs                FleetScope wordmark/palette
├── packages/
│   ├── scenario-compiler/
│   │   └── src/adapters/
│   │       └── zoetrope-jsonl.ts  NEW  the second RendererAdapter
│   ├── incident/                  NEW  detector (post Slice 4)
│   └── policy/                    NEW  policy engine (post Slice 4)
├── apps/web/                      unchanged shell; Cockpit wiring only
├── scripts/build-wasm.sh          M  retarget to crates/fleet-cockpit-web
└── docs/
    ├── decisions/0002-…md         M  amend: upstream identified
    ├── decisions/0004-vendoring-zoetrope.md   NEW ADR
    └── plans/zoetrope-audit-and-implementation-plan.md   THIS FILE
```

Deliberately **not** proposed: `apps/`+`packages/`+`crates/` reshuffling (already
correct), a second frontend, React Flow, Firestore, Pub/Sub, moving Rust crates.

---

## I. Canonical event and projector strategy

### Two projectors — Option 1, and it is already built that way

| | FleetScope Projector | Zoetrope fold |
|---|---|---|
| Input | Canonical Events | Claude `Entry` / `Update` |
| Output | `ObservableCaseState` + `stateHash` | `SessionModel` → `Flow` |
| Contract | versioned, pure, hash-stable | order-independent, reversible |
| Authority | **authoritative** — badges, audit, approvals | **derived** — pixels only |
| Location | `packages/projector` | `vendor/zoetrope/src/state/session.rs` |

**Why not Option 2 (generalize Zoetrope into the FleetScope projector):** the two
solve different problems. FleetScope's projector must produce a *stable SHA-256
over canonically serialized state* across runs and runtimes; Zoetrope's fold
produces a render model with deliberately *heuristic, reversible* fields
(`recompute_liveness`'s 120s window, `resolve_spawn_status`). Making a hash
contract depend on a time-window heuristic would be a correctness disaster.
Keeping them separate is not a compromise — it is the right shape.

### Managing divergence risk

Two projections of one stream can disagree. Three mechanisms prevent it:

1. **One source of truth.** Both derive from the *same*
   `packages/fixtures/cases/CASE-1042/canonical-events.jsonl`. The compiler is
   forbidden from writing canonical evidence (`docs/architecture.md`: forbidden
   edge `compiler → canonical evidence`).
2. **Stable event IDs carried through.** Every compiled transcript entry keeps
   `fleetscope: { eventId, caseSequence, sessionId, eventType }`
   (`packages/scenario-compiler/src/transcript.ts`). Zoetrope will *ignore* these
   fields (serde ignores unknown fields on a known variant) — which is fine,
   because the mapping is resolved on the **DOM side** via the evidence manifest.
3. **The UI never reads authority from the renderer.** Badges (`ID allowed`,
   `GW routed`, `ARMOR blocked`) come from `ObservableCaseState` via
   `EvidencePanel.astro`. The Cockpit contributes *position*, never *verdict*.
   `PlatformBadge.evidenceEventId` is non-optional and asserted in the fixture
   test. This is invariant 6, already mechanically enforced.

### Ordering

- **Case ordering** is `caseSequence` — dense, deterministic, assigned at
  canonicalization; the total order across all sessions of the Case.
- **Session ordering** is `sessionSequence`, monotonic within a `sessionId`.
- **The Cockpit's cursor index is a third order** — the compiled entry index.
  It is *not* equal to `caseSequence` (not every canonical event becomes a
  visible entry). The evidence manifest's `fraction` is the bridge, and
  `cockpit-adapter.ts::seekToCaseSequence` already computes it.

### State hashes

`hashState` (`packages/projector/src/project.ts:563`) = sha256 over
`canonicalJson(ObservableCaseState)`. Blessed prefixes live in
`expected-state.json`; terminal hash `cb99db39d2006718578741775950fb639d160bf726997ae51c4785c4b759735a`.
**The Cockpit contributes nothing to this hash and must never be able to.**

---

## J. Scenario Compiler plan

### The boundary

```text
canonical-events.jsonl (60)
        │
        ▼  compileScenario()               [EXISTS — packages/scenario-compiler/src/compile.ts]
   CockpitTranscript  (renderer-neutral, interim)
        │
        ├─► interimJsonlAdapter        [EXISTS] → FleetScope interim JSONL
        │                                         (keep: used by crates/fleet-cockpit tests)
        │
        └─► zoetropeJsonlAdapter       [NEW]   → { main: string, subagents: OwnedSub[] }
                                                 Claude-shaped JSONL
                                                        │
                                                        ▼
                                        fleetscope_load(main, subagents_json, false)
```

The interim transcript stays as the **intermediate representation**. This is what
ADR 0002 designed the seam for; it needs no revision, only a second adapter.

### Proposed event mapping

Zoetrope's visible vocabulary is: agent nodes, parent edges, tool calls
(pending/ok/err), prompt eras, gaps. Everything below maps into that.

| Canonical event | Zoetrope representation |
|---|---|
| `case.created` | main agent birth; `ai-title` entry → session title = `CASE-1042 · Vendor Onboarding` |
| `registry.version_resolved` | tool call `AgentRegistry.resolve` → ok |
| `runtime.started` / `runtime.resumed` | **user prompt entry** — opens a prompt era (so `[` / `]` steps sessions) |
| `runtime.waiting` | a ≥60s timestamp gap → `»` gap marker, then the Day-12 jump |
| `runtime.completed` / `failed` | main-agent terminal tool result |
| `memory.written` / `recalled` | tool calls `MemoryBank.write` / `MemoryBank.recall` → ok |
| `memory.rejected` | `MemoryBank.write` → **err** |
| `identity.allowed` | `AgentIdentity.authorize` → ok, then `ERP.inventory.read` → ok |
| `identity.denied` | `AgentIdentity.authorize` → **err**; no downstream ERP call emitted |
| `gateway.routed` | `Agent` tool_use (spawn) — **creates the Logistics child node + edge** |
| `gateway.denied` | `AgentGateway.route` → **err**, no child spawned |
| `armor.allowed` / `flagged` | `ModelArmor.screen` → ok |
| `armor.blocked` / `sanitized` | `ModelArmor.screen` → **err**; **no downstream entry may reference the blocked input** |
| `agent.spawned` | `Agent` tool_use + `agent-<id>.meta.json` sidecar |
| `agent.completed` | non-superseded spawn ack (`tool_result`, `is_error: false`) → `terminal` |
| `agent.failed` | spawn ack with `is_error: true` → `Failed`, `terminal` |
| `tool.requested` | `tool_use` block (pending until its result) |
| `tool.succeeded` / `failed` | `tool_result` with/without `is_error` |
| `incident.opened` | `Warden.incident` → **err** chip (red `✗` scrubber marker) |
| `policy.evaluated` | `Warden.policy` → ok |
| `intervention.proposed/authorized/requested/acknowledged/succeeded` | **five separate** `Warden.*` tool calls — never one |
| `usage.recorded` | `usage.output_tokens` on the assistant entry |

### Where a fake Claude transcript becomes misleading or brittle

Called out honestly, per the brief:

1. **The five Intervention states.** Collapsing them into one chip would violate
   invariant 10 and the product's core honesty claim. **Mitigation:** emit five
   distinct tool calls; the authoritative rendering of the lifecycle is the DOM
   rail, which reads `ObservableCaseState.interventions[].state`.
2. **`armor.blocked` must have no downstream use.** A transcript is a linear
   text stream; nothing in Zoetrope enforces "this content never appears later."
   **Mitigation:** enforce it in the compiler with a test
   (`checkBlockedInputUse` already exists in the projector — mirror it as a
   compiler assertion over the emitted bytes).
3. **Identity/Gateway/Armor decisions as *tool errors*.** A denied identity
   check renders identically to a crashed tool. **Mitigation:** the Cockpit is
   deliberately *not* the authority here (D8: "Do not implement custom
   Registry/Memory/Identity/Gateway/Armor node renderers in Rust for MVP"). The
   DOM rail distinguishes `denied` from `failed`. Label the Cockpit accordingly.
4. **A 12-day gap in real timestamps.** Zoetrope's log gap-compression crosses
   "an hour of dead air in <10s" — 12 days compresses fine, but it must read as a
   *deliberate boundary*, not a glitch. **Mitigation:** a `Simulated Day 12`
   marker in the DOM rail synchronized to the gap's fraction.
5. **Prompt/reasoning fields.** See §R — the compiler must emit **no** `thinking`
   block and no prompt text beyond a neutral one-line milestone label.

### Would a small generalized input layer be cleaner?

**Yes, but not in six days, and not needed.** A `zoetrope::tailer::from_facts()`
that accepted a neutral `(agent, parent, kind, ts, label, state)` tuple stream
would avoid the fake-transcript smell entirely — roughly 200 lines in
`vendor/zoetrope/src/tailer/`. It is the right **post-hackathon** move and should
be offered upstream. For the MVP it adds a core modification to the critical path
in exchange for elegance, and the compiler bridge is already scoped. **Recorded
as deferred, not rejected.**

---

## K. WASM / Cockpit integration plan

### Exports that exist today, exhaustively

`vendor/zoetrope/web/wasm/src/main.rs` exports **exactly two** `#[wasm_bindgen]`
functions:

| Export | Signature | Behavior |
|---|---|---|
| `zoetrope_load` | `(main_text: String, subagents_json: String, live: bool)` | Replaces the whole `App`. Parses via `replay_from_session`. `live` → `Mode::Live` (opens at the edge) vs `Mode::Replay` (paced from the start). |
| `zoetrope_append` | `(main_tail: String, subagents_json: String)` | Parses new bytes into `Vec<Update>`, dispatches `UiEvent::Batch`. Folds at the edge when following; **no-op if nothing parses**. |

Plus `main()`, which boots the compiled-in demo and installs the ratzilla loop,
key handler, mouse handler, and a manual `wheel` listener on `#terminal-container`.

**JS wrappers:** `web/src/pages/app.astro:516`
`import init, { zoetrope_load, zoetrope_append } from '/wasm/web.js';`
— plus File System Access API directory picking, a 1s `pollLive` tail loop
(`app.astro:1173`), drag-drop, and `webkitdirectory` fallback.

### Answers to the brief's §10 checklist

| Question | Answer |
|---|---|
| How does data enter? | Two string args across the wasm boundary. JS reads bytes; Rust parses. |
| Whole transcripts loadable? | **Yes** — `zoetrope_load`, main + sidecars. |
| New events appendable? | **Yes** — `zoetrope_append`. |
| Seek triggerable externally? | **No.** `App::seek_to_fraction` is public but unexported. |
| Selected agent readable externally? | **No.** `App::selected_agent_id()` is public but unexported. |
| Playhead/cursor observable? | **No.** `Timeline::progress()` public but unexported. |
| Demo fixtures? | `include_str!` at compile time. |
| JS/DOM ↔ canvas? | One-way JS→WASM only. **No WASM→JS channel exists.** |
| Resize / focus / keyboard / mouse? | ratzilla owns resize + key + mouse; wheel is a manual `web_sys` listener. |

### Proposed minimal additions

All six wrap **existing public methods**. Estimated **~120 lines** in
`crates/fleet-cockpit-web/src/abi.rs`, zero changes to `vendor/zoetrope` for four
of them.

| FleetScope ABI | Implementation | Core change? |
|---|---|---|
| `fleetscope_load(jsonl)` | `zoetrope_load(main, subs, false)` internals | none |
| `fleetscope_append(entry_json)` | `zoetrope_append` internals | none |
| `fleetscope_seek(fraction)` | `app.pending_seek = Some(f)` — **queue, don't seek**, exactly as the native/browser mouse handlers do (a backward seek rebuilds the model; the rAF tick applies only the latest) | none |
| `fleetscope_go_live()` | `App::go_live()` | none |
| `fleetscope_snapshot()` | `{ caseSequence, entryIndex: timeline.fold_target(), entryCount: items.len(), atEdge: timeline.at_edge(), unread, selectedNodeId: app.selected_agent_id() }` | **`unread` counter — the one real addition** |
| `fleetscope_select(node_id)` | `App::center_node(id, true)` + `flow.select_node` | none |

**`caseSequence` in the snapshot:** Zoetrope will not carry the `fleetscope`
field through its parser. Two options —

- **(recommended, zero core change)** return `entryIndex` only; the DOM maps
  index → `eventId`/`caseSequence` through the evidence manifest, which already
  carries `fraction` per marker. `cockpit-adapter.ts` absorbs it.
- (fallback) add a side table in `abi.rs`: the compiler emits a parallel
  `index → {eventId, caseSequence}` array loaded alongside the transcript.

Prefer the first. It keeps the whole mapping in TypeScript, where it is testable
without a browser.

**Do not add** WASM→JS event emission, two-way selection sync, or per-platform
Rust node types (`budget-demo.md` risk row: "DOM/WASM cursor synchronization is
hard — add only fraction seek/snapshot; use scripted phase buttons, not full
two-way selection"). The DOM polls `fleetscope_snapshot()` on rAF or a 250ms
interval; that is sufficient and far more robust.

---

## L. Frontend plan

**Extend `apps/web`. Do not adopt Zoetrope's Starlight site.** The routes exist
and build today:

| Route | File | State | Work |
|---|---|---|---|
| `/catalog` | `pages/catalog.astro` | exists | Agent Version card, approval state, Registry digest |
| `/cases` | `pages/cases/index.astro` | exists | Case list |
| `/cases/[caseId]` | `pages/cases/[caseId].astro` | exists | milestones, memory provenance, badges, cost |
| `/approvals` | `pages/approvals.astro` | exists | Approval Inbox |
| `/cockpit/[caseId]` | `pages/cockpit/[caseId].astro` | exists, renderer disabled | mount the real WASM |
| `/audit/[caseId]` | `pages/audit/[caseId].astro` | exists | stream revision + projector version disclosure, export |

Reusable as-is: `layouts/BaseLayout.astro`, `components/{Nav,ModeLabel,EvidencePanel}.astro`,
`lib/{fixtures,config}.ts`, `styles/global.css`.

### DOM ↔ WASM synchronization

Already implemented in `CockpitMount.astro`, waiting on the module:

```text
[data-evidence-marker] click
   → marker.dataset.caseSequence
   → cockpit.seekToCaseSequence(seq, lastCaseSequence)
   → fraction = seq / lastCaseSequence            (clamped 0..1)
   → abi.fleetscope_seek(fraction)
   → app.pending_seek → next rAF tick → App::seek_to_fraction
```

Reverse direction (**new**): a rAF/250ms poll of `fleetscope_snapshot()` →
`entryIndex` → manifest lookup → highlight the active evidence row, update the
`Recorded` / `Historical` / `Live` label, and show `unread` when scrubbed back.

`CockpitMount.astro` already states the real reason when the renderer is absent
rather than faking a graph — that behavior must survive, as the graceful
degradation path if Slice 0 slips.

---

## M. Backend / live plan

**Recorded is the default and the whole product works without a backend.**
`LIVE_MODE=false` fails closed (only the literal `"true"` enables it). The static
build inlines fixtures; `apps/web/dist/` already contains the compiled transcript
and manifest, so the demo survives the network being disconnected after load.

`apps/api` exists with `/health`, `/capability`, the allowlist, and the live
guard. The Gemini call is deliberately **not implemented** — an allowlisted step
returns `501 not_implemented` rather than a fabricated result
(`docs/decisions/0003-bounded-live-path.md`). That is the correct state to be in
at audit time.

Bounded live proof (**Slice 7, cuttable**): exactly one `(caseId, stepId)` pair,
`GEMINI_MAX_CALLS_PER_CASE=2`, 2000 in / 300 out tokens, temperature 0, 15s
timeout, Cloud Run `min-instances=0` / `max-instances=1`, no worker. The result is
canonicalized and appended via `fleetscope_append`. **If it fails, it falls back
to the recorded result instantly and the demo is unaffected.**

Not added: Firestore, Pub/Sub, Redis, Kafka, always-on worker, microservices,
Kubernetes. No audited requirement makes any of them unavoidable.

---

## N. Platform adapter plan

Interfaces exist in `packages/platform-adapters/src/{registry,runtime,memory,identity,gateway,armor,observability}/`
with an explicit mode contract (`mode.ts`, 11 tests).

| Adapter | MVP mode | UI label | Rationale |
|---|---|---|---|
| Agent Registry | **recorded evidence** (live candidate) | `Recorded Case` / `Live proof` | best single live-proof candidate: one cheap read, real version digest |
| Agent Runtime | **recorded evidence** | `Recorded Case` + `Simulated day boundary` | multi-week wait/resume cannot be real in six days |
| Memory Bank | **recorded evidence** | `Recorded Case` | provenance is the point; recorded shows it faithfully |
| Agent Identity | **synthetic enforcement** | `Synthetic system` | the allow/deny decision is made outside the UI by adapter code |
| Agent Gateway | **synthetic enforcement** | `Synthetic system` | route decision precedes the edge existing |
| Model Armor | **synthetic enforcement** | `Synthetic system` | block must demonstrably prevent downstream use |
| Agent Observability | **recorded evidence** | `Recorded Case` | usage/cost totals from `usage.recorded` |

**Rules the plan commits to** (audit brief §30):

- An interface is **not** an integration. `mode.ts` makes the distinction typed.
- A configured logo is **not** evidence. Per D8, vendor logos do not appear.
- Every surface labels its mode via `ModeLabel.astro`; the four labels are
  `Recorded Case`, `Live proof`, `Synthetic system`, `Simulated day boundary`.

---

## O. Warden / control plan

```text
Canonical Events
   → Incident Detector      (packages/incident — NEW, deterministic, pure)
   → [optional model adviser]  ── advice only, never authority
   → Policy Engine          (packages/policy — NEW, versioned)
   → Intervention           (proposed → authorized|rejected → requested
                             → acknowledged → succeeded|failed|timed_out)
   → Control Adapter
   → Runtime
```

Already enforced: `INTERVENTION_TRANSITIONS` forbids skipping states and the
projector records illegal transitions (invariant 10); `PolicyDecision` sits
between advice and `Intervention`, and `DecisionEvidence.modelReference` is a
separate field from `authorization` (invariant 9).

**The model may recommend. The model must never call the Control Adapter.**
Enforced structurally: `packages/projector` is forbidden from touching any
control path, and a purity test greps its source for forbidden APIs.

**Smallest safe recovery for the golden scenario:** *one bounded retry of an
idempotent, read-only Logistics tool.* Correct choice — read-only and idempotent
means a duplicated request cannot corrupt anything, and one retry bounds cost.
**It must be labeled `Recorded Case` unless and until a real Runtime API is
confirmed to acknowledge and terminate it.** Do not claim it live on the strength
of the interface existing (§N rule 1).

Also enforced: **historical replay must cause zero control action.** Moving the
Event Cursor changes only what is projected — stated in
`crates/fleet-cockpit/src/cursor.rs` and true of Zoetrope's `App::seek` as well
(seeking rebuilds a model; it has no side-effect path).

---

## P. File-level implementation roadmap

Ordered by dependency. Effort: XS < 1h, S ≈ half day, M ≈ 1 day, L ≈ 2 days, XL > 2 days.

---

### Slice 0 — Vendor the upstream (the critical path)

**Goal:** `vendor/zoetrope` present at the pinned SHA, attributed, its own tests
green in-tree, and both workspaces resolving.

| | |
|---|---|
| **New** | `vendor/zoetrope/**` via `git subtree add --prefix vendor/zoetrope https://github.com/furkankly/zoetrope.git 077707da679955c0402c39ca992bf56cdc6b0264` |
| **Modified** | `Cargo.toml` — `exclude = ["vendor/zoetrope", "crates/fleet-cockpit-web"]`; `workspace.package.rust-version = "1.88"` |
| **Modified** | `THIRD-PARTY-NOTICES.md` — name, URL, SHA, modifications statement (**same commit**) |
| **Modified** | `vendor/README.md` — correct step 4 to `exclude`; record the SHA |
| **New** | `docs/decisions/0004-vendoring-zoetrope.md` |
| **Modified** | `docs/decisions/0002-cockpit-renderer-boundary.md` — "open dependency" → resolved |
| **Tests** | `cd vendor/zoetrope && cargo test` → must still be **182 + 8**; `cargo clippy -D warnings`; `cargo fmt --check`; FleetScope `cargo test` still 9; `pnpm test` still 91 |
| **Acceptance** | upstream tests pass **unmodified**; `cargo metadata` resolves both workspaces; MIT notice verbatim |
| **Risk** | Low. Every command already proven at audit. |
| **Effort** | **S** |

**Prerequisite:** `cargo install --locked trunk` (6m10s at audit → 0.21.14).
Already validated: the upstream `build-wasm.sh` produced working artifacts on
this machine, so Slice 0 inherits a proven toolchain rather than an assumed one.

---

### Slice 1 — Split the Cockpit crate

**Goal:** a wasm32-only frontend crate exists and builds, without breaking
host-side checks or the 9 existing tests.

| | |
|---|---|
| **Reused** | `crates/fleet-cockpit/src/{transcript,cursor}.rs` + `tests/` — untouched, stay host-testable |
| **New** | `crates/fleet-cockpit-web/{Cargo.toml,Trunk.toml,index.html,env.js,.cargo/config.toml}` |
| **New** | `crates/fleet-cockpit-web/src/main.rs` — ratzilla loop, adapted from `vendor/zoetrope/web/wasm/src/main.rs` |
| **Moved** | `crates/fleet-cockpit/src/abi.rs` → `crates/fleet-cockpit-web/src/abi.rs` |
| **Modified** | `crates/fleet-cockpit/src/lib.rs` — drop the `#[cfg(wasm32)] pub mod abi` |
| **Modified** | `scripts/build-wasm.sh` — `trunk build crates/fleet-cockpit-web/index.html` |
| **Modified** | `package.json` — `test:rust` unchanged; add `build:wasm` verification to `smoke` |
| **Interfaces** | `Cargo.toml`: `zoetrope = { path = "../../vendor/zoetrope", default-features = false }`, `rataflow` features `["sugiyama","ratzilla"]`, `ratzilla = "0.3.1"`, `critical-section = { features = ["std"] }` |
| **Tests** | `cargo check --workspace` (root) clean; `cd crates/fleet-cockpit-web && cargo check` clean; `pnpm build:wasm` emits `apps/web/public/wasm/{cockpit.js,cockpit_bg.wasm,env.js}` |
| **Acceptance** | rust-analyzer reports zero errors in both; the 9 tests still pass |
| **Risk** | **Medium — highest in the plan.** `critical-section` linking and the libm `env` importmap are the two known wasm traps; upstream's `env.js` solves both and must be copied verbatim. |
| **Effort** | **M** |

---

### Slice 2 — Prove the vendored renderer in FleetScope's shell

**Goal:** `/cockpit/CASE-1042` renders a real graph — of Zoetrope's own demo
fixture. Proves the whole pipe before FleetScope data is involved.

| | |
|---|---|
| **Modified** | `crates/fleet-cockpit-web/src/main.rs` — boot from a compiled-in transcript |
| **Modified** | `apps/web/src/features/cockpit/CockpitMount.astro` — `init()` the module, publish the ABI on `globalThis.fleetscopeCockpit` |
| **Reused** | `cockpit-adapter.ts::createCockpit` — already probes `globalThis.fleetscopeCockpit` and validates the five required exports |
| **Tests** | manual: page loads, graph renders, `?`/`i` overlays, mouse pan/zoom/select work |
| **Acceptance** | `cockpit.available === true`; no console errors; **this is the Slice 0 gate from `six-day-delivery.md`** |
| **Risk** | Medium — WebGl2 in the target browser; font atlas glyph coverage (upstream already uses `FontAtlasConfig::dynamic` to fix `✓ ✗ ❋`) |
| **Effort** | **S** |

---

### Slice 3 — The Zoetrope renderer adapter

**Goal:** CASE-1042 canonical events render as the FleetScope story.

| | |
|---|---|
| **Reused** | `packages/scenario-compiler/src/compile.ts`, `transcript.ts`, `renderer-adapter.ts` — the seam is already right |
| **New** | `packages/scenario-compiler/src/adapters/zoetrope-jsonl.ts` — `RendererAdapter` emitting `{ main, subagents }` per §J |
| **New** | `packages/scenario-compiler/tests/zoetrope-adapter.test.ts` |
| **Modified** | `packages/scenario-compiler/src/cli.ts` — `--adapter zoetrope` |
| **Modified** | `crates/fleet-cockpit-web/src/main.rs` — compile in the emitted CASE-1042 transcript |
| **Interfaces** | reuse the existing `RendererAdapter`; **no change to `CanonicalEvent`, `domain`, or any fixture** |
| **Tests** | golden-output test; **redaction test** (no `thinking` block, no raw prompt); **blocked-input test** (no entry after `armor.blocked` references the blocked payload); agent/edge count assertions |
| **Acceptance** | Cockpit shows orchestrator + Logistics child, tool chips for Registry/Memory/Identity/Gateway/Armor, a red `✗` at the logistics failure, a `»` gap at Day 12 |
| **Risk** | **Medium-high — the largest new-code item.** Mitigate by writing the golden JSONL by hand first, loading it through the browser manually, *then* writing the generator to reproduce it. |
| **Effort** | **L** |

---

### Slice 4 — Cursor synchronization

**Goal:** DOM evidence rail and Cockpit playhead agree in both directions.

| | |
|---|---|
| **Modified** | `crates/fleet-cockpit-web/src/abi.rs` — `fleetscope_seek` (queue via `pending_seek`), `go_live`, `snapshot`, `select` |
| **Modified** | `vendor/zoetrope/src/state/timeline.rs` — **the one core change:** `unread: usize`, incremented in `append_live` when `!follow_head`, cleared by `go_live`. *Isolated commit, rebasable.* |
| **New** | `apps/web/src/features/cockpit/lib/cursor-sync.ts` — poll `snapshot()`, map `entryIndex` → manifest marker, drive labels |
| **Modified** | `CockpitMount.astro` — wire the poll; render `unread` |
| **Reused** | `cockpit-adapter.ts::seekToCaseSequence` — unchanged |
| **Tests** | unit: index→marker mapping; manual: click a marker → playhead moves; scrub back → `Historical` + unread count; `Go live` → clears |
| **Acceptance** | "Returning from historical state to live mode MUST not skip accepted events" (`audit-and-replay.md`) |
| **Risk** | Medium — flagged upstream in `budget-demo.md`. Mitigated by one-way polling instead of two-way events. |
| **Effort** | **M** |

---

### Slice 5 — Branding and honesty labels

| | |
|---|---|
| **Modified** | `vendor/zoetrope/src/ui/mod.rs` — wordmark via a `const BRAND` (isolated commit) |
| **Modified** | `vendor/zoetrope/src/ui/nodes.rs` — unknown renders as `—`, not `0 tok` |
| **Modified** | `vendor/zoetrope/src/ui/edges.rs` — no animation when `transport == History` |
| **Modified** | `vendor/zoetrope/src/ui/panel.rs` — **suppress the `↳ thought` provenance row** (defence in depth; the compiler already emits none) |
| **Reused** | `apps/web/src/components/ModeLabel.astro` |
| **Tests** | upstream's 182 must still pass after each change |
| **Acceptance** | no `zoetrope` string in product navigation; attribution present in `THIRD-PARTY-NOTICES.md` only (D8) |
| **Risk** | Low |
| **Effort** | **S** |

---

### Slice 6 — Incident, Policy, Warden

| | |
|---|---|
| **New** | `packages/incident/src/detect.ts` — pure, versioned, `detectorVersion` |
| **New** | `packages/policy/src/evaluate.ts` — pure, versioned, `policyVersion` |
| **Reused** | `INTERVENTION_TRANSITIONS`, `PolicyDecision`, `DecisionEvidence` in `packages/domain` |
| **Modified** | `packages/fixtures/.../canonical-events.jsonl` — confirm the five intervention states are distinct events; re-bless |
| **Tests** | intervention idempotency; illegal-transition rejection; **historical replay causes no control action** |
| **Acceptance** | invariants 9 and 10 hold mechanically |
| **Risk** | Low — the hard constraints already exist |
| **Effort** | **M** |

---

### Slice 7 — Optional bounded live proof (**cuttable**)

| | |
|---|---|
| **Modified** | `apps/api/src/services/decision-evidence.ts` — the one Gemini call |
| **Modified** | `apps/api/src/routes/live.ts` — replace `501` for the single allowlisted step |
| **New** | `apps/web/.../live-append.ts` — canonicalize → `fleetscope_append` |
| **Tests** | guard tests (already exist); 3 consecutive bounded runs |
| **Acceptance** | ≤ USD 35 total; recorded fallback instant on failure |
| **Risk** | High (external), but **zero blast radius** — the whole product works without it |
| **Effort** | **M** |

---

### Slice 8 — Hardening

Redaction test over emitted bytes; accessibility pass (`fleet-cockpit.md`: "Edge
type, direction, and state MUST be distinguishable without color alone"); static
deploy; `pnpm smoke` extended to cover `build:wasm`. **Effort: M.**

### Slice 9 — Demo

10 consecutive recorded runs; network-disconnected proof; recording; truthfulness
review against §N labels. **Effort: S.**

---

## Q. Six-day delivery plan

Adjusted from `docs/plans/six-day-delivery.md` for what the audit found already
built. Days 1–2 of the original plan are substantially complete.

| Day | Work | **Hard gate (end of day)** | Cut line if missed |
|---|---|---|---|
| **1** | **Slice 0** + **Slice 1** (`trunk` already proven at audit — just `cargo install --locked trunk`) | `vendor/zoetrope` in tree, 182 upstream tests green, both workspaces resolve, `pnpm build:wasm` emits `cockpit_bg.wasm` + `cockpit.js` + `env.js` | **If the FleetScope-side wasm build fails by EOD 1 → abandon the vendored renderer**, ship the static SVG Cockpit fallback, keep everything else |
| **2** | **Slice 2** + start **Slice 3** (hand-write the golden JSONL) | `/cockpit/CASE-1042` renders a real graph from a hand-written FleetScope transcript | Cockpit stays disabled with its honest message; DOM rail carries the demo |
| **3** | Finish **Slice 3**; **Slice 4** | CASE-1042 compiles end-to-end; marker click moves the playhead | Ship scripted phase buttons instead of manifest-driven seek |
| **4** | **Slice 5** + **Slice 6** | branding done; Intervention lifecycle projects exactly once with 5 distinct states | Warden recovery becomes recorded-only, clearly labeled |
| **5 am** | **Slice 8** hardening; redaction + a11y | `pnpm check` and `pnpm smoke` green | — |
| **5 pm** | **Slice 7** live proof *only if days 1–4 hit every gate* | 3 consecutive bounded live runs, ≤ USD 35 | **Cut entirely.** `LIVE_MODE=false`, labeled recorded |
| **6** | **Slice 9** — 10 recorded runs, network-off proof, recording, truthfulness review, submission | 10/10 pass with the network disconnected | buffer |

**The standing cut line:** the recorded path is the product. Slice 7 is the first
thing cut, Slice 6's live labeling second, Slice 5's polish third. **Slices 0–4
are not cuttable** — they are the Cockpit.

---

## R. Test plan

### Preserved upstream (never delete or weaken — audit brief §45)

| Suite | Count | Command |
|---|---:|---|
| Zoetrope library | **182** | `cd vendor/zoetrope && cargo test` |
| Zoetrope binary | **8** | same |
| clippy `-D warnings` | — | `cargo clippy --all-targets` |
| `cargo fmt --check` | — | — |
| portable core builds | — | `cargo check --no-default-features` |
| wasm frontend checks | — | `cargo check --target wasm32-unknown-unknown` |

The two that matter most and must never be allowed to rot:
`final_state_is_arrival_order_invariant` and
`live_delivery_converges_to_bulk_ordering`. Every Slice-4/5 core edit must re-run
them.

### Preserved FleetScope

| Suite | Count | Command |
|---|---:|---|
| `fleet-cockpit` cursor + transcript | **9** | `pnpm test:rust` |
| unit (domain, schema, config, compiler, api guards) | 66 | `pnpm test:unit` |
| replay (projector determinism, CASE-1042) | 25 | `pnpm test:replay` |

### New

**Canonical layer**

- schema validation on the closed 42-type set (exists — extend)
- duplicate source event → idempotent (exists — assert on the new adapter path)
- out-of-order canonicalization → deterministic Case order
- projector determinism + prefix state hashes (exists)
- **secret redaction** — NEW, load-bearing: assert the emitted Zoetrope JSONL
  contains no `"thinking"` key, no prompt text beyond milestone labels, no local
  path, no credential-shaped string

**Integration**

- CASE-1042 full recorded run
- multi-session resume (3 sessions, no repeated completed effect)
- memory provenance present on every recall
- identity allow **and** deny
- gateway route **and** deny
- **Armor no-downstream-use invariant** — asserted over the *emitted transcript
  bytes*, not just the projector
- intervention idempotency; five states never collapsed
- **historical replay causes no control action**
- disconnect/reconnect convergence

**Demo reliability**

- **10 consecutive recorded runs**, the last with the network disconnected after
  first load
- if live mode ships: **3 consecutive bounded live runs**

### Security findings and the redaction boundary (audit brief §34)

| Zoetrope behavior | Exposure | FleetScope mitigation |
|---|---|---|
| `ui/panel.rs:232` `render_provenance` renders `↳ prompt` (user prompt text) and **`↳ thought` (assistant reasoning)** | **chain-of-thought and raw prompts** — directly forbidden by the FleetScope requirements | **Primary: the Scenario Compiler never emits `thinking` blocks or prompt text.** The panel has nothing to render. **Secondary (Slice 5): delete the `↳ thought` row.** |
| `transcript.rs` parses `tool_use.input` (arbitrary args) | tool arguments | Compiler emits only a neutral `summary` string per call |
| `transcript.rs:684-846` `~/.claude/projects`, `sanitize_cwd` | **local filesystem paths** | Native-only; unreachable from the browser build. Never call it. |
| `include_str!("assets/demo.jsonl")` | upstream's own demo session | **Not shipped** — FleetScope compiles in its own transcript |
| `ui/panel.rs` renders tool `summary` — "path tools keep the basename" | local paths in summaries | Compiler controls every summary string |
| `SessionInfo` → `i` overlay: mode, permission-mode, **last prompt** | prompt text | Compiler emits none of these entry types |

**The redaction boundary is the Scenario Compiler**, and it sits *before*
persistence and *before* rendering. That is the right place: it is pure,
testable without a browser, and it means the Rust renderer is never trusted with
a secret it could leak. The Canonical Event envelope already supports this with
`payloadRedacted` / `payloadDigest`.

**Note:** Zoetrope has a hard "no network IO, ever" constraint — no
reqwest/hyper anywhere in the dependency tree, dev-deps included. That is a
security *asset* FleetScope inherits: the renderer structurally cannot exfiltrate.

---

## S. Risk register

Ranked by probability × impact.

| # | Risk | P | I | Mitigation | Validate by | Fallback |
|---:|---|---|---|---|---|---|
| 1 | **WASM build fragility** — critical-section linking, libm `env` imports, wasm-bindgen drift | **Low** (was Med) | **Critical** | **Already validated: the upstream build ran to `✅ success` during the audit** (trunk 0.21.14, wasm-bindgen 0.2.127, wasm-opt v123). Copy `env.js` + the importmap verbatim; `critical-section = {features=["std"]}` in the **bin**; keep two lockfiles | **EOD Day 1** (reproduce under `crates/fleet-cockpit-web/`) | Static SVG Cockpit; everything else ships |
| 2 | **Scenario Compiler complexity** — 42 event types → Claude vocabulary | Med | High | Hand-write the golden JSONL first, verify in-browser, then generate to match | EOD Day 2 | Ship the hand-written transcript as the fixture |
| 3 | **`crates/fleet-cockpit` can no longer be host-checked** once it pulls ratzilla | **High** | High | **Split the crate (§F.3) — do it in Slice 1, not reactively** | Day 1 | — (structural, must be done) |
| 4 | **Two-projector divergence** | Low | **Critical** | One source stream; `evidenceEventId` non-optional; UI reads verdicts only from `ObservableCaseState` | continuous | — |
| 5 | **DOM ↔ WASM cursor sync** | Med | Med | One-way polling of `fleetscope_snapshot()`; no two-way events | EOD Day 3 | Scripted phase buttons |
| 6 | **Chain-of-thought / prompt leakage** | Med | **Critical** (truthfulness) | Compiler-side redaction **plus** panel change; a test over emitted bytes | Day 3 | — |
| 7 | **Case-vs-Session domain mismatch** | Low | High | Case is the root in `domain`; Zoetrope's "session" is a *render* concept only, never surfaced | done | — |
| 8 | **MSRV / edition conflict** (1.82 vs 1.88, 2021 vs 2024) | **High** | Low | Bump `workspace.package.rust-version` to 1.88 in Slice 0 | Day 1 | — |
| 9 | **Platform API availability** (Registry/Memory/Identity/Gateway/Armor) | High | Med | All default to recorded/synthetic with explicit labels | Day 1 | already the default |
| 10 | **Runtime wait/resume semantics** unavailable | High | Med | Simulated Day 12, explicitly labeled | Day 1 | already the default |
| 11 | **Warden Runtime control** not really available | High | Med | Recorded acknowledgement; never claim live without an authoritative result | Day 4 | recorded-only |
| 12 | **Gemini / cloud budget** (USD 35) | Low | Med | Hard caps in code; `LIVE_MODE=false` default; ≤2 calls/Case | Day 5 pm | cut Slice 7 |
| 13 | **License attribution lag** | Low | High | Notices in the **same commit** as `vendor/` | Day 1 | — |
| 14 | **Browser bundle / static hosting** | Low | Med | Static output; already builds; wasm served from `/wasm/` | Day 5 | — |
| 15 | **Demo reliability** | Low | High | 10 consecutive runs, network off | Day 6 | — |
| 16 | Upstream pnpm-11 `allowBuilds` drift | — | None | FleetScope already uses the correct location | done | — |

---

## T. Open questions — only what source cannot answer

1. ~~**Is `trunk` installable and does the WASM build work?**~~ **RESOLVED
   during the audit.** `cargo install --locked trunk` → 0.21.14; then
   `bash web/scripts/build-wasm.sh` → `✅ success`, emitting `web_bg.wasm`
   (2.31 MB), `web.js`, `env.js`. No open question remains here.
2. **Which single platform call is the live proof?** Registry
   `version_resolved` is the audit's recommendation — one cheap read, real
   digest, no side effect. Needs confirmation against actual API availability,
   quota, and credentials, which are outside this repository.
3. **Does the target browser for the demo support WebGl2 + File System Access?**
   WebGl2 is required by ratzilla. FSA is not needed (FleetScope compiles the
   transcript in). *(Resolve: test on the actual demo machine, Day 2.)*
4. **Should the generalized `from_facts()` input layer be offered upstream?** A
   product/relationship question, not a code one. Recommended post-hackathon.

Deliberately **not** asked, because the repository answers them: the reuse
strategy, the transcript schema, the ABI shape, the route list, the event type
set, the fixture layout, the licensing obligation, the projector contract.

---

## U. Recommended first implementation slice

> **Slice 0 + Slice 1, in one working session: vendor Zoetrope at
> `077707da679955c0402c39ca992bf56cdc6b0264`, attribute it in the same commit,
> and split `crates/fleet-cockpit-web` out as a wasm32-only crate that builds to
> `apps/web/public/wasm/` — with every one of the three existing test suites
> (182 upstream, 9 Rust, 91 TypeScript) still green.**

Nothing product-visible changes. What changes is that the only unresolved
dependency in the entire repository becomes resolved, and the honest
"not vendored yet" messages in `vendor/README.md`, `THIRD-PARTY-NOTICES.md`,
`docs/decisions/0002-cockpit-renderer-boundary.md`, and `cockpit-adapter.ts` can
start being retired against real code.

It is the right first slice because it is the **highest-risk, lowest-ambiguity**
work in the plan: risk #1 and risk #3 both retire on Day 1, before any FleetScope
data is involved — so if the WASM toolchain is going to fail, it fails while the
fallback still has five days to land.

The end-to-end proof the brief asks for follows immediately in Slices 2–4:

```text
CASE-1042 canonical fixture      [exists, 60 events, blessed hashes]
        ↓
FleetScope projector             [exists, pure, hash-stable]
        ↓
Scenario Compiler                [exists] + zoetropeJsonlAdapter  [Slice 3]
        ↓
vendored Zoetrope browser Cockpit [Slice 0-2]
        ↓
matching evidence state          [Slice 4 — manifest-driven cursor sync]
```

**Do not attempt live platform integration before that chain is green.**

---

## Appendix — Preserve from Zoetrope

Untouched unless a test proves a need:

- `state/timeline.rs` — pacing, `compress_gap` log curve, `fold_at_fraction`,
  `gap_markers`, edge-vs-mode pin/pace logic. *(Exception: the `unread` counter,
  Slice 4, isolated commit.)*
- `state/graph.rs` — incremental sync, `restore_positions`, local placement,
  explicit-only relayout.
- `state/session.rs` — **the entire fold.** Join stores, `resolve_spawn_status`,
  `recompute_liveness`, `recompute_workflow_status`, `end_of_stream`.
- `ui/chips.rs` — the single reconcile pass, `RUN_GAP == CHIP_TTL`, the `seen`
  discriminator. Documented upstream as hard-won; do not touch.
- Camera: Overview / Follow / Manual, `CameraGlide`, "Follow yields to ANY
  interaction".
- Semantic zoom (Card vs Cell), width-gating.
- `transcript.rs` defensive parsing (`#[serde(other)] Unknown`, string-or-array
  content, `is_error` missing = success).
- **The Rust/WASM build boundary** — the workspace `exclude`, the two lockfiles,
  the pinned ratatui tree, `.cargo/config.toml`.
- All 182 tests.

## Appendix — FleetScope-specific gaps

Must be built or generalized (all derived from source, §D/§E):

- `zoetropeJsonlAdapter` — the Claude-shaped renderer adapter *(new)*
- `unread` on `Timeline` *(generalize, ~15 lines)*
- unknown-vs-zero in `ui/nodes.rs` *(generalize, ~10 lines)*
- history-not-live edges in `ui/edges.rs` *(generalize, ~5 lines)*
- `↳ thought` provenance row removal in `ui/panel.rs` *(remove)*
- branding constant in `ui/mod.rs` *(generalize)*
- `crates/fleet-cockpit-web` + the six `fleetscope_*` exports *(new)*
- `cursor-sync.ts` *(new)*
- `packages/incident`, `packages/policy` *(new)*
- Gemini call in `apps/api/src/services/decision-evidence.ts` *(new, optional)*

Already built and **not** gaps, contrary to the brief's assumption: Canonical
Event envelope, Canonicalizer, Case aggregation across Sessions, Catalog, Case
Workspace, Approvals, Audit, Decision Evidence rail, Scenario Compiler skeleton,
the bounded API.
