//! FleetScope Fleet Cockpit — the renderer-side core.
//!
//! # Scope of this crate
//!
//! It owns the FleetScope side of the rendering contract: the Render Manifest
//! that maps Canonical Events to renderer entries, the Event Cursor semantics,
//! the interim transcript model, and the loader that folds a compiled Case into
//! the vendored Zoetrope engine.
//!
//! It deliberately does **not** own FleetScope's domain model. Cases, Canonical
//! Events and Observable Case State live in the TypeScript packages and are
//! authoritative there; duplicating them here would create two sources of truth
//! for replay. What crosses the boundary is a compiled artifact plus a manifest,
//! never a domain object.
//!
//! # Why it is host-testable
//!
//! The Zoetrope dependency is its portable core (`default-features = false`):
//! model, timeline, graph projection, UI rendering and parser, with no tokio, no
//! crossterm and no filesystem. `ratzilla` and `wasm-bindgen` live one crate
//! further out in `crates/fleet-cockpit-web`, which can only be compiled for
//! wasm32. Keeping them apart is what lets `cargo test` prove the integration on
//! a developer machine instead of in a browser.

pub mod cursor;
pub mod manifest;
pub mod scene;
pub mod transcript;

pub use cursor::{Cursor, CursorError};
pub use manifest::{RenderManifest, RenderManifestEntry, RenderOutcome};
pub use scene::{Cockpit, CockpitSnapshot, Scene, SceneError, SubagentFile, TransportState};
pub use transcript::{Transcript, TranscriptEntry, TranscriptError, TranscriptHeader};
