//! The browser ABI.
//!
//! These are the only functions `apps/web` is allowed to call, and they are
//! wrapped on the TypeScript side by
//! `apps/web/src/features/cockpit/lib/cockpit-adapter.ts` so no other frontend
//! code depends on generated bindings.
//!
//! Names mirror `docs/design/budget-demo.md`. Nothing speculative is exported:
//! `fleetscope_select` is included because the adapter already treats it as
//! optional, and anything beyond this set waits for a real requirement.

use std::cell::RefCell;

use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::cursor::Cursor;
use crate::transcript::{Transcript, TranscriptEntry};

thread_local! {
    static STATE: RefCell<CockpitState> = RefCell::new(CockpitState::default());
}

#[derive(Default)]
struct CockpitState {
    transcript: Transcript,
    cursor: Cursor,
    selected_node_id: Option<String>,
}

#[derive(Serialize)]
struct Snapshot {
    #[serde(rename = "caseId")]
    case_id: Option<String>,
    #[serde(rename = "caseSequence")]
    case_sequence: u64,
    #[serde(rename = "entryIndex")]
    entry_index: usize,
    #[serde(rename = "entryCount")]
    entry_count: usize,
    #[serde(rename = "atEdge")]
    at_edge: bool,
    unread: usize,
    #[serde(rename = "selectedNodeId")]
    selected_node_id: Option<String>,
}

#[wasm_bindgen]
pub fn fleetscope_load(transcript_jsonl: &str) -> Result<(), JsError> {
    let transcript =
        Transcript::parse_jsonl(transcript_jsonl).map_err(|e| JsError::new(&e.to_string()))?;
    STATE.with(|state| {
        let mut state = state.borrow_mut();
        state.cursor = Cursor::new(transcript.len());
        state.transcript = transcript;
        state.selected_node_id = None;
    });
    Ok(())
}

#[wasm_bindgen]
pub fn fleetscope_append(entry_json: &str) -> Result<(), JsError> {
    let entry: TranscriptEntry =
        serde_json::from_str(entry_json).map_err(|e| JsError::new(&e.to_string()))?;
    STATE.with(|state| {
        let mut state = state.borrow_mut();
        state.transcript.append_entry(entry);
        state.cursor.on_appended();
    });
    Ok(())
}

#[wasm_bindgen]
pub fn fleetscope_seek(fraction: f64) -> Result<(), JsError> {
    STATE.with(|state| {
        state
            .borrow_mut()
            .cursor
            .seek_fraction(fraction)
            .map(|_| ())
            .map_err(|e| JsError::new(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn fleetscope_go_live() {
    STATE.with(|state| {
        state.borrow_mut().cursor.go_live();
    });
}

#[wasm_bindgen]
pub fn fleetscope_select(node_id: &str) {
    STATE.with(|state| {
        state.borrow_mut().selected_node_id = Some(node_id.to_owned());
    });
}

#[wasm_bindgen]
pub fn fleetscope_snapshot() -> String {
    STATE.with(|state| {
        let state = state.borrow();
        let entry = state.transcript.entries.get(state.cursor.index());
        let snapshot = Snapshot {
            case_id: state.transcript.header.as_ref().map(|h| h.case_id.clone()),
            case_sequence: entry.map(|e| e.fleetscope.case_sequence).unwrap_or(0),
            entry_index: state.cursor.index(),
            entry_count: state.cursor.len(),
            at_edge: state.cursor.at_edge(),
            unread: state.cursor.unread(),
            selected_node_id: state.selected_node_id.clone(),
        };
        serde_json::to_string(&snapshot).unwrap_or_else(|_| "{}".to_owned())
    })
}
