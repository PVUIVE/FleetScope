# vendor/

Third-party source vendored into FleetScope. **Currently empty.**

## The pending Fleet Cockpit upstream

`docs/design/budget-demo.md` (decision D8) commits to reusing a pinned,
MIT-licensed browser/WASM visualization core as the Fleet Cockpit's rendering
substrate. The documentation describes it — graph, timeline, time travel, camera,
tool chips, WebAssembly, upload, live append, ~14K lines of Rust, 182 library
tests — but **never names the project or its URL**. It is therefore not vendored,
and nothing in this repository claims otherwise.

`crates/fleet-cockpit/` is FleetScope's own thin core: it holds the browser ABI,
the transcript model, and the Event Cursor so that contract exists and is tested
before the fork lands.

## Fork procedure (Slice 0)

Do all of this in ONE commit, so attribution can never lag the code:

1. Identify the upstream project and record its canonical URL.
2. Vendor it at a pinned commit under `vendor/<upstream-name>/`, preserving its
   `LICENSE` file verbatim and its git history where practical
   (`git subtree add --prefix vendor/<name> <url> <sha>`).
3. Add the project name, URL, pinned SHA, and a description of FleetScope's
   modifications to `/THIRD-PARTY-NOTICES.md`.
4. Add `vendor/<name>` to the `Cargo.toml` workspace members.
5. Run its own test suite unchanged and record the result.
6. Make `crates/fleet-cockpit` depend on it and re-implement the ABI in
   `crates/fleet-cockpit/src/abi.rs` over the real renderer.
7. Implement `RendererAdapter` in `packages/scenario-compiler/src/renderer-adapter.ts`
   against the upstream's actual transcript schema.

## Rules

- Never rewrite upstream history or strip a license header.
- Keep FleetScope changes to vendored code in isolated commits so upstream can be
  rebased later.
- Notices live in repository licensing files, never in product navigation (D8).
