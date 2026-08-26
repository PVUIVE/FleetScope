//! Product naming, set once at boot.
//!
//! # FleetScope vendor patch
//!
//! Upstream hard-codes two product names into the rendered output: the gold
//! `zoetrope` wordmark in the status bar and help overlay, and `claude` as the
//! main agent node's title. Both are correct for a Claude Code session
//! visualizer and wrong for anything embedding this crate as a rendering
//! substrate — a FleetScope Fleet Cockpit that labels the orchestrating agent
//! "claude" is naming an unrelated product on a governed enterprise surface.
//!
//! The defaults are UNCHANGED, so `zoe`, the browser demo and every other
//! upstream consumer render exactly as before. An embedder calls
//! [`set_branding`] once before its first frame.
//!
//! A wrapper could not do this: the strings are emitted inside `ui::draw` and
//! `state::graph`, from state the renderer owns. See `vendor/VENDOR-PATCHES.md`.

use std::sync::OnceLock;

/// The product names that reach rendered output.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Branding {
    /// Wordmark in the status bar and the help overlay.
    pub product: &'static str,
    /// Title of the main agent's node card, and the detail panel's fallback.
    pub main_agent: &'static str,
}

/// Upstream's own names. What every consumer gets unless it says otherwise.
pub const DEFAULT_BRANDING: Branding = Branding {
    product: "zoetrope",
    main_agent: "claude",
};

static BRANDING: OnceLock<Branding> = OnceLock::new();

/// Set the product naming. Call once, before the first frame.
///
/// Later calls are ignored rather than rejected: branding is not worth an error
/// path, and a silently-changing wordmark mid-session would be worse than a
/// stable one.
pub fn set_branding(branding: Branding) {
    let _ = BRANDING.set(branding);
}

/// The active branding. `DEFAULT_BRANDING` until [`set_branding`] is called.
pub fn branding() -> Branding {
    *BRANDING.get().unwrap_or(&DEFAULT_BRANDING)
}
