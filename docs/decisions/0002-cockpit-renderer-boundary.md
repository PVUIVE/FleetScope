# 0002 — Fleet Cockpit renderer boundary

Status: accepted, with an open dependency · 2026-08-26

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
