# FleetScope

FleetScope is an enterprise agent-fleet control plane. A procurement manager
discovers an approved, versioned agent in the **Agent Catalog**, starts a durable
multi-week **Case**, and returns days later without losing context. Registry,
Runtime, Memory Bank, Identity, Gateway, Model Armor, and Observability decisions
are captured as append-only **Canonical Events**, projected deterministically into
**Observable Case State**, and surfaced across a Case Workspace, an Approval
Inbox, an expert **Fleet Cockpit**, and an **Audit** view — so every badge the UI
shows is backed by recorded evidence rather than an assumption. FleetScope is not
merely a graph viewer, and the Cockpit is one surface within it, not the product.

## Architecture

```mermaid
graph TD
  subgraph recorded["Recorded path — the default, needs no backend"]
    SE[Source Events<br/>duplicated, out of order] --> CZ[Canonicalizer<br/>validate · redact · dedup · order]
    CZ --> CE[Canonical Events]
    CE --> CW[Case Workspace]
    CE --> AP[Approvals]
    CE --> AU[Audit + evidence export]
    CE --> PR[Session Projector<br/>pure, versioned]
    PR --> OCS[Observable Case State<br/>+ state hash]
    CE --> WD[Incident Detector → Policy Engine → Warden]
    CE --> SC[Scenario Compiler]
    SC --> TR[Zoetrope transcripts]
    SC --> RM[Render Manifest]
    TR --> WASM[Rust/WASM Fleet Cockpit<br/>vendored Zoetrope]
    RM --> WASM
    RM -.->|caseSequence ↔ renderer index| CUR[FleetScope Event Cursor]
  end

  subgraph live["Optional live path — bounded, off by default"]
    WEB[Astro frontend] --> API[Bounded API<br/>allowlisted step, never a prompt]
    API --> GEM[Gemini, one call, schema-checked]
    GEM --> SE2[Source Events]
    SE2 --> CZ
  end
```

The default, demo, and public path requires **zero backend availability**: the
static build inlines recorded evidence, so the product works with the network
disabled after first load.

## Repository map

| Path                         | What it is                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                   | Astro product shell (static output). Catalog, Cases, Approvals, Cockpit mount, Audit.                                  |
| `apps/api`                   | One small Hono service: `/health`, `/capability`, one bounded live proof. Optional.                                    |
| `packages/domain`            | The FleetScope vocabulary. Framework-independent.                                                                      |
| `packages/event-schema`      | Canonical Event envelope, the closed event-type set, JSONL codec, generated JSON Schema.                               |
| `packages/projector`         | The versioned **pure** Session Projector and the state-hash contract.                                                  |
| `packages/fixtures`          | Recorded Case evidence — a product asset, not a test leftover.                                                         |
| `packages/canonicalizer`     | **The primary redaction boundary.** Validate → redact → dedup → order → Canonical Event.                               |
| `packages/scenario-compiler` | Canonical Events → renderer transcripts **+ the Render Manifest**, behind `RendererAdapter`.                           |
| `packages/warden`            | Incident Detector, Policy Engine, and the Intervention lifecycle with at-most-once execution.                          |
| `packages/platform-adapters` | The seven adapter interfaces, their `recorded / synthetic / live / unavailable` modes, and the capability truth table. |
| `packages/shared`            | Canonical JSON, SHA-256, `Result`, central config parsing, the live-mode guard.                                        |
| `crates/fleet-cockpit`       | Rust, **host-testable**: Render Manifest, Event Cursor, scene loading over the vendored renderer.                      |
| `crates/fleet-cockpit-web`   | Rust, **wasm32-only**, its own workspace: the browser shell and the `fleetscope_*` ABI.                                |
| `vendor/zoetrope`            | The pinned MIT renderer. See `vendor/VENDOR-PATCHES.md` — it is **patched**, not pristine.                             |
| `docs/`                      | Product, requirements, design, plans, decisions, reports, `architecture.md`.                                           |
| `scripts/`                   | `typecheck.sh`, `build-wasm.sh`, `smoke.sh`, `bless-fixtures.ts`, `recorded-run.ts`, `recorded-reliability.ts`.        |

Dependency rules and per-package responsibilities: **`docs/architecture.md`**.

## Prerequisites

| Tool                     | Version                           | Notes                                                        |
| ------------------------ | --------------------------------- | ------------------------------------------------------------ |
| Node                     | **22.x** (verified on 22.18.0)    | `engines` requires `>=22`.                                   |
| pnpm                     | **11.x** (verified on 11.24.0)    | `corepack enable` installs the pinned version.               |
| Rust / Cargo             | **1.90.0** verified, 1.82 minimum | `rust-toolchain.toml` pins stable + rustfmt + clippy.        |
| `wasm32-unknown-unknown` | —                                 | `rustup target add wasm32-unknown-unknown`                   |
| `trunk`                  | latest                            | **Not installed by default.** `cargo install --locked trunk` |

Only `trunk` is optional: everything except the bundled WASM artifact builds and
tests without it.

## Local setup

```bash
git clone <repo> && cd FleetScope
corepack enable
pnpm install

cp .env.example .env          # optional; every default is already safe

pnpm dev                      # Astro at http://localhost:4321 → /cases
```

That is the whole setup for normal development. No cloud project, no credential,
and no model call is involved.

Other entry points:

```bash
pnpm dev:web                  # Astro only
pnpm dev:api                  # bounded API on :8080 (optional)

pnpm build                    # static site
pnpm build:web
pnpm build:wasm               # requires trunk

pnpm scenario:compile CASE-1042   # canonical events → Cockpit transcript
pnpm fixtures:bless               # regenerate blessed hashes AND renderer artifacts
pnpm schema:emit                  # regenerate JSON Schema from Zod

pnpm recorded:run             # one complete Recorded Case run, as one JSON line
pnpm reliability              # ten consecutive cold runs, compared field by field

pnpm check                    # format + lint + typecheck + test + build
pnpm smoke                    # the above plus Rust, the vendored renderer, and WASM
```

## Recorded mode

`LIVE_MODE=false` is the default and the **safe** default. It fails closed: only
the literal string `"true"` enables live mode, so a typo or an unset variable both
mean recorded-only.

In recorded mode:

- `apps/web` renders entirely from `packages/fixtures` inlined at build time;
- the projector reads canonical events and computes state and hashes locally;
- `apps/api` is not required at all, and if it is running it refuses every live
  request with `409 live_mode_disabled` and names the recorded fallback.

Every surface labels its execution mode — _Recorded Case_, _Live proof_,
_Synthetic system_, _Simulated day boundary_ — so recorded evidence can never be
mistaken for a live platform result.

## Live mode

Optional, bounded, and off unless deliberately enabled. Turning it on requires
`LIVE_MODE=true` **plus** `GEMINI_MODEL` and `GEMINI_API_KEY`; the service refuses
to boot otherwise, naming the missing variable and never a value.

Guardrails, all enforced in code:

- only allowlisted `(caseId, stepId)` pairs are accepted — **there is no
  free-form prompt endpoint anywhere in the service**;
- at most `GEMINI_MAX_CALLS_PER_CASE` (default 2) model calls per Case;
- 2,000 input / 300 output tokens, temperature 0, 15 s timeout by default;
- Cloud Run runs `min-instances=0`, `max-instances=1`, with no worker.

One call, no retry, and a response that must satisfy a schema or the call counts
as failed. `/live/decision` returns **Source Events**, never a rendered result:
the client canonicalizes them onto its stream, projects, compiles and appends, so
a live result becomes canonical evidence before it reaches an authoritative
surface. A failure returns `200` with `mode: "recorded"` and records the attempt
as evidence — FleetScope never fabricates a live success.

**Executed: 3/3 live runs passed against the real Gemini API, ~USD 0.0007 total**
— about 0.002% of the USD 35 ceiling. Reproduce with
`bash scripts/live-reliability.sh 3`. Every unit test still injects a `fetch`
that stays in-process, so the bounded path runs in CI for free.
See `docs/decisions/0003-bounded-live-path.md`.

If the API reports `API_KEY_INVALID` on a key you know is good, check for a
`GEMINI_API_KEY` exported in your shell profile: Node's `--env-file` does not
override an already-set variable, so an ambient value silently shadows `.env`.

Never boot the normal UI with credentials. It does not need them.

## Testing

```bash
pnpm test                     # all TypeScript tests
pnpm test:unit                # domain, schema, config, compiler, api guards
pnpm test:replay              # projector determinism + CASE-1042 fixture proofs
pnpm typecheck                # every package + astro check
pnpm lint
pnpm format:check

cargo test                    # FleetScope Rust, incl. the real Zoetrope integration
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings

# The vendored renderer, on its own terms — must stay green after every patch.
cargo test  --manifest-path vendor/zoetrope/Cargo.toml
cargo check --manifest-path vendor/zoetrope/Cargo.toml --no-default-features

# The wasm-only browser crate (its own workspace).
cargo check --manifest-path crates/fleet-cockpit-web/Cargo.toml \
            --target wasm32-unknown-unknown

pnpm smoke                    # everything above, with explicit PASS/FAIL/SKIP
pnpm reliability              # ten cold Recorded Case runs, compared field by field
```

| Suite                                                 |                                                        Tests |
| ----------------------------------------------------- | -----------------------------------------------------------: |
| TypeScript (`pnpm test`)                              |                                      **234** across 14 files |
| FleetScope Rust (`cargo test`)                        |            **53** — 9 lib, 12 cursor, 23 scene, 9 transcript |
| Vendored Zoetrope (`cargo test` in `vendor/zoetrope`) | **190** — 182 lib + 8 bin, unchanged by FleetScope's patches |

`pnpm test:replay` is the load-bearing one: it proves that the same canonical
prefix and projector version yield the same Observable Case State hash, and that
the fixture upholds the product invariants (blocked input never used downstream,
intervention states never collapsed, every badge traceable to an event).

`crates/fleet-cockpit/tests/scene.rs` is the other: it folds the real compiled
CASE-1042 through the real vendored renderer **on the host**, so "the Cockpit
renders what FleetScope says it does" is checked by `cargo test` rather than
discovered in a browser.

## Licensing

FleetScope is MIT licensed — see `LICENSE`.

Third-party attribution lives in **`THIRD-PARTY-NOTICES.md`**, and only there:
per product decision D8, notices stay in repository licensing files and do not
appear in product navigation.

The Fleet Cockpit renders on **Zoetrope** (MIT, © 2026 Furkan Kalaycioglu),
vendored at `vendor/zoetrope/` and pinned to
`077707da679955c0402c39ca992bf56cdc6b0264`. It is **not unmodified** — FleetScope
carries a small patchset, recorded in full in **`vendor/VENDOR-PATCHES.md`**.
Upstream's own suite (182 library + 8 binary tests) passes unchanged after it.
