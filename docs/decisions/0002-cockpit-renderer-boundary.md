# 0002 — Fleet Cockpit renderer boundary

Status: accepted · 2026-08-26 · **open dependency now RESOLVED — see the
amendment at the foot of this file, and [0004](0004-render-manifest-cursor-mapping.md)**

## Context

D8 commits to reusing a pinned MIT-licensed browser/WASM visualization core for
the Fleet Cockpit. The design documents describe its capabilities in detail but
**never name the project**. No upstream source is in the repository.

Two things could not be done honestly: fork an unnamed project, and invent its
transcript schema.

## Decision

1. `crates/fleet-cockpit/` is FleetScope's **own** thin, buildable crate holding
   the browser ABI (`fleetscope_load/append/seek/go_live/snapshot/select`), the
   transcript model, and the Event Cursor. It carries the semantics that must not
   regress — position by event index, appends never moving a historical cursor —
   and tests them today.
2. `vendor/` is reserved for the upstream, with the fork and attribution
   procedure written down in `vendor/README.md`.
3. `packages/scenario-compiler/src/transcript.ts` defines a **FleetScope interim,
   renderer-neutral** transcript. No field is invented on the upstream's behalf.
4. `RendererAdapter` in the same package is the seam where an upstream-specific
   format is produced. Renderer requirements go behind it — never into the
   canonical domain model, the Canonical Event envelope, or a fixture.
5. `apps/web/src/features/cockpit/lib/cockpit-adapter.ts` wraps the WASM ABI so
   no other frontend file touches generated bindings. Absent the module it
   returns a **disabled** adapter that states the reason; it never simulates a
   renderer.

## Reason

The unresolved dependency is isolated to two files and one directory. Everything
else — evidence, projection, fixtures, product surfaces — proceeds now and is
unaffected by which upstream is eventually chosen.

## Tradeoff

The interim transcript will need a second adapter implementation once the
upstream schema is known, and the Cockpit renders nothing until then. That is the
correct cost: the alternative is a fabricated integration that would have to be
unwound.

---

## Amendment — 2026-08-26, the dependency is resolved

The upstream is **Zoetrope** (https://github.com/furkankly/zoetrope), vendored at
`vendor/zoetrope/`, pinned to `077707da679955c0402c39ca992bf56cdc6b0264`, MIT.
Attribution is in `/THIRD-PARTY-NOTICES.md`; the FleetScope patchset is in
`vendor/VENDOR-PATCHES.md`. Five points above change:

**1 → the ABI moved, and grew a manifest-driven seek.** `crates/fleet-cockpit`
is now the host-testable Cockpit CORE: Render Manifest, Event Cursor, scene
loading, and the snapshot contract. The wasm binary and the `fleetscope_*`
exports live in `crates/fleet-cockpit-web`, a wasm32-only crate in its own
workspace — `rataflow` gates its ratzilla impls on `target_arch = "wasm32"`, so
that crate cannot be host-checked and must not be a root workspace member.

`fleetscope_seek_case_sequence(caseSequence)` joins the ABI. It is the correct
path from FleetScope evidence to a renderer position; `fleetscope_seek(fraction)`
remains, but only the scrubber should call it, because there the fraction IS the
user's input.

**2 → `vendor/` is populated**, and the procedure in `vendor/README.md` was
followed with two corrections it did not anticipate: the upstream is `exclude`d
rather than added to `members` (it carries its own `[workspace]` table), and
`crates/fleet-cockpit-web` is excluded for the same reason upstream excludes its
own `web/wasm`.

**3 → the interim transcript is retained, not replaced.** `transcript.ts` and
`interimJsonlAdapter` still exist and are still tested; the Zoetrope adapter is a
SECOND `RendererAdapter` implementation beside them. Nothing that depended on the
interim seam had to change.

**4 → unchanged, and load-bearing.** No renderer requirement reached a Canonical
Event, a domain type or a fixture. What crosses the boundary is a compiled
artifact plus a manifest, never a domain object.

**5 → the disabled adapter is still there and still honest.** It now states that
recorded evidence remains complete in the evidence rail, the Case Workspace and
the Audit view — which is true, and is why a missing renderer degrades the expert
surface rather than the product.

### What the tradeoff actually cost

"A second adapter implementation once the upstream schema is known" — done, and
the interim one survived. "The Cockpit renders nothing until then" — it renders:
`crates/fleet-cockpit/tests/scene.rs` folds the real compiled CASE-1042 through
the real Zoetrope engine on the host, and the graph was verified in a browser.

### What the resolution added that 0002 did not foresee

That `crates/fleet-cockpit` could stay **host-testable while depending on the
renderer**. The audit assumed the whole crate would have to leave the workspace.
It does not: Zoetrope's portable core (`default-features = false`) builds on the
host, and only `ratzilla` is wasm-only. Splitting on that line — rather than on
"anything that touches the renderer" — is what makes the integration provable in
`cargo test` instead of in a browser.
