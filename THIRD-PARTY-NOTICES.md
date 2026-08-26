# Third-party notices

This file is the single location for third-party copyright and license
attribution. Per product decision **D8**, these notices live in repository
licensing files and do **not** appear in FleetScope product navigation.

## Vendored source

### Zoetrope — the Fleet Cockpit rendering substrate

|                    |                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Project            | **Zoetrope** — "Terminal UI that visualizes Claude Code agent sessions as a live flow graph." |
| Repository         | https://github.com/furkankly/zoetrope                                                         |
| Pinned commit      | `077707da679955c0402c39ca992bf56cdc6b0264`                                                    |
| License            | **MIT** — Copyright (c) 2026 Furkan Kalaycioglu                                               |
| Vendored at        | `vendor/zoetrope/`                                                                            |
| Upstream `LICENSE` | copied verbatim to `vendor/zoetrope/LICENSE`                                                  |

FleetScope's Fleet Cockpit renders the graph, timeline, camera, tool chips and
semantic zoom of this project. FleetScope depends on its **portable core**
(`default-features = false`): the model, timeline, graph projection, UI rendering
and parser, with no async runtime, no terminal backend and no filesystem access.

**FleetScope modifications: yes — a small patchset.** This vendored copy is
**not** unmodified. The complete record is `vendor/VENDOR-PATCHES.md`; in summary:

- **`render-provenance` Cargo feature** (`Cargo.toml`, `src/ui/panel.rs`).
  Additive and default-on, so upstream behaviour is unchanged. With the feature
  off — which is what `default-features = false` gives FleetScope — the detail
  panel renders neither the triggering prompt nor the assistant's reasoning.
  FleetScope shows Decision Evidence and exposes no private model reasoning.

No other source file differs from the pinned commit. Upstream's own test suite
was re-run after the patch and passes unchanged: **182 library tests + 8 binary
tests**, with `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`
and `cargo check --no-default-features` all clean.

**Not redistributed.** Upstream's `assets/` (demo recordings, GIFs, an OG image,
and JetBrains Mono TTFs shipped without accompanying OFL-1.1 text) and its
Starlight documentation site under `web/` are excluded from this repository.
FleetScope renders its own recorded CASE-1042 evidence and uses the browser's own
monospace font stack. See `vendor/VENDOR-PATCHES.md` for the full inclusion table.

## npm and crates.io dependencies

Dependency licenses are recorded in `pnpm-lock.yaml`, `Cargo.lock`,
`vendor/zoetrope/Cargo.lock` and `crates/fleet-cockpit-web/Cargo.lock`. Generate
a report with:

```bash
pnpm licenses list
cargo tree --format '{p} {l}'
cargo tree --manifest-path vendor/zoetrope/Cargo.toml --format '{p} {l}'
```

Notable transitive dependencies reached through Zoetrope: `ratatui`,
`ratatui-core`, `ratatui-widgets`, `rataflow`, `rust-sugiyama`, `chrono`,
`web-time`, `unicode-width` — and, in the browser build only, `ratzilla`,
`beamterm-renderer`, `wasm-bindgen`, `web-sys` and `critical-section`. All are
resolved from crates.io and are not vendored.
