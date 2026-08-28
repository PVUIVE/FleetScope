//! The Fleet Cockpit in the browser.
//!
//! A thin shell around [`fleet_cockpit::Cockpit`]: it owns the WebGl2 terminal,
//! the input handling, the render loop, and the JS-callable `fleetscope_*` ABI.
//! Everything with a rule in it — the Render Manifest, cursor translation, the
//! snapshot contract — lives one crate down in `fleet-cockpit`, where it is
//! host-testable. Nothing here is load-bearing enough to need a browser to prove.
//!
//! # What this crate does NOT do
//!
//! It does not reimplement the timeline, the graph layout, the camera, the tool
//! chips or the semantic zoom. Those are the vendored Zoetrope engine's, used
//! unmodified so its upstream tests keep their meaning.
//!
//! It also does not own FleetScope's Event Cursor. The renderer reports where its
//! own timeline sits; `apps/web` maps that back to a `caseSequence` through the
//! Render Manifest and keeps the canonical cursor and unread count itself.

use std::cell::{Cell, RefCell};
use std::io;
use std::rc::Rc;

use fleet_cockpit::manifest::{RenderManifest, RenderManifestEntry};
use fleet_cockpit::scene::{Cockpit, Scene, SubagentFile};
use ratzilla::backend::webgl2::{FontAtlasConfig, WebGl2BackendOptions};
use ratzilla::event::{
    KeyCode as RKeyCode, KeyEvent as RKeyEvent, MouseButton as RMouseButton,
    MouseEvent as RMouseEvent, MouseEventKind as RMouseKind,
};
use ratzilla::{WebGl2Backend, WebRenderer};
use wasm_bindgen::prelude::*;
use web_time::Instant;

/// The boot scene: empty.
///
/// A generic Agent Viewer must not embed one recorded Case as its default —
/// doing so made an earlier build show a vendor-onboarding graph for a second
/// before the developer's own session loaded. Every scene now arrives through
/// [`fleetscope_load`], which is the only path that exists.
const EMPTY_MANIFEST: &str = r#"{
  "manifestVersion": "1.0.0",
  "caseId": "",
  "adapterId": "zoetrope-claude-jsonl@1.0.0",
  "rendererEntryCount": 0,
  "firstCaseSequence": 0,
  "lastCaseSequence": 0,
  "entries": []
}"#;

/// The DOM element the WebGl2 grid fills. `apps/web` owns everything around it
/// and writes nothing inside it, so the renderer owns its subtree entirely.
const CONTAINER: &str = "fleetscope-cockpit-canvas";
/// Rows moved per PageUp/PageDown in the detail panel.
const PAGE_SCROLL: i32 = 10;

thread_local! {
    /// The live Cockpit, shared with the render loop. The JS-callable functions
    /// below swap or mutate it in place and the next animation frame draws the
    /// change. wasm is single-threaded, so these never interleave with a frame
    /// mid-borrow.
    static COCKPIT: RefCell<Option<Rc<RefCell<Cockpit>>>> = const { RefCell::new(None) };
}

fn parse_subagents(json: &str) -> Vec<SubagentFile> {
    if json.trim().is_empty() {
        return Vec::new();
    }
    serde_json::from_str(json).unwrap_or_default()
}

fn empty_scene() -> Result<Scene, String> {
    Ok(Scene {
        main: String::new(),
        subagents: Vec::new(),
        manifest: RenderManifest::parse(EMPTY_MANIFEST).map_err(|e| e.to_string())?,
    })
}

fn main() -> io::Result<()> {
    console_error_panic_hook::set_once();

    let cockpit = Cockpit::load(empty_scene().map_err(io::Error::other)?)
        .map_err(|e| io::Error::other(e.to_string()))?;
    let cockpit = Rc::new(RefCell::new(cockpit));
    COCKPIT.with(|cell| *cell.borrow_mut() = Some(cockpit.clone()));

    let last_tick = Rc::new(RefCell::new(Instant::now()));
    // Wheel events carry no grid position, so remember the last hovered cell from
    // pointer moves to anchor the zoom.
    let last_cell = Rc::new(Cell::new((0u16, 0u16)));

    // Dynamic font atlas: rasterize glyphs on demand from the browser's own
    // monospace font rather than a prebuilt static atlas, which bakes only a fixed
    // set of Unicode ranges — the status and marker glyphs would render blank.
    const MONO: &[&str] = &[
        "ui-monospace",
        "SF Mono",
        "Fira Code",
        "JetBrains Mono",
        "Menlo",
        "Consolas",
        "monospace",
    ];
    let backend = WebGl2Backend::new_with_options(
        WebGl2BackendOptions::new()
            .grid_id(CONTAINER)
            .font_atlas_config(FontAtlasConfig::dynamic(MONO, 16.0))
            .canvas_padding_color(ratatui::style::Color::Indexed(233)),
    )?;
    let mut terminal = ratatui::Terminal::new(backend)?;

    let _ = terminal.on_key_event({
        let cockpit = cockpit.clone();
        move |key: RKeyEvent| handle_key(key, &mut cockpit.borrow_mut())
    });

    let _ = terminal.on_mouse_event({
        let cockpit = cockpit.clone();
        let last_cell = last_cell.clone();
        // ratzilla reports moves without button state; track press/release so a
        // drag (pan / scrubber seek) is distinguishable from a hover.
        let mut held = false;
        move |ev: RMouseEvent| {
            match ev.kind {
                RMouseKind::ButtonDown(_) => held = true,
                RMouseKind::ButtonUp(_) => held = false,
                RMouseKind::SingleClick(_)
                | RMouseKind::DoubleClick(_)
                | RMouseKind::Entered
                | RMouseKind::Exited => return,
                _ => {}
            }
            last_cell.set((ev.col, ev.row));
            handle_mouse(&ev, held, &mut cockpit.borrow_mut());
        }
    });

    install_wheel(cockpit.clone(), last_cell.clone());

    terminal.draw_web({
        let cockpit = cockpit.clone();
        let last_tick = last_tick.clone();
        move |frame| {
            let now = Instant::now();
            let elapsed = now.duration_since(*last_tick.borrow());
            *last_tick.borrow_mut() = now;

            let mut cockpit = cockpit.borrow_mut();
            let historical = cockpit.snapshot().transport.is_historical();
            let app = cockpit.app_mut();

            // HISTORICAL HONESTY (docs/requirements/fleetscope/fleet-cockpit.md).
            //
            // Zoetrope's presentation-time ticks drive the marching-ants edge
            // animation and the camera glide, which read as "something is running
            // right now". While the operator is parked in the past nothing IS
            // running, so those ticks are skipped and the animation phase freezes.
            //
            // This is a WRAPPER-level fix on purpose: it needs no change to the
            // vendored renderer, so upstream stays rebasable. `tick_timeline` and
            // `status_tick` still run — they advance the playhead and the status
            // line, neither of which implies live execution.
            if !historical {
                let _ = app.flow.tick_auto_pan(elapsed);
                app.flow.tick_animation(elapsed);
                app.tick_camera(elapsed);
            }
            app.tick_timeline(elapsed);
            app.status_tick();
            zoetrope::ui::draw(frame, app);
        }
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// The FleetScope browser ABI
//
// These are the ONLY functions apps/web may call, and they are wrapped on the
// TypeScript side by src/features/cockpit/lib/cockpit-adapter.ts so no other
// frontend code depends on generated bindings.
// ---------------------------------------------------------------------------

fn with_cockpit<T>(f: impl FnOnce(&mut Cockpit) -> T) -> Option<T> {
    COCKPIT.with(|cell| cell.borrow().as_ref().map(|rc| f(&mut rc.borrow_mut())))
}

/// Load a compiled Case, replacing whatever is showing.
///
/// Takes the three compiled artifacts the Scenario Compiler emits. The manifest
/// is not optional: without it there is no honest way to translate a cursor.
#[wasm_bindgen]
pub fn fleetscope_load(
    main: String,
    subagents_json: String,
    manifest_json: String,
) -> Result<(), JsError> {
    let manifest = RenderManifest::parse(&manifest_json)
        .map_err(|e| JsError::new(&format!("render manifest: {e}")))?;
    let next = Cockpit::load(Scene {
        main,
        subagents: parse_subagents(&subagents_json),
        manifest,
    })
    .map_err(|e| JsError::new(&e.to_string()))?;

    COCKPIT.with(|cell| {
        if let Some(rc) = cell.borrow().as_ref() {
            *rc.borrow_mut() = next;
        }
    });
    Ok(())
}

/// Append newly compiled evidence at the live edge.
///
/// A historical cursor is deliberately NOT moved — the operator decides when to
/// return to live. The manifest delta is applied first, so a malformed append is
/// refused before it can desynchronize the timeline from the manifest.
#[wasm_bindgen]
pub fn fleetscope_append(
    main_tail: String,
    subagents_json: String,
    manifest_entries_json: String,
) -> Result<(), JsError> {
    let entries: Vec<RenderManifestEntry> = if manifest_entries_json.trim().is_empty() {
        Vec::new()
    } else {
        serde_json::from_str(&manifest_entries_json)
            .map_err(|e| JsError::new(&format!("manifest delta: {e}")))?
    };
    let subagents = parse_subagents(&subagents_json);

    with_cockpit(|cockpit| cockpit.append(&main_tail, &subagents, entries))
        .ok_or_else(|| JsError::new("cockpit is not initialized"))?
        .map_err(|e| JsError::new(&e.to_string()))?;
    Ok(())
}

/// Seek to a fraction of the renderer timeline. This is the SCRUBBER's unit —
/// the fraction is the user's own input. To move to a Canonical Event, use
/// [`fleetscope_seek_case_sequence`], which resolves through the manifest.
#[wasm_bindgen]
pub fn fleetscope_seek(fraction: f64) {
    with_cockpit(|cockpit| cockpit.seek_fraction(fraction));
}

/// Move the cursor to the renderer entries a Canonical Event produced.
///
/// The correct path from FleetScope evidence to a renderer position. Resolved
/// through the Render Manifest, never as `caseSequence / lastCaseSequence`:
/// one event may produce zero, one, or several renderer entries, so the ratio is
/// wrong by an amount nothing measures. Returns false if the Case rendered
/// nothing at all.
///
/// # Why `u32` and not `u64`
///
/// wasm-bindgen marshals a `u64` as a JavaScript **BigInt**, so a plain
/// `fleetscope_seek_case_sequence(15)` from JS throws
/// "Cannot convert 15 to a BigInt" — at the call site, silently failing the
/// seek while the DOM cursor moves anyway. A `caseSequence` is a dense index
/// into one Case; `u32` is ample for any Case a human will inspect, and it
/// crosses the boundary as an ordinary number. The manifest keeps `u64`
/// internally and this widens.
#[wasm_bindgen]
pub fn fleetscope_seek_case_sequence(case_sequence: u32) -> bool {
    with_cockpit(|cockpit| cockpit.seek_to_case_sequence(u64::from(case_sequence))).unwrap_or(false)
}

#[wasm_bindgen]
pub fn fleetscope_go_live() {
    with_cockpit(|cockpit| cockpit.go_live());
}

#[wasm_bindgen]
pub fn fleetscope_select(node_id: String) {
    with_cockpit(|cockpit| {
        cockpit.app_mut().pending_center = Some(node_id);
    });
}

/// The renderer's own position and transport, as JSON.
///
/// Reports renderer units only. `caseSequence` and the canonical unread count
/// are FleetScope's and stay FleetScope's; the shell maps this back through the
/// Render Manifest.
#[wasm_bindgen]
pub fn fleetscope_snapshot() -> String {
    with_cockpit(|cockpit| serde_json::to_string(&cockpit.snapshot()).unwrap_or_default())
        .unwrap_or_else(|| "{}".to_owned())
}

/// The Canonical Event the renderer cursor currently rests on, as JSON, or
/// `null`. The reverse lookup that lets the shell follow a scrub.
#[wasm_bindgen]
pub fn fleetscope_current_event() -> String {
    with_cockpit(|cockpit| {
        cockpit
            .current_manifest_entry()
            .and_then(|entry| serde_json::to_string(entry).ok())
            .unwrap_or_else(|| "null".to_owned())
    })
    .unwrap_or_else(|| "null".to_owned())
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/// Map a browser key to an action, mirroring the native handler: transport,
/// camera and overlay keys act directly; navigation and viewport keys forward to
/// the flow.
fn handle_key(key: RKeyEvent, cockpit: &mut Cockpit) {
    use zoetrope::state::Camera;

    let app = cockpit.app_mut();
    match key.code {
        RKeyCode::Char(' ') => return app.toggle_play_pause(),
        RKeyCode::End | RKeyCode::Char('g') | RKeyCode::Char('G') => return app.go_live(),
        RKeyCode::Char('[') => return app.seek_prompt(false),
        RKeyCode::Char(']') => return app.seek_prompt(true),

        RKeyCode::Char('s') | RKeyCode::Char('S') => {
            app.timeline.compress_gaps = !app.timeline.compress_gaps;
            return;
        }

        RKeyCode::Char('o') | RKeyCode::Char('O') => {
            app.camera = Camera::Overview;
            app.camera_glide = None;
            app.flow.request_fit_view();
            return;
        }
        RKeyCode::Char('f') | RKeyCode::Char('F') => {
            app.camera = Camera::Follow;
            app.track_activity();
            return;
        }
        RKeyCode::Char('r') | RKeyCode::Char('R') => return app.relayout_now(),

        RKeyCode::Char('i') | RKeyCode::Char('I') => {
            app.show_info = !app.show_info;
            return;
        }
        RKeyCode::Char('?') => {
            app.show_help = !app.show_help;
            return;
        }

        RKeyCode::Char('j') if scroll_detail(app, 1) => return,
        RKeyCode::Char('k') if scroll_detail(app, -1) => return,
        RKeyCode::PageDown if scroll_detail(app, PAGE_SCROLL) => return,
        RKeyCode::PageUp if scroll_detail(app, -PAGE_SCROLL) => return,

        RKeyCode::Esc => {
            if app.show_help {
                app.show_help = false;
            } else if app.show_info {
                app.show_info = false;
            } else if app.camera != Camera::Follow {
                app.flow.clear_selection();
                app.detail_scroll = 0;
                app.detail_follow = true;
            }
            return;
        }
        _ => {}
    }

    let fk: rataflow::KeyEvent = key.clone().into();
    let response = match key.code {
        RKeyCode::Tab | RKeyCode::Up | RKeyCode::Down | RKeyCode::Left | RKeyCode::Right => {
            app.flow.handle_key_event(fk)
        }
        RKeyCode::Char('+' | '=' | '-' | '_' | '0') => app.flow.handle_controls_key_event(fk),
        RKeyCode::Char('h' | 'j' | 'k' | 'l' | 'c') => app.flow.handle_key_event(fk),
        _ => return,
    };
    let events: Vec<_> = response.into_events().collect();
    app.process_flow_events(events.into_iter());
}

/// Scroll the detail panel by `delta`. Returns true when an agent is selected
/// (key consumed); false lets it fall through to panning the graph.
fn scroll_detail(app: &mut zoetrope::state::App, delta: i32) -> bool {
    if app.selected_agent_id().is_none() {
        return false;
    }
    if delta < 0 {
        app.detail_follow = false;
    }
    app.detail_scroll = (app.detail_scroll as i32 + delta).max(0) as u16;
    true
}

/// A press or drag on the scrubber row seeks the playhead; everything else pans
/// or selects in the flow.
fn handle_mouse(ev: &RMouseEvent, held: bool, cockpit: &mut Cockpit) {
    let app = cockpit.app_mut();
    let pressed = matches!(ev.kind, RMouseKind::ButtonDown(RMouseButton::Left));
    let moving = !matches!(ev.kind, RMouseKind::ButtonDown(_) | RMouseKind::ButtonUp(_));

    if let Some(bar) = app.scrubber_area {
        if (pressed || (held && moving))
            && ev.row >= bar.y
            && ev.row < bar.y + bar.height
            && bar.width > 1
        {
            let rel = ev.col.saturating_sub(bar.x).min(bar.width - 1);
            // Queue rather than seek now: a drag delivers many events per frame
            // and a backward seek rebuilds the whole model, so the animation-frame
            // tick applies only the latest target.
            app.pending_seek = Some(rel as f64 / (bar.width - 1) as f64);
            return;
        }
    }

    let mut me: rataflow::MouseEvent = ev.clone().into();
    // ratzilla moves carry no button state, so synthesize the drag the flow needs.
    if held && matches!(me.kind, rataflow::MouseEventKind::Moved) {
        me.kind = rataflow::MouseEventKind::Drag(rataflow::MouseButton::Left);
    }
    let events: Vec<_> = app.flow.handle_mouse_event(me).into_events().collect();
    app.process_flow_events(events.into_iter());
}

/// Wheel → zoom at the last hovered cell. ratzilla does not surface wheel through
/// `on_mouse_event`, so listen on the container directly.
fn install_wheel(cockpit: Rc<RefCell<Cockpit>>, last_cell: Rc<Cell<(u16, u16)>>) {
    let Some(container) = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.get_element_by_id(CONTAINER))
    else {
        return;
    };
    let closure = Closure::<dyn Fn(web_sys::WheelEvent)>::new(move |e: web_sys::WheelEvent| {
        e.prevent_default();
        if e.delta_y() == 0.0 {
            return;
        }
        let (column, row) = last_cell.get();
        let mut cockpit = cockpit.borrow_mut();
        let app = cockpit.app_mut();
        // `handle_wheel` normalizes browser wheel frequency and deltaMode into
        // discrete zoom notches, so wasm zoom matches the native scroll feel.
        let events: Vec<_> = app
            .flow
            .handle_wheel(e.delta_y(), e.delta_mode(), column, row)
            .into_events()
            .collect();
        app.process_flow_events(events.into_iter());
    });
    let _ = container.add_event_listener_with_callback("wheel", closure.as_ref().unchecked_ref());
    closure.forget();
}
