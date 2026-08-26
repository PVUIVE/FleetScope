# FleetScope end-to-end implementation report

Date: 2026-08-26 · Author: technical lead
Scope: from the post-audit repository state to the complete recorded MVP.

Companion documents: the audit and plan that preceded this
(`docs/plans/zoetrope-audit-and-implementation-plan.md`, now annotated with where
it was wrong), and ADRs [0004](../decisions/0004-render-manifest-cursor-mapping.md)
and [0005](../decisions/0005-redaction-boundaries.md), which record the two
decisions that changed most.

Every command in this report was executed. Counts are copied from real output.

---

## A. Executive status

| Capability | Status | Note |
| --- | --- | --- |
| Zoetrope vendored, pinned, attributed | **IMPLEMENTED** | `077707da…`, MIT, patched and documented |
| Upstream test suite still green | **IMPLEMENTED** | 182 lib + 8 bin, unchanged after two patches |
| Rust/WASM workspace split | **IMPLEMENTED** | host-testable core + wasm32-only shell |
| WASM bundle builds | **IMPLEMENTED** | 1.9 MB, `trunk` + wasm-opt |
| `/cockpit/CASE-1042` renders the real graph | **IMPLEMENTED** | verified in Chrome, screenshot in the record below |
| Canonicalizer: validate, redact, dedup, order | **IMPLEMENTED** | new package; reproduces the blessed Case from an adversarial arrival order |
| Deterministic Projector + state hash | **IMPLEMENTED** | pre-existing; hash unchanged (`cb99db39…`) |
| Scenario Compiler → Zoetrope | **IMPLEMENTED** | second `RendererAdapter`; the interim one survives |
| Render Manifest + cursor mapping | **IMPLEMENTED** | manifest lookup, both directions, browser-verified |
| Canonical unread owned by FleetScope | **IMPLEMENTED** | renderer snapshot carries no canonical unit |
| Incident Detector | **IMPLEMENTED** | 4 classes, pure, deterministic |
| Policy Engine | **IMPLEMENTED** | versioned, caps downward, advice is inert |
| Warden Intervention lifecycle | **IMPLEMENTED** | at-most-once, retry = new id, Runtime-authoritative |
| Historical replay purity | **IMPLEMENTED** | zero Control Adapter calls across every prefix |
| Catalog · Cases · Approvals · Cockpit · Audit | **IMPLEMENTED** | all six routes, no horizontal overflow |
| Audit evidence export | **IMPLEMENTED** | self-verifying, honestly labelled |
| Recorded mode with `LIVE_MODE=false` | **IMPLEMENTED** | 10/10 cold runs byte-identical |
| Static/offline operation | **IMPLEMENTED, with a stated limit** | a loaded page makes **zero** requests; navigation needs the static host |
| Bounded live proof | **PARTIAL — implemented, never executed** | full path built and tested against an injected `fetch`. **No live call has been made. USD 0.00 spent.** |
| Live 3-run reliability | **NOT DONE** | requires a credential and spend; recorded mode is the demo |
| Second Case fixture (alternate branches) | **NOT DONE** | see §N |

---

## B. Final architecture

```text
                        Source Events  (duplicated · out of order · untrusted)
                                │
                                ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ CANONICALIZER            packages/canonicalizer                  │
   │   schema validation → sensitive-field classification →           │
   │   REDACTION / DIGEST → dedup(dedupeKey) → deterministic order →  │
   │   caseSequence + sessionSequence assignment                      │
   │   reads no clock, no network, no filesystem                      │
   └──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                        Canonical Events  (immutable · schema-versioned)
                                │
        ┌───────────────────────┼────────────────────────┬───────────────────┐
        ▼                       ▼                        ▼                   ▼
 ┌─────────────┐        ┌───────────────┐       ┌────────────────┐   ┌──────────────┐
 │ PROJECTOR   │        │ WARDEN        │       │ SCENARIO       │   │ AUDIT EXPORT │
 │ pure ·      │        │ detector →    │       │ COMPILER       │   │ + integrity  │
 │ versioned   │        │ policy →      │       │                │   │   manifest   │
 │ → state     │        │ intervention  │       │ → transcripts  │   └──────────────┘
 │   hash      │        │ → ControlAdpt │       │ → RENDER       │
 └─────────────┘        └───────────────┘       │   MANIFEST     │
        │                                       └────────────────┘
        ▼                                               │
 Observable Case State                                  ▼
        │                                  ┌──────────────────────────┐
        ├── Agent Catalog                  │ crates/fleet-cockpit     │
        ├── Case Workspace                 │ HOST-TESTABLE            │
        ├── Approvals                      │ manifest · cursor · scene│
        ├── Evidence Rail                  └──────────────────────────┘
        └── Audit                                       │
                                                        ▼
                                           ┌──────────────────────────┐
                                           │ crates/fleet-cockpit-web │
                                           │ wasm32 only · own wkspc  │
                                           │ ratzilla · fleetscope_*  │
                                           └──────────────────────────┘
                                                        │
                                                        ▼
                                              vendor/zoetrope
                                              (portable core, patched)

   FleetScope owns:  eventCursor · caseHighWaterMark · canonicalUnread
   Renderer owns:    rendererEntryIndex · rendererEntryCount · transport
   The Render Manifest is the ONLY bridge, in both directions.
```

Optional live path:

```text
Astro UI → bounded API (allowlisted step, never a prompt) → ONE Gemini call
        → schema validation → Source Events → THE CANONICALIZER ABOVE
        → projector · compiler append · fleetscope_append
```

---

## C. Repository changes

### New

| Path | What |
| --- | --- |
| `vendor/zoetrope/**` | the pinned renderer (src, manifests, LICENSE, ARCHITECTURE.md, wasm-boot shims) |
| `vendor/VENDOR-PATCHES.md` | the complete record of FleetScope's changes to it |
| `packages/canonicalizer/**` | the primary redaction boundary, dedup, ordering, `canonicalizeAppend` |
| `packages/warden/**` | detector, policy engine, intervention lifecycle, Control Adapter port |
| `packages/scenario-compiler/src/render-manifest.ts` | the Render Manifest model and its lookups |
| `packages/scenario-compiler/src/zoetrope/{wire,adapter}.ts` | the Claude-shaped wire builders and the mapping |
| `packages/projector/src/audit-export.ts` | the Case evidence export and its verifier |
| `packages/domain/src/cursor.ts` | FleetScope's Event Cursor, high-water mark and canonical unread |
| `crates/fleet-cockpit/src/{manifest,scene}.rs` | the Rust manifest mirror and the Zoetrope scene loader |
| `crates/fleet-cockpit-web/**` | the wasm32-only browser shell and the `fleetscope_*` ABI |
| `apps/web/src/components/{DecisionEvidence,UnknownOr}.astro` | the evidence drawer and the unknown-not-zero primitive |
| `apps/web/src/lib/{case-view,approvals}.ts` | the six Case questions and approval binding |
| `apps/api/src/live/{gemini,evidence}.ts` | the bounded call and its evidence shapes |
| `packages/fixtures/cases/CASE-1042/source-events.jsonl` | the Source Events, in an adversarial arrival order |
| `packages/fixtures/cases/CASE-1042/renderer/**` | blessed compiled transcripts + manifest, read by BOTH suites |
| `scripts/recorded-run.ts`, `scripts/recorded-reliability.ts` | one complete run; ten cold runs compared |
| `docs/decisions/000{4,5}-*.md` | the two ADRs above |

### Modified

`Cargo.toml` (workspace members and exclusions), `crates/fleet-cockpit/{Cargo.toml,src/lib.rs}`,
`packages/event-schema/src/source-event.ts` (optional `ingestionTime`),
`packages/domain/src/agent.ts`, `packages/platform-adapters/src/mode.ts` (+`unavailable`),
`apps/web/src/features/cockpit/{CockpitMount.astro,lib/cockpit-adapter.ts}`,
all six Astro routes, `apps/web/src/styles/global.css`, `apps/api/src/{app,routes/live}.ts`,
`packages/shared/src/env.ts`, `scripts/{build-wasm.sh,smoke.sh,bless-fixtures.ts}`,
`README.md`, `docs/architecture.md`, ADRs 0002 and 0003, `THIRD-PARTY-NOTICES.md`,
`vendor/README.md`, `.env.example`, `eslint.config.js`, `.prettierignore`.

### Deleted

`crates/fleet-cockpit/src/abi.rs`, `crates/fleet-cockpit/{Trunk.toml,index.html}` —
all moved into `crates/fleet-cockpit-web`.

---

## D. Zoetrope integration

| | |
| --- | --- |
| Upstream | https://github.com/furkankly/zoetrope |
| Pinned SHA | `077707da679955c0402c39ca992bf56cdc6b0264` (verified: upstream HEAD at clone time) |
| License | MIT, © 2026 Furkan Kalaycioglu, copied verbatim |
| Dependency | `default-features = false` — the portable core; no tokio, no crossterm, no filesystem |
| Not redistributed | `assets/**` (~8 MB of recordings, plus JetBrains Mono TTFs shipped with no OFL text), the Starlight site under `web/` |

### Patchset — two patches, both narrow, both documented

1. **`render-provenance` Cargo feature** (`Cargo.toml`, `src/ui/panel.rs`).
   Upstream's detail panel renders `↳ prompt` and `↳ thought`. Additive and
   default-on, so upstream is unchanged; FleetScope's `default-features = false`
   turns it off. Defence in depth — the compiler emits neither field, so there is
   nothing to draw.
2. **Product naming** (`src/ui/brand.rs`, `src/ui/mod.rs`, `src/ui/panel.rs`,
   `src/state/graph.rs`). Upstream hard-codes the `zoetrope` wordmark and titles
   the main node `claude`. Correct for a Claude Code visualizer; wrong on a
   governed enterprise audit surface. `set_branding()` is called once at scene
   load; the defaults are upstream's own.

**What was NOT patched, and why.** Historical animation honesty and
unknown-rendered-as-zero were both classified by the audit as needing core
changes. Both were solved at the wrapper level: the render loop skips
`tick_animation` / `tick_auto_pan` / `tick_camera` while the transport is
historical, and the compiler omits `message.usage` entirely when no usage was
recorded, so the renderer has no zero to draw.

### ABI exports (`crates/fleet-cockpit-web`)

```text
fleetscope_load(main, subagentsJson, manifestJson)
fleetscope_append(mainTail, subagentsJson, manifestEntriesJson)
fleetscope_seek(fraction)                    — the scrubber's unit only
fleetscope_seek_case_sequence(caseSequence)  — the correct path; u32, see below
fleetscope_go_live()
fleetscope_select(nodeId)
fleetscope_snapshot()          → renderer units only
fleetscope_current_event()     → the manifest entry under the cursor
```

`fleetscope_seek_case_sequence` takes **`u32`, not `u64`**. wasm-bindgen marshals
a `u64` as a JavaScript BigInt, so `fleetscope_seek_case_sequence(15)` throws
"Cannot convert 15 to a BigInt" — at the call site, silently failing the seek
while the DOM cursor moved anyway. This was found by driving a real browser, not
by any test; see §K.

### WASM build

```text
trunk build (release, wasm-opt -Oz)  →  apps/web/public/wasm/
  cockpit_bg.wasm   1,905,644 B
  cockpit.js           56,949 B
  env.js                  889 B   ← load-bearing libm + critical-section shims
```

---

## E. Canonical pipeline

```text
Source Event  →  schema validation (closed 42-type set; unknown type REJECTED)
              →  sensitive-field classification (by field name AND by value shape)
              →  REDACTION + payloadDigest (only when something was redacted)
              →  dedup by dedupeKey, first-in-CANONICAL-order wins
              →  total order by (sourceTime, dedupeKey) — arrival-independent
              →  caseSequence 0..n-1, sessionSequence per Session
              →  Canonical Event
              →  Projector (pure) → Observable Case State → SHA-256 state hash
```

Proved on the real Case, not on a synthetic one:
`packages/fixtures/cases/CASE-1042/source-events.jsonl` holds the 60 Source
Events **reversed, with one delivered twice**. Canonicalizing it reproduces the
blessed canonical stream byte for byte, and projecting the result reproduces the
blessed terminal hash `cb99db39d200…`. Three different arrival orders, and a
stream tripled end to end, all give the same output.

`eventId` is derived from `(caseId, dedupeKey)` — never from an arrival index —
so the same logical fact carries the same id however often it arrives. A recorded
fixture may pin its blessed ids through `eventIdFor`; live ingest never does.

---

## F. Renderer pipeline

```text
Canonical Events
      ↓  compileZoetropeScene()          deterministic; order-independent
      ├── main.jsonl                     Claude-shaped, the format Zoetrope parses
      ├── subagents.json                 meta + transcript per delegated agent
      └── render-manifest.json           one entry per Canonical Event
      ↓  blessed by `pnpm fixtures:bless`
      ↓  read by BOTH the TypeScript suite and crates/fleet-cockpit tests
      ↓  compiled into the wasm binary (include_str!) for the offline demo
Zoetrope replay_from_session → Timeline → SessionModel → Flow → WebGl2
```

**Speaking Claude's JSONL is the strategy, not a compromise.** It lets FleetScope
reuse the fold, the timeline engine and the 182 upstream tests unmodified. The
alternative — forking the parser — is the one thing vendoring exists to avoid.

**Emission order is timeline order, by construction.** Zoetrope sorts timeline
items by `(timestamp, meta-before-entry)`. Several Canonical Events share a
`sourceTime`, and subagent lines live in a different file, so a plain copy would
leave the merge order to sort stability across files. Each emitted line is
stamped `sourceTime + globalIndex nanoseconds` instead: strictly increasing, at
most 999,999 ns of offset, so no line crosses into the next millisecond and the
multi-week gap structure the scrubber draws is untouched. A subagent's `meta` is
emitted immediately before its first entry, which is exactly where Zoetrope dates
and sorts it. **This is asserted, not assumed:** `Cockpit::load` refuses a
manifest whose count disagrees with what the timeline actually folded.

Measured on CASE-1042: **60 Canonical Events → 69 renderer entries**, 54 main
lines + 1 meta + 14 subagent lines, 1 delegated agent.

---

## G. Cursor correctness

**The mapping is a Render Manifest lookup. It is never `caseSequence / lastCaseSequence`.**

Why the ratio is wrong, measured:

| Renderer entries produced | Count of events | Examples |
| ---: | ---: | --- |
| 0 | 8 | `usage.recorded`, `case.milestone_changed` |
| 1 | 36 | `tool.requested`, `runtime.started` |
| 2 | 15 | every platform decision: chip + resolution |
| 3 | 1 | `identity.denied` that also terminates a pending call |

Both directions:

```text
DOM marker → caseSequence → manifest → rendererEntryStart → fraction → seek
snapshot → rendererEntryIndex → manifest → the Canonical Event → Event Cursor
```

Three rules that fall out of it, all tested:

- the fraction is **computed from the current total**, never read from the entry —
  an append grows the denominator;
- an event that drew nothing resolves **backward** to the last one that did,
  never forward onto evidence the operator has not reached;
- `Cockpit::load` **refuses** a manifest that disagrees with the timeline.

### Browser-verified

Clicking the `armor.blocked` evidence row (`caseSequence` 15) on the live page:

```json
{"rendererEntryIndex":14,"rendererEntryCount":69,"atEdge":false,"transport":"history"}
{"eventId":"evt-0016","caseSequence":15,"rendererEntryStart":14,"rendererEntryEnd":15,
 "rendererEntryCount":2,"rendererFraction":0.2058823529411765,
 "domain":"armor","outcome":"blocked","label":"Armor blocked · prompt_injection"}
DOM cursor 15 · "Historical · recorded evidence, nothing is executing" · "+44 new"
```

14/68 = **0.2059**. The forbidden ratio would have said 15/59 = **0.2542** — a
drift of nearly four renderer entries, on an event whose whole point is that it
is a security control.

Return to live restored `atEdge: true`, `rendererEntryIndex: 68`, DOM cursor 59,
unread cleared.

**The contract is "lands within the event's range", not "lands on its first
entry".** Zoetrope's `fold_at_fraction` maps a fraction over `[floor, len]` — the
timeline pins a leading start clump — so a seek can land on any index inside the
range the event produced. Seeking to `caseSequence` 21 (`gateway.routed`, range
24–25) lands on **25**, and `fleetscope_current_event()` still returns
`evt-0022`. That is the property that matters, and it is asserted for **every**
rendered event in the blessed Case by
`seeking_to_a_case_sequence_lands_on_the_entry_that_event_produced`. Asserting
the stronger "lands exactly on `rendererEntryStart`" would be asserting an
implementation detail of the vendored scrubber, which FleetScope does not own.

### Canonical unread

FleetScope's. `canonicalUnread` counts accepted Canonical Events after the cursor
— **counted, not subtracted**, because a Case whose sequences are dense today may
not be tomorrow. A test asserts the serialized wasm snapshot contains no
`caseSequence`, no `unread`, no `eventId` and no `highWater`.

---

## H. Security findings and fixes

| Concern | Where it is fixed | Proof |
| --- | --- | --- |
| A secret reaching persistence | Canonicalizer, before the Canonical Event exists | injected key absent from the accepted event; digest present |
| A secret under an unremarkable key | value-shape rules (bearer, PEM, `AIza…`, `sk-`/`ghp_`/`xoxb-`, home paths) | `note: "use Bearer …"` redacted |
| A sensitive subtree | field rule redacts the whole subtree, not just string leaves | `credentials: {user, password}` → one marker |
| Prompt / reasoning reaching a renderer | compiler emits neither field; vendored panel patch as backstop | compiled artifacts contain no `"thinking"`, `"prompt"`, `"reasoning"`, `chain_of_thought` |
| A leak detector becoming the leak | `scanForSensitiveMaterial` returns rule names, never matched text | asserted |
| A model response echoed into a log | validation failures name FIELDS only | asserted with a key-shaped payload |
| A credential in a URL | it travels in `x-goog-api-key` | asserted |
| A config error printing a secret | messages name the VARIABLE | asserted |
| Blocked input used downstream | projector AND compiler both check, both **record** rather than hide | a synthetic `memory.written` citing a blocked input produces a violation; the golden Case produces none |
| Identity denial with a downstream ERP call | no `tool.succeeded` exists for the denied call | asserted |
| Gateway denial with a child spawn | no `agent.spawned` after the denial | asserted |

**Semantic distinctness.** `sanitized` and `flagged` are SUCCESSES with a
finding. `denied` is an authorization or routing decision. `blocked` is a
screening refusal. `failed` is an execution failure. The renderer draws the last
three with the same error styling because Zoetrope has no `denied` state — but
the manifest keeps them apart and the evidence rail reads the manifest, so it
says "Identity denied", never "Tool failed". A test asserts `failed` appears
**only** in the `tool` domain, and that a `sanitized` screen emits no
`"is_error":true`.

---

## I. Platform capability truth table

Source of truth: `packages/platform-adapters/src/capability-truth.ts`, rendered in
the Audit view.

| Capability | Mode | What actually exists | What the evidence supports |
| --- | --- | --- | --- |
| Agent Registry | `recorded` | replayed version metadata, approval state, digest | the Case is bound to the exact version recorded at launch; FleetScope did not resolve it live |
| Agent Runtime | `recorded` | replayed start / wait / resume / control / terminal result | the Runtime results shown are the ones recorded; no live wait, resume or control occurred |
| Memory Bank | `recorded` | replayed writes, recalls, rejections with provenance | each record names the Canonical Event it came from |
| Agent Identity | `synthetic` | FleetScope-local enforcement against a synthetic ERP | the allow/deny **ordering** is real and enforced; the identity provider is not |
| Agent Gateway | `synthetic` | FleetScope-local route policy | the delegation **ordering** is real and enforced; the gateway service is not |
| Model Armor | `synthetic` | FleetScope-local screening policy | the screening **ordering** is real and enforced; the screening engine is not |
| Agent Observability | `recorded` | sums of recorded usage events | totals cover recorded usage only; absent values render unknown, never zero |

No vendor response was ever fabricated. `unavailable` was added as a fourth mode
so a boundary with nothing behind it can say so.

---

## J. Warden

**Detector** (`repeated_tool_failure`, `no_progress_loop`, `usage_threshold_breach`,
`context_drift`). Pure and deterministic — same prefix, same candidates, and
arrival order is not an input. A test greps its source for `Date.now`,
`Math.random`, `fetch(`, `node:fs` and `ControlAdapter`. Incident ids derive from
`(caseId, detectorId, signature, triggeringEventId)`. Error class is part of the
failure signature: three timeouts are one systematic fault; a timeout, a 404 and
a rate-limit are three, and pointing one recovery at the last of them would aim
at the wrong cause. `context_drift` is advisory and can never reach an acting
disposition — a drift detector cannot distinguish a successfully defended attack
from a partially successful one.

**Policy** (`warden-policy@1.2.0`). Exactly one disposition. Computed as the
strongest thing policy allows, **capped downward** by the incident class and the
side-effect class; written the other way round, a missing rule would fail OPEN.
An externally visible write can never reach `auto_act`. The attempt budget is a
hard stop that escalates rather than retrying.

**Model advice is inert.** It is validated and recorded, and
`adviceInfluencedDisposition` is **always false**. A test feeds well-formed advice
suggesting an allowlisted retry into a `context_drift` incident and asserts the
disposition stays `observe`. An unallowlisted suggestion is rejected with the
rejection recorded.

**Intervention.** `proposed → authorized|rejected → requested → acknowledged →
succeeded|failed|timed_out`. An illegal transition is refused and named, never
coerced. `succeeded` requires an observed `applied`; an unobservable result is
`timed_out`. `Warden.execute` reserves the id **before** calling out, so a crash
between request and acknowledgement cannot permit a second real request. A retry
is a new Intervention: the id derives from the attempt number, so the rule is
enforced by the id scheme.

**Replay purity — the load-bearing test.** Reconstructing every prefix of a Case
that *contains* a completed Intervention, with a recording Control Adapter in
hand: **zero requests, zero observations**. The lifecycle is fully visible in the
reconstructed state (`proposed` at #31, `authorized` #32, `requested` #33,
`acknowledged` #34, `succeeded` #36) — zero execution does not mean zero
visibility; it simply is not re-performed.

---

## K. Tests

All commands executed on this machine.

```text
pnpm test
  Test Files  14 passed (14)
       Tests  234 passed (234)
```

| File | Tests |
| --- | ---: |
| `packages/warden/tests/warden.test.ts` | 41 |
| `packages/scenario-compiler/tests/zoetrope-adapter.test.ts` | 38 |
| `packages/canonicalizer/tests/canonicalize.test.ts` | 20 |
| `apps/api/tests/live.test.ts` | 19 |
| `packages/fixtures/tests/case-1042.test.ts` | 17 |
| `packages/event-schema/tests/canonical-event.test.ts` | 16 |
| `apps/api/tests/app.test.ts` | 13 |
| `packages/domain/tests/cursor.test.ts` | 12 |
| `packages/fixtures/tests/canonicalization.test.ts` | 12 |
| `packages/scenario-compiler/tests/compile.test.ts` | 11 |
| `packages/platform-adapters/tests/mode.test.ts` | 11 |
| `packages/shared/tests/env.test.ts` | 9 |
| `packages/projector/tests/determinism.test.ts` | 8 |
| `packages/shared/tests/canonical-json.test.ts` | 7 |

```text
cargo test                       (FleetScope)
  lib          9 passed
  cursor.rs   12 passed
  scene.rs    23 passed
  transcript.rs 9 passed          → 53 total, 0 failed

cargo test --manifest-path vendor/zoetrope/Cargo.toml
  lib        182 passed
  bin          8 passed            → 190 total, 0 failed  (unchanged by both patches)
```

Baseline for comparison: 91 TypeScript tests / 21 FleetScope Rust tests.
**Now 234 / 53.** Upstream's 190 are untouched.

```text
pnpm smoke
  ══ workspace install            PASS
  ══ prettier                     PASS
  ══ eslint                       PASS
  ══ typescript typecheck         PASS
  ══ unit + replay tests          PASS
  ══ astro static build           PASS
  ══ cargo fmt                    PASS
  ══ cargo clippy                 PASS      (-D warnings)
  ══ cargo test                   PASS
  ══ vendor: cargo test           PASS
  ══ vendor: portable core        PASS      (--no-default-features)
  ══ vendor: cargo fmt            PASS
  ══ vendor: cargo clippy         PASS      (-D warnings)
  ══ cockpit-web: cargo check     PASS      (--target wasm32-unknown-unknown)
  ══ cockpit-web: cargo fmt       PASS
  ══ recorded Case, one run       PASS
  ══ wasm/trunk build             PASS
  PASS 17   FAIL 0   SKIP 0
```

### What only the browser caught

Two defects survived every test above and were found by driving Chrome:

1. **`u64` in the ABI.** `fleetscope_seek_case_sequence(15)` threw "Cannot convert
   15 to a BigInt". The DOM cursor moved, the transport said Historical, the
   unread count was right — and the graph did not move. A passing-looking failure.
   Fixed by taking `u32`.
2. **Horizontal page overflow.** A 64-hex stream revision in a `max-content 1fr`
   grid set the column's intrinsic width and gave the body a horizontal
   scrollbar, which the accessibility requirement forbids. Fixed with
   `overflow-wrap: anywhere` and `min-width: 0` on grid items.

Both are recorded here because "the tests passed" would have been a true and
misleading statement about either.

---

## L. Recorded reliability — 10 consecutive cold runs

Each run is a **fresh process**, so agreement is evidence about the pipeline
rather than about one process's cached state. Every reproducible field is
compared against run 1; a single disagreement fails the harness.

```text
pnpm reliability

run  1 PASS  events=60 renderer=69 incidents=3 intervention=succeeded replay-control-calls=0 warden-control-calls=2 audit=verified hash=cb99db39d200 473ms
run  2 PASS  … 483ms
run  3 PASS  … 468ms
run  4 PASS  … 445ms
run  5 PASS  … 441ms
run  6 PASS  … 448ms
run  7 PASS  … 476ms
run  8 PASS  … 476ms
run  9 PASS  … 515ms
run 10 PASS  … 454ms

fixture version        1.0.0
stream revision        sha256:33660fc0cfaef00cfb24167d9cb55a891ab406c2d22e617db299a1274d188896
projector version      1.0.0
policy version         warden-policy@1.2.0
terminal state hash    cb99db39d2006718578741775950fb639d160bf726997ae51c4785c4b759735a
canonical events       60
renderer entries       69
compiled scene digest  sha256:104bc376f6b3b701b92251485a8ee3ec492fda1ed993908309a827897c708ba3
audit export digest    sha256:57b9de71d04e05a56a55a9442f176c49d42d980b8dbda5f4eeccff595bf9b596
intervention result    succeeded
replay control calls   0 (historical replay MUST be zero)
warden control calls   2 (one request + one observe: at-most-once)

10/10 runs passed
```

Every run covers: canonicalization from the adversarial arrival order, blessed
stream equality, terminal and every prefix hash, replay purity, detection, policy,
the full Intervention lifecycle including redelivery, renderer compilation,
manifest validation, cursor round-trips, and audit-export self-verification.

---

## M. Live reliability

**Not performed. USD 0.00 spent.**

The bounded path is implemented and covered by 19 tests, all against an injected
`fetch` that never leaves the process — which is what lets it run in CI on every
commit for nothing. What is proven without spending: the guardrails
(`temperature: 0`, `maxOutputTokens: 300`, `candidateCount: 1`, `responseSchema`,
one timeout, **no retry**), the credential in a header rather than a URL, the
per-Case call budget enforced *before* the call, schema rejection of prose and of
an out-of-range confidence, and the full fallback path.

What is NOT proven: that a real Gemini endpoint returns a schema-conforming
response for these prompts, and the 3-of-3 reliability run
`docs/plans/demo-validation.md` asks for. Both need a credential and spend.

**Recorded mode is the official demo path** and is unaffected. Live mode is off
by default and fails closed.

---

## N. Known limitations

Stated plainly, because a demo that hides these is the failure mode the product
exists to prevent.

- **The ERP and Logistics systems are synthetic.** No real vendor system was
  contacted. The *ordering* of the controls around them is real and enforced.
- **Runtime wait and resume are recorded**, not observed. FleetScope controlled
  no live session.
- **The multi-week span is a simulated day boundary** between Runtime Sessions —
  a separate invocation in the recorded scenario, not elapsed real time. The
  Cockpit's own status bar shows Zoetrope's content-time duration, which is
  derived from the recorded timestamps; the FleetScope surfaces say "Simulated
  Day 12".
- **Identity, Gateway and Model Armor are `synthetic`**: FleetScope-local policy,
  no external service.
- **The integrity manifest is not cryptographic non-repudiation.** It is
  application-level append-only evidence with a content digest. There is no
  signing key, no trusted timestamp and no write-once medium, so a party who
  controls the export controls the digest. The export says so in its own
  `notGuaranteed` field.
- **Offline has a boundary.** A loaded page makes **zero** network requests —
  measured, not asserted. Navigating to a *different* route fetches that route's
  HTML; with the network truly down, navigation fails. There is no service
  worker, deliberately: adding one for a hackathon demo is infrastructure the
  brief rules out. What the demo actually needs — one page, fully interactive,
  with no backend — works.
- **No production IAM, no multi-tenancy, no persistence layer.** The per-Case
  live call counter is in-memory and resets on restart, which is documented in
  the code rather than hidden.
- **One Case fixture.** `armor.sanitized`, `agent.failed`, `runtime.failed` and
  the `intervention.rejected/failed/timed_out` branches are covered by unit tests
  with synthetic events, not by a second recorded Case. A `CASE-1043` carrying a
  failed-recovery branch is the obvious next fixture; it was cut in favour of
  keeping CASE-1042's blessed sequence untouched.
- **Renderer approximations.** Zoetrope has no `denied` state, so denials and
  blocks draw with its error styling. The distinction survives in the manifest
  and in the evidence rail, which is where an auditor reads it.
- **Accessibility verified at 1280×720 and 1200×762**, both without horizontal
  overflow; the automation harness would not open a 1440-wide window. The layout
  is fluid with one breakpoint at 1180px, so 1440 renders the same two-column
  layout with wider columns.

---

## O. Demo instructions

```bash
# ── Setup ──────────────────────────────────────────────────────────────────
corepack enable
pnpm install
rustup target add wasm32-unknown-unknown
cargo install --locked trunk          # only needed to rebuild the wasm bundle

# ── Verify everything ──────────────────────────────────────────────────────
pnpm smoke                            # 17 steps: TS, Rust, vendored renderer, wasm
pnpm reliability                      # 10 cold Recorded Case runs

# ── Run it ─────────────────────────────────────────────────────────────────
pnpm build:wasm                       # → apps/web/public/wasm/
pnpm dev                              # http://localhost:4321 → /cases

# ── Or serve the static build, which is what the demo ships ────────────────
pnpm build:web
npx serve apps/web/dist               # any static host with correct MIME types;
                                      # .wasm MUST be served as application/wasm
```

`LIVE_MODE=false` is the default and needs no `.env`, no cloud project and no
credential.

### The demo journey

```text
/catalog              Vendor Onboarding Orchestrator v1.4 · Approved · risk high
                      capabilities, tools, protected systems, allowed callers
   ↓ Start governed case
/cases/CASE-1042      milestone rail · the six questions, each with its evidence id
                      Simulated Day 12 · trusted context with provenance
                      recent activity · replay disclosure
   ↓
/approvals            one approval, bound to action + target + parameters +
                      evidence prefix + expiry + approver; the binding fingerprint
                      is shown, and a change to any part invalidates it
   ↓
/cockpit/CASE-1042    the Zoetrope graph: orchestrator + delegated Logistics Agent,
                      tool chips, event-indexed scrubber with gap and failure markers
                      click any evidence row  → the graph seeks there (manifest lookup)
                      transport reads Historical, "nothing is executing"
                      "+N new events" · Return to live
   ↓
/audit/CASE-1042      stream revision · projector version · state hash ·
                      capability truth table · memory provenance ·
                      intervention lifecycle · policy decisions ·
                      known evidence gaps · full canonical log ·
                      Download Case evidence export (JSON, self-verifying)
```

### Optional live proof

```bash
export LIVE_MODE=true
export GEMINI_MODEL=gemini-2.5-flash
export GEMINI_API_KEY=…               # never commit this
pnpm dev:api                          # :8080

curl -sX POST localhost:8080/live/decision \
  -H 'content-type: application/json' \
  -d '{"caseId":"CASE-1042","stepId":"orchestrator-compliance-decision",
       "sessionId":"sess-003","afterSourceTime":"2026-09-08T10:28:00.000Z"}'
```

Returns Source Events for the client to canonicalize. **This has never been run
against a real endpoint.** If it fails it returns `200` with `mode: "recorded"`
and records the attempt as evidence; the demo continues on the recorded path.

---

## P. What I would do next, in order

1. **`CASE-1043`** — a recorded Case whose recovery fails: `armor.sanitized`,
   `agent.failed`, `intervention.timed_out`, escalation, `runtime.failed`. The
   golden path is proven; the unhappy path is currently only unit-tested.
2. **Run the live proof three times** against a real endpoint and record the
   spend, or disable live mode for the demo and say so.
3. **A second delegated agent** in the fixture, so the graph shows a fan-out
   rather than a single child.
4. **Approval → Intervention wiring in the UI.** The binding and invalidation
   logic is implemented and tested; the Approval Inbox currently displays
   recorded approvals rather than issuing new ones.
