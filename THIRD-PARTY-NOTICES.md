# Third-party notices

This file is the single location for third-party copyright and license
attribution. Per product decision **D8**, these notices live in repository
licensing files and do **not** appear in FleetScope product navigation.

## Vendored source

FleetScope plans to reuse a pinned, MIT-licensed browser/WASM visualization core
as the rendering substrate for the Fleet Cockpit (see
`docs/design/budget-demo.md`, Slice 0).

**Status: not yet vendored.** No upstream source is present in this repository.
See `vendor/README.md` for the fork procedure and the attribution requirements
that MUST be satisfied _in the same commit_ that introduces the upstream code.

When the fork lands, add here:

- upstream project name and canonical URL;
- the exact pinned commit SHA;
- the verbatim upstream `LICENSE` file, copied to `vendor/<upstream>/LICENSE`;
- a statement of what FleetScope modified.

## npm and crates.io dependencies

Dependency licenses are recorded in `pnpm-lock.yaml` and `Cargo.lock`. Generate
a report with `pnpm licenses list` and `cargo tree --format '{p} {l}'`.
