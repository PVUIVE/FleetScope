# FleetScope budget-constrained demo design

Status: draft  

Scope: six-day hackathon vertical slice under a USD 35 cloud-credit ceiling  

Last updated: 2026-08-26

## Decision

Build a **static-first hybrid**:

1. reuse and rebrand a pinned browser/WASM visualization core for Fleet Cockpit;

2. add an Astro/DOM FleetScope shell for Agent Catalog, Case Workspace,

   approvals, and Decision Evidence;

3. drive normal development, rehearsal, and public replay from deterministic

   bundled events at zero model/cloud cost;

4. add one narrowly bounded live backend path for genuine Gemini/platform proof;

5. do not use Firestore, Pub/Sub, React Flow, or an always-on service in the MVP.

This explicitly supersedes the earlier React/Vite/React Flow plus

Pub/Sub/Firestore MVP implementation assumption. The product requirements stay:

canonical evidence, exact observable-state replay, safe control, and one

enterprise Case. Only the six-day mechanism changes.

## Why this is the best trade

| Option | Cash cost | Build risk | Track fit | Decision |

|---|---:|---:|---:|---|

| Use an external hosted viewer unchanged | $0 | Very low | Low: wrong brand/schema, read-only, no platform evidence | Reject as submission UI |

| Rebrand the pinned browser core and wrap it | ~$0 UI/hosting | Medium-low | High enough with a real Case shell and evidence | **Choose for MVP** |

| Rewrite graph/time travel in React | ~$0 UI/hosting | High in six days | High if completed | Defer until after hackathon |

| Fork and deeply replace Rust domain model | ~$0 UI/hosting | High | High | Defer; too much schema/UI work |

Evidence behind the choice:

- upstream is MIT-licensed and current;

- the portable core already implements graph, timeline, time travel, camera,

  chips, WebAssembly, upload, and live append;

- 182 upstream library tests pass locally;

- the existing load and append exports already form a usable browser boundary;

- the hard coupling is the Claude-specific parser/model, which a scenario

  compiler can bridge for one deterministic Case;

- the complete Rust code surface is about 14K lines, so rebuilding or deeply

  reshaping it is not a six-day optimization.

## Demo architecture

```text

                         zero-credit default path

 FleetScope fixture/manifest ------------------------------+

        |                                                   |

        v                                                   v

 Scenario Compiler -&gt; compatible JSONL -&gt; FleetScope WASM Cockpit

        |                                           ^

        v                                           |

 Astro/DOM Catalog + Case Workspace + Evidence -----+

        |

        | optional live proof, guarded by budget

        v

 Small local/Cloud Run API -&gt; Gemini Flash + available GEAP adapters

        |

        v

 canonical result -&gt; transcript adapter -&gt; browser append export

```

### Browser shell

Extend the existing Astro site rather than adding a second frontend framework.

Routes for the MVP:

- `/` or `/catalog` — one approved Vendor Onboarding Orchestrator card;

- `/cases/CASE-1042` — one Case Workspace;

- `/cockpit/CASE-1042` — WASM graph plus DOM evidence rail;

- `/audit/CASE-1042` — unified recorded evidence.

The public deployment is static and read-only. Static hosting can be Vercel,

GitHub Pages, Firebase Hosting, or another free/static surface allowed by the

event. The design does not depend on a paid host.

### Scenario Compiler

Input: FleetScope canonical scenario JSON with Case phases and platform

evidence. Output:

- main Claude-compatible JSONL for the Vendor Onboarding Orchestrator;

- subagent sidecars for Compliance, Logistics, and Warden;

- an evidence manifest mapping Case phase and platform decisions to event

  indices/fractions;

- a redacted human-readable audit JSON.

Tool names carry the enterprise story without altering the first-pass Rust

renderer:

```text

AgentRegistry.resolve

AgentRuntime.wait / AgentRuntime.resume

MemoryBank.write / MemoryBank.recall

AgentIdentity.authorize

[ERP.inventory.read](http://ERP.inventory.read)

AgentGateway.route

ModelArmor.screen

Warden.retry

```

The compiler MUST preserve stable IDs, timestamps, parentage, pending/result

pairs, and error flags so the upstream projector remains deterministic.

### Minimal WASM changes

Retain the existing load and append exports. Add small FleetScope controls only:

- `fleetscope_seek(fraction)` — queue a historical seek;

- `fleetscope_go_live()` — return to the event edge;

- `fleetscope_snapshot()` — return selected cursor/transport/agent summary as

  JSON, or emit an equivalent browser event;

- optional `fleetscope_select(node_id)` if reliable within the time box.

These exports synchronize DOM Case/evidence panels with the existing playhead.

Do not implement custom Registry/Memory/Identity/Gateway/Armor node renderers in

Rust for MVP. Their tool chips plus DOM Decision Evidence are sufficient.

### Optional live backend

One endpoint accepts a fixed scenario step and returns a schema-constrained

decision. It may call Gemini Flash and any confirmed platform adapters. It must:

- accept only allowlisted Case/step IDs, not arbitrary prompts;

- cap model calls, input characters, output tokens, retries, and wall time;

- return recorded model/service/version and concise Decision Evidence;

- never execute a protected side effect based on free-form model text;

- append the result to the Cockpit through the existing browser ABI;

- fall back instantly to the recorded result if unavailable.

During ordinary development, `LIVE_MODE=false` and this path is never called.

## Credit guardrails

The USD 35 ceiling is a hard stop, not a target. Exact per-service pricing must

be verified in the target project before enabling live mode.

### Allocation envelope

| Bucket | Maximum | Purpose |

|---|---:|---|

| Integration smoke tests | $5 | One or two calls for the selected live capability plus pricing calibration |

| Live end-to-end rehearsal/recording | $10 | Bounded golden Case runs only |

| Contingency | $20 | Quota/pricing surprises and final retry |

Unused contingency stays unused.

### Hard runtime limits

- default to recorded fixtures for UI work, unit tests, user tests, and public

  judging replay;

- at most 2 model calls per live Case: orchestrator decision and Warden advice;

- initial cap: 2,000 input tokens and 300 output tokens per model call;

- temperature 0 or the lowest supported deterministic setting;

- no recursive agent/model loops;

- maximum 10 live Cases for rehearsals unless actual billing proves headroom;

- Cloud Run `min-instances=0`, `max-instances=1`; no always-on worker;

- no Firestore/Pub/Sub in the MVP path;

- create billing alerts at $5, $15, $25, and $32 if the platform supports them;

- disable live mode before sharing the public URL.

Model token limits are starting guardrails, not pricing claims. The team must

inspect the billing console after the first smoke Case before raising any cap.

## What is real versus recorded

The demo UI MUST label execution mode:

- **Recorded Case** — deterministic bundled evidence; costs $0 and is the public

  fallback.

- **Live proof** — calls the bounded backend and shows actual operation/model

  references.

- **Synthetic enterprise system** — local ERP/vendor data with real policy

  enforcement where implemented.

- **Simulated Day 12** — separate invocation/state proof, not real elapsed time.

The strongest truthful demo is one live platform decision appended into an

otherwise deterministic Case. It is better than seven unreliable live calls.

## Six-day implementation slices

### Slice 0 — upstream build proof, half day

- fork at a pinned upstream revision and retain MIT notice;

- install `trunk`, run `cargo test --lib`, build WASM/static site;

- record artifact sizes and browser smoke result;

- keep upstream core changes in isolated commits for easy rebasing.

Gate: forked browser demo loads locally and replays upstream fixture.

### Slice 1 — FleetScope fixture, one day

- define canonical Case phases/evidence manifest;

- implement Scenario Compiler;

- generate main/subagent transcript files for Registry, Runtime, Memory,

  Identity, Gateway, Armor, Logistics failure, and Warden result;

- verify upstream shuffle/replay properties still pass.

Gate: forked Cockpit replays the entire FleetScope story with correct agents,

tools, failures, and backward seek.

### Slice 2 — product shell, one day

- replace upstream branding/assets while retaining license attribution;

- build Catalog, Case Workspace, and Audit from the same fixture manifest;

- add navigation into the Cockpit and visible Recorded/Live/Simulated labels.

Gate: a procurement user understands current Case status without entering the

graph.

### Slice 3 — Cockpit synchronization, one day

- add seek/live/snapshot WASM exports;

- build DOM Decision Evidence rail and platform phase buttons;

- synchronize evidence with selected event/cursor;

- preserve keyboard, mouse, follow camera, and reduced-motion behavior.

Gate: clicking Memory/Identity/Gateway/Armor/Incident jumps to the correct

historical evidence.

### Slice 4 — one live proof, one day

- implement bounded backend and one confirmed Gemini/GEAP path;

- append its real result into the WASM session;

- enforce call/token/run caps and recorded fallback;

- capture billing after the first call and update the envelope.

Gate: one live decision is real, correlated, and safe; disabling live mode leaves

the complete demo functional.

### Slice 5 — hardening and recording, two days

- browser/build tests, ten recorded runs, only a few live rehearsals;

- verify attribution, redaction, public read-only mode, video readability;

- record early and keep the static Case as final fallback.

## Acceptance criteria

1. A clean local clone builds the browser app using documented prerequisites.

2. Static Recorded Case works with network disabled after assets load.

3. The same scenario prefix yields the same projected graph/state after replay.

4. Catalog, Case Workspace, Cockpit, and Audit read one fixture/evidence manifest.

5. Every enterprise tool chip opens matching Decision Evidence.

6. Blocked input has no downstream-use event in the fixture or live result.

7. One live proof respects call/token/run limits and can be disabled without UI

   regression.

8. Cloud spend remains below the USD 35 ceiling with billing evidence captured.

9. MIT copyright/license notice and upstream attribution are present.

## Risks

| Risk | Response |

|---|---|

| Claude transcript bridge looks artificial | Explain it as the Cockpit adapter; audit manifest remains FleetScope-native |

| Rust/WASM build consumes schedule | Time-box Slice 0; if it fails, build a simplified static FleetScope graph |

| DOM/WASM cursor synchronization is hard | Add only fraction seek/snapshot; use scripted phase buttons, not full two-way selection |

| Upstream changes during hackathon | Pin inspected commit; do not chase upstream after Slice 0 |

| Actual GEAP API unavailable | Use one verified Gemini/platform call and label other adapters/recorded evidence honestly |

| Credit runaway | Recorded-by-default, hard caps, billing alerts, max one Cloud Run instance |

## Open points

1. Exact live Gemini model and per-service pricing in the credited project.

2. Which one platform capability supplies the strongest reliable live proof.

3. Whether contest rules require deployment specifically on Cloud Run.

4. Where the required third-party MIT notice lives without entering product

   navigation or product-facing documentation.

## Links

- [System design]([system.md](http://system.md))

- [Product requirements](../requirements/[fleetscope.md](http://fleetscope.md))

- [UI/UX plan](../product/[ui-ux-plan.md](http://ui-ux-plan.md))

- [Six-day delivery plan](../plans/[six-day-delivery.md](http://six-day-delivery.md))

