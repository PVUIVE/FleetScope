# FleetScope → Local Agent Viewer: Refactor Audit

**Date:** 2026-08-28
**Baseline commit:** `c6ce98a`
**Baseline test result:** `pnpm test` → 15 files, **294 tests, 294 passed** (1.07 s)
**Environment probed:** Node v22.18.0 · pnpm 11.24.0 · Python 3.13.5 · `google-adk` **1.20.0** installed · `cargo` 1.90.0 · `trunk` present · `wasm32-unknown-unknown` installed · `GEMINI_API_KEY` present in `.env`.

This is the pre-implementation audit required before the product reset from
"enterprise agent-fleet control plane" to **a local Agent Viewer for Gemini and
Google ADK**. It is written from the actual code, not from previous reports.

---

## A. Current architecture

pnpm monorepo (`apps/*`, `packages/*`) plus a Cargo workspace and a vendored renderer.

```
apps/
  api/        Hono service: /health, /capability, POST /live/decision  (bounded Gemini proof)
  web/        Astro 5, output: 'static'. Landing + 5 enterprise operator routes
packages/
  shared/            canonical-json, sha256, Result, env/config parsing
  domain/            Case, Session, Agent, Approval, Intervention, Memory, Evidence,
                     State, **Cursor** (Event Cursor / high-water / canonical unread)
  event-schema/      Zod SourceEvent + CanonicalEvent + closed EVENT_TYPES set (43 types)
  canonicalizer/     validate → redact → dedupe → total order → sequence assignment
  projector/         Canonical Events → Observable Case State (deterministic), audit export
  scenario-compiler/ Canonical Events → Zoetrope JSONL scene + **Render Manifest**
  platform-adapters/ Registry/Memory/Identity/Gateway/Armor/Runtime/Observability stubs
  warden/            incident detector, policy engine, approval + intervention lifecycle
  fixtures/          CASE-1042 recorded case (source + canonical + expected state + scene)
crates/
  fleet-cockpit/     host-testable renderer core: Scene loader, Cursor, Render Manifest (Rust)
  fleet-cockpit-web/ wasm32-only ratzilla/WebGl2 shell + `fleetscope_*` JS ABI
vendor/zoetrope/     pinned upstream renderer (graph, timeline, camera, fold, parser)
```

**The data spine that already works:**

```
Source Events → Canonicalizer (redact → dedupe → order) → Canonical Events
                                                              ├→ Projector → Observable Case State
                                                              └→ Scenario Compiler → Zoetrope scene
                                                                                   + Render Manifest
                                                                                        ↕
                                                                          Event Cursor ↔ renderer index
```

### Findings that shape the refactor

1. **The Zoetrope adapter is already generic.** `packages/scenario-compiler/src/zoetrope/adapter.ts`
   is driven by three lookup tables keyed on event *type* (`DOMAIN_OF`, `OUTCOME_OF`,
   `PLATFORM_TOOL`) and a switch on lifecycle families. It contains **no** CASE-1042 literal,
   no vendor name, no hard-coded event count. It compiles any well-formed canonical stream.
2. **The Render Manifest is the right bridge and is already invertible** in both directions,
   in both TS and Rust, with `rendererEntryCount == 0` handled honestly.
3. **`crates/fleet-cockpit/src/manifest.rs` types `domain` as `String`.** A new render domain
   therefore needs no Rust change and no wasm rebuild.
4. **Redaction is a real security control**, not decoration: field-name rules *and*
   value-shape rules (Google API key, bearer, PEM, `sk-`/`ghp_`/`xoxb-`, home paths),
   applied **before persistence**, with `scanForSensitiveMaterial` for machine-checked assertions.
   `thinking` / `reasoning` / `chain_of_thought` / `prompt` are classified and dropped.
5. **`vendor/zoetrope/src/ui/panel.rs` draws `↳ prompt` and `↳ thought` rows.** The compiler
   deliberately never emits those fields. That rule must survive the refactor.
6. **The only hard-coded Case assumption in shipping code** is
   `crates/fleet-cockpit-web/src/main.rs`, which `include_str!`s the CASE-1042 scene as the
   boot scene. Everything else CASE-1042 lives in `packages/fixtures` (correct) or in
   `apps/web/src/lib/*` landing/case view helpers (build-time fixture readers, also correct).
7. **`packages/scenario-compiler/src/compile.ts` (the "interim transcript") is dead weight**
   for the product: `interimJsonlAdapter` is not consumed by any app; only the Zoetrope
   adapter is. It is still exercised by tests and by `crates/fleet-cockpit/src/transcript.rs`.
8. **There is no CLI, no persistence, no streaming, and no agent-framework integration.**
   `apps/api` serves no session data at all; `apps/web` reads fixtures at build time.
9. **`parseConfig` has no local-viewer knobs** (port for the viewer, storage path) and
   `PORT` defaults to 8080.
10. **ADK 1.20.0 exposes exactly the integration surface this product needs**:
    `BasePlugin` with `before_run/after_run`, `before_agent/after_agent`,
    `before_model/after_model/on_model_error`, `before_tool/after_tool/on_tool_error`.
    Terminal-scraping is unnecessary and is rejected.

---

## B. Valuable systems to preserve

| System | Path | Why it survives |
|---|---|---|
| Canonicalizer + redaction | `packages/canonicalizer` | Pure, order-independent, the security boundary. 20 tests. |
| Canonical event envelope | `packages/event-schema` | Zod-first, closed type set, JSONL codec. |
| Render Manifest | `packages/scenario-compiler/src/render-manifest.ts` + `crates/fleet-cockpit/src/manifest.rs` | The only honest event↔renderer-index bridge. |
| Zoetrope scene compiler | `packages/scenario-compiler/src/zoetrope/*` | Generic, minimizing, semantically faithful. 38 + 11 tests. |
| Renderer core + wasm shell | `crates/fleet-cockpit*`, `vendor/zoetrope` | Graph, timeline, camera, historical seek, WebGl2. Historical-honesty tick suppression already implemented. |
| Event Cursor | `packages/domain/src/cursor.ts` | live/historical, high-water, canonical unread, return-to-live. 12 tests. |
| Astro app + design system | `apps/web`, `DESIGN.md`, `landing.css` | Blueprint visual language is good and reusable. |
| Deterministic projection | `packages/projector` | Kept **internal**; proves replay determinism. |

## C. Systems over-scoped for the new MVP

`packages/warden` (detector/policy/approval/intervention), `packages/platform-adapters`
(Registry/Identity/Gateway/Armor/Memory/Observability), the enterprise routes
`/cases`, `/cases/:id`, `/audit/:id`, `/approvals`, `/catalog`, the `POST /live/decision`
bounded-proof endpoint, and the CASE-1042 story surfaces.

None of these serve "one developer watching one local ADK run".

## D. Code that should remain but be hidden / deferred

All of section C **stays in the repository, compiling and tested**, and is removed from
primary navigation and from the golden path. Rationale: they are correct, covered by 100+
passing tests, and are the documented future direction (fleet observability + governance).
Deleting them would destroy working code to make the repo look tidier — explicitly out of
scope. The enterprise routes remain reachable by URL and are labelled *Future / Enterprise
Direction* in docs; `/` and the nav no longer point at them.

`POST /live/decision` + `/capability` remain in `apps/api` as deferred endpoints. They are
superseded by real ADK capture and are not called by any MVP surface.

## E. Code that should be removed

Only one thing is genuinely obsolete rather than merely deferred:

- The **boot-time `include_str!` of CASE-1042** in `crates/fleet-cockpit-web/src/main.rs`.
  A generic viewer must not embed one fixture as its default scene. Replaced by an empty
  boot scene; every scene now arrives through `fleetscope_load`.

Nothing else is deleted. `compile.ts` / `interimJsonlAdapter` are unused by apps but are
the contract `crates/fleet-cockpit/src/transcript.rs` parses; they stay.

## F. Target architecture

```
   Google ADK / Gemini agent (Python)
                │  official BasePlugin callbacks
                ▼
   fleetscope_adk.FleetScopePlugin        ← examples/fleetscope_adk
                │  HTTP POST, batched, non-blocking, fail-open
                ▼
   POST /api/ingest        (apps/api)
                │
                ▼
   @fleetscope/adk-adapter  ADK wire event → SourceEvent   (no fabrication; unknown stays unknown)
                │
                ▼
   @fleetscope/canonicalizer  canonicalizeAppend → Canonical Events   ← REDACTION BOUNDARY
                │
     ┌──────────┴───────────┐
     ▼                      ▼
 @fleetscope/session-store   SSE hub
 (node:sqlite, sessions+events)   │
     │                      │
     └──────────┬───────────┘
                ▼
        GET /api/sessions · /api/sessions/:id · /events · /events/stream
                │
                ▼
   Browser (Astro): @fleetscope/viewer  Canonical → ViewerEvent / ViewerSession
                │                       @fleetscope/scenario-compiler → Zoetrope scene + manifest
                ▼
   Agent Viewer:  Agent tree · Execution graph (wasm) · Timeline · Details · Live/Historical
```

The enterprise spine sits *underneath* unchanged; the browser sees an 11-type
`ViewerEvent` vocabulary instead of 46 canonical types.

## G. Migration / refactor plan

1. **Event vocabulary** — add `model.requested` / `model.responded` / `model.failed` to the
   closed canonical set; add the `model` render domain; teach the Zoetrope adapter to draw a
   model call as a named chip. No Rust change (domain is `String`).
2. **New packages** — `@fleetscope/viewer` (ViewerEvent/ViewerSession projection),
   `@fleetscope/session-store` (node:sqlite, versioned schema),
   `@fleetscope/adk-adapter` (ADK wire → SourceEvent + session inference).
3. **`apps/api`** — add `POST /api/ingest`, `GET /api/sessions`, `/api/sessions/:id`,
   `/api/sessions/:id/events`, `/api/sessions/:id/events/stream` (SSE), `/api/sessions/stream`,
   `GET /api/health`; serve the built static viewer with a `/sessions/*` rewrite.
   Keep legacy routes untouched.
4. **`apps/cli`** — `fleetscope init | watch | open | run`.
5. **`apps/web`** — new `/`, `/sessions`, `/sessions/view` (served at `/sessions/:id`);
   new nav; the Cockpit mount generalized from "Case" to "Session".
6. **Renderer** — empty boot scene; rebuild wasm.
7. **Example** — `examples/fleetscope_adk` (the plugin) + `examples/vendor_agent.py`
   (root agent + `vendor_lookup`, sub-agent + `inventory_lookup` with a deterministic failure).
8. **Docs** — rewrite README/architecture/DESIGN; archive contradictory enterprise docs under
   `docs/archive/` with a *Future / Enterprise Direction* banner.
9. **Validation** — unit + integration + Playwright E2E + 3 real ADK runs.
