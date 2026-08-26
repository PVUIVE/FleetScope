//! FleetScope Fleet Cockpit.
//!
//! # Scope of this crate
//!
//! This crate owns the *renderer-side* model: the transcript it loads, the event
//! cursor it moves, and the browser ABI the Astro shell calls. It deliberately
//! does **not** own FleetScope's domain model — Cases, Canonical Events, and
//! Observable Case State live in the TypeScript packages and are authoritative
//! there. Duplicating them here would create two sources of truth for replay.
//!
//! # Relationship to the planned upstream fork
//!
//! FleetScope plans to reuse a pinned, MIT-licensed browser/WASM visualization
//! core as the rendering substrate (see `docs/design/budget-demo.md`). That
//! upstream is **not vendored yet**. What lives here is FleetScope's own thin,
//! buildable core so that the ABI contract, the cursor semantics, and the tests
//! exist and are exercised before the fork lands. When it does, the graph,
//! camera, and drawing code arrive under `vendor/` and this crate becomes the
//! adapter over it — see `docs/decisions/0002-cockpit-renderer-boundary.md`.

pub mod cursor;
pub mod transcript;

#[cfg(target_arch = "wasm32")]
pub mod abi;

pub use cursor::{Cursor, CursorError};
pub use transcript::{Transcript, TranscriptEntry, TranscriptError, TranscriptHeader};
