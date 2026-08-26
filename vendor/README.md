# vendor/

Third-party source vendored into FleetScope.

## Contents

| Directory | Upstream | Pinned | License |
|---|---|---|---|
| `zoetrope/` | https://github.com/furkankly/zoetrope | `077707da679955c0402c39ca992bf56cdc6b0264` | MIT |

Attribution lives in `/THIRD-PARTY-NOTICES.md`. The complete list of FleetScope
modifications lives in `VENDOR-PATCHES.md` beside this file — **read it before
assuming this copy is unmodified. It is not.**

## How Zoetrope is consumed

```text
vendor/zoetrope                 the pinned upstream crate, its own workspace
        │                       (path dependency; NOT a root workspace member)
        │  default-features = false   → portable core: model, timeline, graph,
        │                               UI rendering, parser. No tokio, no
        ▼                               crossterm, no filesystem, no provenance
                                        panel.
crates/fleet-cockpit            root workspace member, HOST-TESTABLE
        │                       Render Manifest · Event Cursor · scene loading
        │                       Its integration tests fold the real compiled
        │                       CASE-1042 through the real Zoetrope engine.
        ▼
crates/fleet-cockpit-web        its OWN workspace, wasm32-only
                                ratzilla + wasm-bindgen + the fleetscope_* ABI
```

Two things make this layout work, and both are load-bearing:

1. **`vendor/zoetrope` is `exclude`d, not a member.** It carries its own
   `[workspace]` table and its own lockfile. Adding it as a member would mean
   deleting that table — a gratuitous upstream edit that makes rebasing harder.
   A path dependency needs no membership.

2. **`crates/fleet-cockpit-web` is `exclude`d too.** `rataflow` gates its
   `ratzilla` `From` impls on `all(feature = "ratzilla", target_arch = "wasm32")`,
   so that crate can only be *compiled* for wasm32, not host-checked. As a member
   it would break `cargo check --workspace` and put two permanent phantom errors
   in every editor. Its `.cargo/config.toml` sets the wasm32 default target so
   `cargo check` needs no `--target`. This mirrors what upstream already does
   with its own `web/wasm`.

`crates/fleet-cockpit` stays a member and stays host-testable, because it depends
only on the portable core. That is what lets `cargo test` prove the renderer
integration on a developer machine rather than in a browser.

## Rules

- Never rewrite upstream history or strip a license header.
- Prefer, in order: FleetScope wrapper → adapter → DOM evidence → small ABI.
  Patch vendored source only when the requirement cannot be met outside it, and
  record it in `VENDOR-PATCHES.md` in the same commit.
- Keep each patch narrow and separately reviewable, with a comment block naming
  FleetScope, so a future rebase can find it.
- Re-run upstream's own suite after every vendor change: `cargo test`,
  `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`, and
  `cargo check --no-default-features`.
- Do not follow upstream past the pinned SHA during the hackathon.
- Notices live in repository licensing files, never in product navigation (D8).
