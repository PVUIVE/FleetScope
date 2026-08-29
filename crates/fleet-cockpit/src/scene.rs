//! Loading a compiled Case into the Zoetrope renderer.
//!
//! This is the seam between FleetScope's Scenario Compiler and the vendored
//! rendering substrate. It is deliberately thin: the fold, the timeline engine,
//! the graph projection and the camera are Zoetrope's and stay unmodified, so
//! its 182 upstream tests keep their meaning. What lives here is the FleetScope
//! side of the contract — which artifacts make up a scene, and what a snapshot of
//! one says.
//!
//! # Host-testable on purpose
//!
//! Nothing in this module touches `ratzilla`, `wasm-bindgen` or a browser. The
//! Zoetrope dependency is its PORTABLE CORE (`default-features = false`), which
//! builds and runs on the host. That is what makes it possible to prove — in an
//! ordinary `cargo test` — that a compiled Case really does fold into the graph
//! and timeline FleetScope claims it does, rather than discovering it in a
//! browser after a wasm build.

use rataflow::{Palette, Theme};
use ratatui::style::Color;
use serde::{Deserialize, Serialize};
use zoetrope::state::{App, Mode, Transport};
use zoetrope::tailer::{replay_from_session, DemoSubagent, Source, UiEvent, Update};
use zoetrope::transcript::{parse_line, SubagentMeta};
use zoetrope::ui::brand::{set_branding, Branding};

use crate::manifest::{RenderManifest, RenderManifestEntry};

/// Zoetrope replays a session at a pace; FleetScope opens a Recorded Case parked
/// at its live edge, so the operator sees the finished Case and scrubs back.
const REPLAY_SPEED: f64 = 8.0;

/// The execution graph, in FleetScope's colours.
///
/// The renderer's own `new_flow()` ships a gold `accent` — its selection
/// highlight, "done" node fill and REPLAY badge. FleetScope's rule, here as
/// everywhere in the product, is that selection and focus are BLUE. Every
/// graph surface resolves from one `Palette`, so this one mapping — FleetScope
/// design tokens (`apps/web/src/styles/global.css`) to the eight semantic
/// roles — recolours the whole graph.
///
/// It is applied by assigning `App.flow.theme`, a public field, after the app
/// is built: a wrapper-level override, never a vendor patch (`vendor/VENDOR-PATCHES.md`).
pub const FLEETSCOPE_GRAPH_BG: Color = Color::Rgb(0x0d, 0x10, 0x14); // --fs-bg

pub fn fleetscope_palette() -> Palette {
    Palette {
        canvas_bg: FLEETSCOPE_GRAPH_BG,
        surface: Color::Rgb(0x14, 0x18, 0x1e), // --fs-surface
        muted: Color::Rgb(0x33, 0x3c, 0x47),   // --fs-border-strong (borders, edges)
        subtle: Color::Rgb(0x26, 0x2d, 0x36),  // --fs-border (ambient)
        accent: Color::Rgb(0x6b, 0x9c, 0xe0),  // --fs-info — selection / focus / done
        text: Color::Rgb(0xe7, 0xeb, 0xf1),    // --fs-text
        success: Color::Rgb(0x4e, 0xa8, 0x7a), // --fs-ok — running
        error: Color::Rgb(0xe0, 0x78, 0x78),   // --fs-deny — failed
    }
}

/// The product naming the renderer draws.
///
/// Upstream's defaults are its own — the `zoetrope` wordmark and `claude` as the
/// main node's title. Both are correct for a Claude Code session visualizer and
/// wrong on a governed enterprise surface: a Fleet Cockpit that labels the
/// orchestrating agent "claude" is naming an unrelated product in an audit
/// context. FleetScope sets its own before the first frame.
const FLEETSCOPE_BRANDING: Branding = Branding {
    product: "FleetScope",
    main_agent: "orchestrator",
};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SubagentFile {
    #[serde(rename = "agentId")]
    pub agent_id: String,
    /// The `meta.json` sidecar, serialized. Sets the child node's type and label.
    pub meta: String,
    pub transcript: String,
}

/// Everything needed to render one Case: the compiled transcripts plus the
/// manifest that maps them back to canonical evidence.
#[derive(Clone, Debug)]
pub struct Scene {
    pub main: String,
    pub subagents: Vec<SubagentFile>,
    pub manifest: RenderManifest,
}

/// How the Cockpit reports itself to FleetScope.
///
/// # What is deliberately NOT here
///
/// `caseSequence` and a canonical unread count. Those are FleetScope's units and
/// FleetScope owns them: the Event Cursor, the Case high-water mark, and the
/// number of accepted Canonical Events after the cursor. The renderer reports
/// only what it can actually know — where its own timeline sits — and the Render
/// Manifest translates. Letting the renderer answer in canonical units would
/// make a rendering detail authoritative over the audit spine.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CockpitSnapshot {
    #[serde(rename = "rendererEntryIndex")]
    pub renderer_entry_index: usize,
    #[serde(rename = "rendererEntryCount")]
    pub renderer_entry_count: usize,
    #[serde(rename = "atEdge")]
    pub at_edge: bool,
    pub transport: TransportState,
    #[serde(rename = "selectedNodeId", skip_serializing_if = "Option::is_none")]
    pub selected_node_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportState {
    Idle,
    Playing,
    Paused,
    History,
    Live,
}

impl From<Transport> for TransportState {
    fn from(transport: Transport) -> Self {
        match transport {
            Transport::Live => Self::Live,
            Transport::Playing => Self::Playing,
            Transport::Paused => Self::Paused,
            Transport::History => Self::History,
            Transport::Idle => Self::Idle,
        }
    }
}

impl TransportState {
    /// Whether the view is parked in the past.
    ///
    /// Historical mode must not look live: no pulsing activity, no marching-ants
    /// edges implying something is executing right now. The renderer reads this
    /// to suppress those, and the DOM shell reads it to label the surface.
    pub fn is_historical(self) -> bool {
        matches!(self, Self::History | Self::Paused)
    }
}

#[derive(Debug)]
pub enum SceneError {
    Manifest(String),
    /// An appended manifest entry did not continue the existing ranges.
    Append(String),
    /// The compiled transcripts and the manifest disagree about how many
    /// renderer entries exist. Every cursor translation would be off, so this
    /// fails loudly instead of drifting.
    EntryCountMismatch {
        manifest: usize,
        timeline: usize,
    },
}

impl std::fmt::Display for SceneError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Manifest(message) => write!(f, "render manifest is inconsistent: {message}"),
            Self::Append(message) => write!(f, "cannot append to the render manifest: {message}"),
            Self::EntryCountMismatch { manifest, timeline } => write!(
                f,
                "render manifest declares {manifest} renderer entries but the timeline folded {timeline}"
            ),
        }
    }
}

impl std::error::Error for SceneError {}

/// The loaded Cockpit: a Zoetrope `App` plus the manifest that explains it.
pub struct Cockpit {
    app: App,
    manifest: RenderManifest,
}

impl Cockpit {
    /// Build a Cockpit from a compiled scene.
    ///
    /// Verifies that the manifest's renderer-entry count matches what Zoetrope
    /// actually folded. Everything downstream — every seek, every reverse
    /// lookup — assumes those two agree, so the check belongs at load rather
    /// than as a silent assumption at every call site.
    pub fn load(scene: Scene) -> Result<Self, SceneError> {
        // Idempotent, and cheap enough to do at every load rather than relying on
        // a caller remembering to call it before the first frame.
        set_branding(FLEETSCOPE_BRANDING);

        let problems = scene.manifest.validate();
        if !problems.is_empty() {
            return Err(SceneError::Manifest(problems.join("; ")));
        }

        let subagents: Vec<DemoSubagent<'_>> = scene
            .subagents
            .iter()
            .map(|sub| DemoSubagent {
                agent_id: &sub.agent_id,
                meta: &sub.meta,
                transcript: &sub.transcript,
                workflow: None,
                journal: false,
            })
            .collect();

        let (items, info) = replay_from_session(&scene.main, &subagents);
        let timeline_len = items.len();
        if timeline_len != scene.manifest.renderer_entry_count {
            return Err(SceneError::EntryCountMismatch {
                manifest: scene.manifest.renderer_entry_count,
                timeline: timeline_len,
            });
        }

        let session_id = scene.manifest.case_id.clone();
        // `Mode::Replay` is correct even for a Case still receiving events: a
        // Recorded Case is never tailed from a filesystem, and appends arrive
        // through `append` below.
        let mut app = App::new(session_id.clone(), Mode::Replay);
        // Recolour the graph to FleetScope's tokens. `flow` is built once in
        // `App::new`; `sync`/`relayout` mutate it but never rebuild it, so one
        // assignment holds for the life of the Cockpit.
        app.flow.theme = Theme::Custom(fleetscope_palette());
        app.handle_ui_event(UiEvent::ReplayLoaded {
            session_id,
            items,
            speed: REPLAY_SPEED,
            info,
        });
        // Open parked at the live edge: a Recorded Case is finished evidence, and
        // an operator opens it to inspect the outcome, not to watch it play.
        app.go_live();

        Ok(Self {
            app,
            manifest: scene.manifest,
        })
    }

    pub fn app(&self) -> &App {
        &self.app
    }

    pub fn app_mut(&mut self) -> &mut App {
        &mut self.app
    }

    pub fn manifest(&self) -> &RenderManifest {
        &self.manifest
    }

    /// Seek to a fraction of the renderer timeline.
    ///
    /// Callers do not compute this fraction themselves: they resolve a
    /// `caseSequence` through [`Cockpit::seek_to_case_sequence`], which asks the
    /// manifest. This method exists for the scrubber, where the fraction IS the
    /// user's input.
    pub fn seek_fraction(&mut self, fraction: f64) {
        if !fraction.is_finite() {
            return;
        }
        self.app.seek_to_fraction(fraction.clamp(0.0, 1.0));
    }

    /// Move the renderer cursor to the entry that a Canonical Event produced.
    ///
    /// Returns `false` when the Case rendered nothing at all. NOT computed as
    /// `case_sequence / last_case_sequence`: see [`crate::manifest`].
    pub fn seek_to_case_sequence(&mut self, case_sequence: u64) -> bool {
        match self.manifest.fraction_for_case_sequence(case_sequence) {
            Some(fraction) => {
                self.seek_fraction(fraction);
                true
            }
            None => false,
        }
    }

    pub fn go_live(&mut self) {
        self.app.go_live();
    }

    /// Append newly compiled evidence at the live edge.
    ///
    /// The manifest is extended FIRST, so a malformed delta is refused before it
    /// can reach the timeline and leave the two out of step. A historical cursor
    /// is deliberately not moved: Zoetrope's `append_live` only snaps to the head
    /// while following it, which is exactly the FleetScope rule that events
    /// arriving during inspection must not yank the operator's view forward.
    pub fn append(
        &mut self,
        main_tail: &str,
        subagents: &[SubagentFile],
        entries: Vec<RenderManifestEntry>,
    ) -> Result<usize, SceneError> {
        let added = self
            .manifest
            .append_entries(entries)
            .map_err(SceneError::Append)?;

        let mut updates: Vec<Update> = Vec::new();
        for line in main_tail.lines().filter(|l| !l.trim().is_empty()) {
            if let Some(entry) = parse_line(line) {
                updates.push(Update::Entry {
                    source: Source::Main,
                    entry,
                });
            }
        }
        for sub in subagents {
            if !sub.meta.trim().is_empty() {
                if let Ok(meta) = serde_json::from_str::<SubagentMeta>(&sub.meta) {
                    updates.push(Update::SubagentMeta {
                        agent_id: sub.agent_id.clone(),
                        workflow: None,
                        meta,
                    });
                }
            }
            for line in sub.transcript.lines().filter(|l| !l.trim().is_empty()) {
                if let Some(entry) = parse_line(line) {
                    updates.push(Update::Entry {
                        source: Source::Sub(sub.agent_id.clone()),
                        entry,
                    });
                }
            }
        }

        if !updates.is_empty() {
            let session_id = self.app.current_session_id.clone();
            self.app.handle_ui_event(UiEvent::Batch {
                session_id,
                updates,
            });
        }
        Ok(added)
    }

    /// The renderer entry the playhead currently rests on.
    ///
    /// `Timeline::fold_target` is a COUNT of folded items; the index of the last
    /// one is that count minus one.
    pub fn renderer_entry_index(&self) -> usize {
        self.app.timeline.fold_target().saturating_sub(1)
    }

    pub fn renderer_entry_count(&self) -> usize {
        self.app.timeline.items.len()
    }

    /// The Canonical Event the renderer cursor currently corresponds to.
    /// The reverse lookup that keeps the FleetScope Event Cursor in step.
    pub fn current_manifest_entry(&self) -> Option<&crate::manifest::RenderManifestEntry> {
        self.manifest
            .entry_for_renderer_index(self.renderer_entry_index())
    }

    pub fn snapshot(&self) -> CockpitSnapshot {
        CockpitSnapshot {
            renderer_entry_index: self.renderer_entry_index(),
            renderer_entry_count: self.renderer_entry_count(),
            at_edge: self.app.timeline.at_edge(),
            transport: self.app.transport().into(),
            selected_node_id: self.app.selected_agent_id(),
        }
    }
}
