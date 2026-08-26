# FleetScope patches to vendored source

FleetScope vendors Zoetrope as a **pinned, patched** dependency. It is not
unmodified, and this file is the complete record of what differs. Every entry
states what changed, why a wrapper could not do it, and what was re-run.

> **Wrapper first.** The order of preference is: FleetScope wrapper → adapter →
> DOM evidence → small ABI → *only then* a vendor patch. Most of what FleetScope
> needed from the renderer was achievable without touching it; the list below is
> deliberately short, and each entry says why it could not stay outside.

## Upstream

| | |
|---|---|
| Project | Zoetrope |
| Repository | https://github.com/furkankly/zoetrope |
| Pinned commit | `077707da679955c0402c39ca992bf56cdc6b0264` |
| License | MIT — Copyright (c) 2026 Furkan Kalaycioglu |
| Vendored at | `vendor/zoetrope/` |

The `LICENSE` file is copied verbatim and must never be edited. Upstream git
history is never rewritten.

## What is vendored, and what is not

| Path | Vendored | Why |
|---|---|---|
| `LICENSE`, `README.md` | yes | attribution |
| `Cargo.toml`, `Cargo.lock` | yes | the crate and its pinned dependency graph |
| `src/**` | yes | the library FleetScope depends on |
| `docs/ARCHITECTURE.md` | yes | the fold and timeline semantics FleetScope relies on |
| `wasm-boot/env.js` | yes | **load-bearing.** `wasm32-unknown-unknown` provides no libm intrinsics and no `critical-section` implementation; without these shims the wasm module does not instantiate |
| `wasm-boot/cargo-config.reference.toml` | yes | the wasm32 default-target pattern `crates/fleet-cockpit-web` mirrors |
| `assets/**` | **no** | ~8 MB of demo recordings, GIFs and an OG image FleetScope never renders. The bundled JetBrains Mono TTFs ship with no accompanying OFL-1.1 text, so redistributing them would be a licensing risk for a font FleetScope does not use — `apps/web` uses the browser's own monospace stack |
| `assets/demo.jsonl`, `assets/demo/**` | **no** | Zoetrope's own demo session. `crates/fleet-cockpit-web` compiles in the FleetScope CASE-1042 Case instead |
| `web/` (Starlight site) | **no** | upstream's marketing and docs site. FleetScope's `apps/web` is the product shell |

## Patch 1 — the `render-provenance` feature

**Files:** `vendor/zoetrope/Cargo.toml`, `vendor/zoetrope/src/ui/panel.rs`

**What upstream does.** `render_provenance` in `src/ui/panel.rs` answers "why does
this agent exist" with two rows in the detail panel:

- `↳ prompt` — the triggering user prompt text, and
- `↳ thought` — the assistant's *reasoning* immediately before the spawn
  (`SpawnContext::reasoning`).

For a Claude Code session visualizer that is exactly the right feature. For
FleetScope it is a product violation: FleetScope shows **Decision Evidence** —
inspectable recorded facts — and states plainly that it records no hidden
reasoning and reconstructs none.

**The change.** A new Cargo feature, `render-provenance`, included in `default`.
When it is off, the panel computes and renders neither row.

**Why it is additive rather than a deletion.** Upstream behaviour is bit-for-bit
unchanged: `zoe`, the browser demo, and any other consumer take `default` and
still get both rows. FleetScope already depends on the crate with
`default-features = false` — the same switch that drops the native frontend — so
it needed no new flag and no fork of the panel.

**Why a wrapper could not do it.** The panel is drawn inside `zoetrope::ui::draw`
from state the renderer owns. A wrapper can choose *what data* to hand the
renderer, but not *what the renderer draws with the data it already has*.

**Why it is nevertheless defence in depth, not the control.** The real control is
upstream of the renderer: FleetScope's Scenario Compiler emits no `prompt` field
on a spawn and no `thinking` block anywhere, so `SpawnContext::reasoning` is
always `None` in a FleetScope build and there is nothing to draw. Both the
TypeScript and Rust suites assert that on the compiled artifacts. This patch
exists because a renderer that *can* draw private reasoning is one compiler bug
away from doing so.

**Verification re-run after the patch:**

| Command | Result |
|---|---|
| `cargo test` (default features) | **182 lib + 8 bin passed**, 0 failed |
| `cargo check --no-default-features` | exit 0 |
| `cargo clippy --all-targets -- -D warnings` | exit 0 |
| `cargo clippy --no-default-features -- -D warnings` | exit 0 |
| `cargo fmt --all -- --check` | exit 0 |

## What FleetScope did NOT patch

Recorded so the decisions are not re-litigated:

- **Historical animation honesty.** Upstream's `ui/edges.rs` animates an edge
  while its target is running, regardless of transport, which reads as "something
  is executing right now" even when parked in the past. Fixed at the WRAPPER
  level instead: `crates/fleet-cockpit-web/src/main.rs` skips `tick_animation`,
  `tick_auto_pan` and `tick_camera` while the transport is historical, so the
  animation phase freezes. No vendor change needed.
- **Unknown rendered as zero.** Upstream's `ui/nodes.rs` shows `0 tok` for an
  agent with no recorded usage. Fixed at the COMPILER level: the adapter omits
  `message.usage` entirely when FleetScope observed none, so the renderer has no
  zero to draw. A test asserts it.
- **The Claude transcript parser** (`src/transcript.rs`). Bridged to, never
  modified — the Scenario Compiler speaks its format. Modifying it would strand
  the 182 upstream tests that give the fold its meaning.
- **`SessionModel`, the timeline engine, graph layout, the tool-chip reconcile
  pass, the camera, rataflow.** Untouched.
- **The native feature** (`main.rs`, `tui.rs`, `handler.rs`, `autopilot.rs`,
  `tailer/{live,replay,bytes}.rs`). Excluded automatically by
  `default-features = false`. Not deleted — deleting it would make the upstream
  test suite unrunnable and rebasing harder.

## Rebasing

Keep each patch to a narrow, separately reviewable change with a comment block
naming FleetScope, so `git log`/`git diff` against a future upstream stays
readable. Re-run the full table above after every vendor change.
