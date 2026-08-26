# 0004 — Cursor mapping goes through a Render Manifest

Status: accepted · 2026-08-26 · supersedes part of [0002](0002-cockpit-renderer-boundary.md)

## Context

With the renderer vendored, the Fleet Cockpit has two positions that must stay in
step: FleetScope's **Event Cursor**, addressed by `caseSequence`, and the
renderer's own **timeline index**.

The obvious bridge is arithmetic:

```text
fraction = caseSequence / lastCaseSequence          ← WRONG
```

It is only correct if every Canonical Event compiles to exactly one renderer
item. Measured on CASE-1042, none of that holds:

| Canonical Event | Renderer entries |
| --------------- | ---------------- |
| `usage.recorded`, `case.milestone_changed` | **0** — business-rail facts with no graph meaning |
| `tool.requested` | **1** |
| any platform decision (`identity.*`, `gateway.*`, `armor.*`, …) | **2** — the request chip and its resolution |
| `identity.denied` carrying a pending call | **3** — the denial chip, its result, and the refusal of the call it terminated |

60 Canonical Events compile to **69** renderer entries. The ratio is therefore
wrong by an amount nothing measures, and the error is silent: the cursor lands
near the right place, and "near" is indistinguishable from "right" by eye.

## Decision

The Scenario Compiler emits a **Render Manifest** alongside the compiled
transcripts. One entry per Canonical Event, recording the renderer range it
actually produced:

```ts
interface RenderManifestEntry {
  eventId: string;
  caseSequence: number;
  rendererEntryStart: number;
  rendererEntryEnd: number;   // start - 1 when the event drew nothing
  rendererEntryCount: number;
  rendererFraction: number;
  domain: RenderDomain;
  outcome: RenderOutcome;
  label: string;
  evidenceEventIds: string[];
}
```

Both directions are lookups:

```text
caseSequence  → manifest → renderer entry range → renderer fraction → seek
renderer index → manifest → the Canonical Event that produced it → Event Cursor
```

Three further rules follow:

1. **The fraction is computed, never read.** Appending to a live Case grows the
   denominator, so a compile-time fraction goes stale the moment the Case does.
   The stored value is a wire convenience; `validate()` asserts the two agree.
2. **An event that drew nothing resolves BACKWARD**, to the last entry that did.
   Resolving forward would move the cursor onto evidence the operator has not
   reached.
3. **`Cockpit::load` refuses a manifest that disagrees with the timeline.** If
   the compiler and the Zoetrope merge ever disagree about how many items a Case
   has, every seek lands in the wrong place — so the load fails loudly instead.

## Who owns what

FleetScope owns `eventCursor`, `caseHighWaterMark` and therefore
`canonicalUnread`. The renderer owns `rendererEntryIndex` and its transport.
`fleetscope_snapshot()` reports renderer units **only** — a test asserts the
serialized snapshot contains no `caseSequence` and no `unread`.

Letting the renderer answer in canonical units would make a rendering decision
authoritative over the audit spine: change how a `gateway.routed` draws, and the
operator's "+3 new events" badge changes with it, having observed nothing new.

## Reason

The manifest records what the compiler actually did, so the mapping is a fact
rather than an estimate. It also carries the semantic outcome, which is what lets
the Decision Evidence rail say "Identity denied" where the graph has to draw the
same error styling it uses for a crash.

## Verification

- `crates/fleet-cockpit/tests/scene.rs` seeks to **every** rendered
  `caseSequence` in the blessed Case and asserts the reverse lookup returns the
  same event.
- A test asserts the forbidden ratio *demonstrably disagrees* — if it ever
  stopped disagreeing the guard would be proving nothing.
- Verified in a real browser: clicking the `armor.blocked` row (`caseSequence`
  15) moves the renderer to entry **14** of 69 (fraction 0.206). The forbidden
  ratio would have said 15/59 = 0.254.

## Tradeoff

The manifest is a third artifact to keep in step with the transcripts. That cost
is paid down by blessing all three together (`pnpm fixtures:bless`) and by having
both the TypeScript suite and the Rust integration tests read the same bytes.
