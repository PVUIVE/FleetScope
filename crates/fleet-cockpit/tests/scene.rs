//! The Cockpit integration proof.
//!
//! Loads the blessed CASE-1042 renderer artifacts — the exact bytes the browser
//! loads and the exact bytes `pnpm fixtures:bless` writes — folds them through
//! the vendored Zoetrope engine, and asserts what FleetScope claims about them.
//!
//! This runs on the HOST, in an ordinary `cargo test`. That is the point: the
//! claim "the compiled Case renders the graph FleetScope says it does" is
//! machine-checked before anything reaches a wasm build or a browser.

use std::path::{Path, PathBuf};

use fleet_cockpit::manifest::{RenderManifest, RenderManifestEntry, RenderOutcome};
use fleet_cockpit::scene::{Cockpit, Scene, SubagentFile, TransportState};

const CASE_ID: &str = "CASE-1042";

fn renderer_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/fixtures/cases")
        .join(CASE_ID)
        .join("renderer")
}

fn read(name: &str) -> String {
    let path = renderer_dir().join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{}: {e} — run `pnpm fixtures:bless`", path.display()))
}

fn scene() -> Scene {
    Scene {
        main: read("main.jsonl"),
        subagents: serde_json::from_str::<Vec<SubagentFile>>(&read("subagents.json"))
            .expect("subagents.json parses"),
        manifest: RenderManifest::parse(&read("render-manifest.json"))
            .expect("render-manifest.json parses"),
    }
}

fn cockpit() -> Cockpit {
    Cockpit::load(scene()).expect("the blessed scene loads")
}

// ── The load contract ───────────────────────────────────────────────────────

#[test]
fn the_blessed_manifest_is_internally_consistent() {
    assert_eq!(scene().manifest.validate(), Vec::<String>::new());
}

#[test]
fn the_timeline_folds_exactly_as_many_entries_as_the_manifest_declares() {
    // Every cursor translation assumes these agree. If the compiler and the
    // Zoetrope merge ever disagree about how many items a Case has, every seek
    // silently lands in the wrong place — so `Cockpit::load` refuses instead.
    let scene = scene();
    let declared = scene.manifest.renderer_entry_count;
    let cockpit = Cockpit::load(scene).expect("loads");
    assert_eq!(cockpit.renderer_entry_count(), declared);
}

#[test]
fn a_manifest_that_disagrees_with_the_timeline_is_rejected_at_load() {
    let mut scene = scene();
    // An internally CONSISTENT manifest that claims one more renderer entry than
    // the compiled transcripts actually contain. This is the dangerous shape: it
    // passes every structural check and still misaligns every cursor lookup.
    let start = scene.manifest.renderer_entry_count;
    let last_case_sequence = scene.manifest.last_case_sequence;
    scene
        .manifest
        .append_entries([RenderManifestEntry {
            event_id: "evt-phantom".to_owned(),
            case_sequence: last_case_sequence + 1,
            renderer_entry_start: start,
            renderer_entry_end: start as i64,
            renderer_entry_count: 1,
            renderer_fraction: 1.0,
            domain: "tool".to_owned(),
            outcome: RenderOutcome::Succeeded,
            label: "phantom".to_owned(),
            evidence_event_ids: vec!["evt-phantom".to_owned()],
        }])
        .expect("the appended entry is structurally valid");
    assert_eq!(scene.manifest.validate(), Vec::<String>::new());

    let Err(error) = Cockpit::load(scene) else {
        panic!("a manifest that disagrees with the timeline must not load");
    };
    assert!(
        error.to_string().contains("renderer entries"),
        "unexpected error: {error}"
    );
}

// ── The graph ───────────────────────────────────────────────────────────────

#[test]
fn the_delegated_logistics_agent_becomes_its_own_graph_node() {
    // Invariant 7 made visible: an allowed Gateway route produces a real child
    // node, not a label on the orchestrator.
    let cockpit = cockpit();
    let agents = &cockpit.app().session.agents;

    assert!(
        agents.contains_key("main"),
        "the orchestrator is the main node"
    );
    let child = agents
        .keys()
        .find(|id| id.as_str() != "main")
        .expect("the delegation produced a child agent node");
    assert_eq!(
        agents.len(),
        2,
        "CASE-1042 has exactly one delegation: {:?}",
        agents.keys().collect::<Vec<_>>()
    );
    assert_eq!(
        agents[child].parent.as_deref(),
        Some("main"),
        "the child hangs off the orchestrator that delegated to it"
    );
}

#[test]
fn the_recorded_case_opens_parked_at_its_live_edge() {
    let cockpit = cockpit();
    let snapshot = cockpit.snapshot();

    assert!(snapshot.at_edge, "a finished Case opens at its outcome");
    assert_eq!(
        snapshot.renderer_entry_index,
        snapshot.renderer_entry_count - 1
    );
    // A finished Case with no fresh appends reads Idle, never Live: "live" is
    // "following an edge that is still growing", not a property of the file.
    assert_eq!(snapshot.transport, TransportState::Idle);
}

// ── Cursor synchronization — manifest lookup, never sequence division ────────

#[test]
fn seeking_to_a_case_sequence_lands_on_the_entry_that_event_produced() {
    let mut cockpit = cockpit();
    let manifest = cockpit.manifest().clone();

    for expected in manifest
        .entries
        .iter()
        .filter(|e| e.renderer_entry_count > 0)
    {
        assert!(cockpit.seek_to_case_sequence(expected.case_sequence));
        let landed = cockpit
            .current_manifest_entry()
            .expect("a rendered position resolves back to an event");
        assert_eq!(
            landed.event_id, expected.event_id,
            "seek to caseSequence {} landed on {} ({}), expected {}",
            expected.case_sequence, landed.event_id, landed.label, expected.event_id
        );
    }
}

#[test]
fn the_forbidden_sequence_ratio_would_land_somewhere_else() {
    // The regression this whole design exists to prevent. 60 Canonical Events
    // compile to 69 renderer entries, so the two units are not proportional and
    // the ratio drifts. Proving the drift is real keeps the manifest honest.
    let manifest = scene().manifest;
    let last = manifest.last_case_sequence as f64;

    let mut disagreements = 0;
    for entry in manifest
        .entries
        .iter()
        .filter(|e| e.renderer_entry_count > 0)
    {
        let ratio = entry.case_sequence as f64 / last;
        if (ratio - entry.renderer_fraction).abs() > 1.0 / manifest.renderer_entry_count as f64 {
            disagreements += 1;
        }
    }
    assert!(
        disagreements > 0,
        "the sequence ratio must be demonstrably wrong, else this guard proves nothing"
    );
}

#[test]
fn every_renderer_index_resolves_back_to_a_canonical_event() {
    let manifest = scene().manifest;
    for index in 0..manifest.renderer_entry_count {
        assert!(
            manifest.entry_for_renderer_index(index).is_some(),
            "renderer entry {index} has no canonical event"
        );
    }
}

#[test]
fn seeking_leaves_the_edge_and_going_live_returns_to_it() {
    let mut cockpit = cockpit();
    cockpit.seek_fraction(0.0);
    assert!(!cockpit.snapshot().at_edge);
    assert_eq!(cockpit.snapshot().renderer_entry_index, 0);

    cockpit.go_live();
    let snapshot = cockpit.snapshot();
    assert!(snapshot.at_edge);
    assert_eq!(
        snapshot.renderer_entry_index,
        snapshot.renderer_entry_count - 1
    );
}

#[test]
fn a_non_finite_or_out_of_range_seek_cannot_move_the_cursor_out_of_bounds() {
    let mut cockpit = cockpit();
    for fraction in [f64::NAN, f64::INFINITY, -1.0, 2.0] {
        cockpit.seek_fraction(fraction);
        let snapshot = cockpit.snapshot();
        assert!(
            snapshot.renderer_entry_index < snapshot.renderer_entry_count,
            "fraction {fraction} moved the cursor out of bounds"
        );
    }
}

// ── The snapshot contract ───────────────────────────────────────────────────

#[test]
fn the_snapshot_reports_renderer_units_and_never_canonical_ones() {
    // FleetScope owns caseSequence, the Case high-water mark and therefore the
    // canonical unread count. A renderer that answered in those units would make
    // a rendering detail authoritative over the audit spine.
    let json = serde_json::to_string(&cockpit().snapshot()).expect("serializes");
    for forbidden in ["caseSequence", "unread", "eventId", "highWater"] {
        assert!(
            !json.contains(forbidden),
            "the snapshot must not carry `{forbidden}`: {json}"
        );
    }
    for required in [
        "rendererEntryIndex",
        "rendererEntryCount",
        "atEdge",
        "transport",
    ] {
        assert!(
            json.contains(required),
            "the snapshot must carry `{required}`: {json}"
        );
    }
}

#[test]
fn scrubbing_back_reports_history_so_the_shell_can_say_so() {
    let mut cockpit = cockpit();
    cockpit.seek_fraction(0.25);
    let snapshot = cockpit.snapshot();

    assert_eq!(snapshot.transport, TransportState::History);
    assert!(
        snapshot.transport.is_historical(),
        "historical mode must be distinguishable so the view can stop looking live"
    );
    assert!(!snapshot.at_edge);
}

// ── Semantic fidelity ───────────────────────────────────────────────────────

#[test]
fn a_policy_denial_is_not_recorded_as_a_tool_failure() {
    let manifest = scene().manifest;

    let identity_denied = manifest
        .entries
        .iter()
        .find(|e| e.domain == "identity" && e.outcome == RenderOutcome::Denied)
        .expect("CASE-1042 records an Identity denial");
    assert!(
        identity_denied.label.contains("Identity denied"),
        "Decision Evidence must name the denial, not a generic failure: {}",
        identity_denied.label
    );

    let gateway_denied = manifest
        .entries
        .iter()
        .find(|e| e.domain == "gateway" && e.outcome == RenderOutcome::Denied)
        .expect("CASE-1042 records a Gateway denial");
    assert!(gateway_denied.label.contains("Gateway denied"));

    // Both draw with error styling because Zoetrope has no `denied` state, and
    // both stay distinct from an execution failure in the evidence.
    for entry in [identity_denied, gateway_denied] {
        assert!(entry.outcome.is_error_styled());
        assert_ne!(entry.outcome, RenderOutcome::Failed);
    }
}

#[test]
fn an_armor_block_is_distinct_from_both_denial_and_failure() {
    let manifest = scene().manifest;
    let blocked = manifest
        .entries
        .iter()
        .find(|e| e.outcome == RenderOutcome::Blocked)
        .expect("CASE-1042 blocks a malicious vendor input");

    assert_eq!(blocked.domain, "armor");
    assert!(blocked.label.contains("Armor blocked"));
    assert_ne!(blocked.outcome, RenderOutcome::Denied);
    assert_ne!(blocked.outcome, RenderOutcome::Failed);
}

#[test]
fn a_real_execution_failure_is_the_only_thing_recorded_as_failed() {
    let manifest = scene().manifest;
    let failures: Vec<_> = manifest
        .entries
        .iter()
        .filter(|e| e.outcome == RenderOutcome::Failed)
        .collect();

    assert!(
        !failures.is_empty(),
        "CASE-1042 records repeated tool failures"
    );
    for entry in failures {
        assert_eq!(
            entry.domain, "tool",
            "only an execution failure may be `failed`, got {} ({})",
            entry.label, entry.domain
        );
    }
}

#[test]
fn one_canonical_event_may_produce_zero_one_or_many_renderer_entries() {
    let manifest = scene().manifest;
    let counts: Vec<usize> = manifest
        .entries
        .iter()
        .map(|e| e.renderer_entry_count)
        .collect();

    assert!(
        counts.contains(&0),
        "some events draw nothing (usage, milestones)"
    );
    assert!(counts.contains(&1), "some events draw exactly one item");
    assert!(
        counts.iter().any(|&c| c > 1),
        "some events draw several — this is what breaks the sequence ratio"
    );
    // And the lookup still works across all three shapes.
    for entry in manifest.entries.iter() {
        assert!(manifest
            .entry_for_case_sequence(entry.case_sequence)
            .is_some());
    }
}

// ── Renderer-safe minimization ──────────────────────────────────────────────

#[test]
fn no_reasoning_prompt_or_secret_reaches_the_compiled_transcripts() {
    // The PRIMARY control for the upstream provenance panel, which renders
    // `↳ prompt` and `↳ thought` rows from exactly these fields. The vendored
    // panel patch is defence in depth; this is the thing that makes it moot.
    let mut artifacts = vec![read("main.jsonl")];
    for sub in serde_json::from_str::<Vec<SubagentFile>>(&read("subagents.json")).unwrap() {
        artifacts.push(sub.meta);
        artifacts.push(sub.transcript);
    }

    for artifact in artifacts {
        for forbidden in [
            "\"thinking\"",
            "\"prompt\"",
            "\"reasoning\"",
            "chain_of_thought",
            "-----BEGIN",
            "Bearer ",
            "/Users/",
            "/home/",
        ] {
            assert!(
                !artifact.contains(forbidden),
                "a compiled renderer artifact contains `{forbidden}`"
            );
        }
    }
}

// ── Live append and the historical-cursor rule ──────────────────────────────

/// One extra renderer line plus its manifest entry, continuing the blessed Case.
fn appended_evidence(manifest: &RenderManifest) -> (String, RenderManifestEntry) {
    let start = manifest.renderer_entry_count;
    let line = format!(
        r#"{{"type":"assistant","uuid":"fs-append-1","parentUuid":null,"timestamp":"2026-09-08T11:00:00.000000{start:03}Z","sessionId":"CASE-1042","message":{{"role":"assistant","content":[{{"type":"text","text":"Case archived"}}]}}}}"#
    );
    let entry = RenderManifestEntry {
        event_id: "evt-0061".to_owned(),
        case_sequence: manifest.last_case_sequence + 1,
        renderer_entry_start: start,
        renderer_entry_end: start as i64,
        renderer_entry_count: 1,
        renderer_fraction: 1.0,
        domain: "case".to_owned(),
        outcome: RenderOutcome::Informational,
        label: "Case archived".to_owned(),
        evidence_event_ids: vec!["evt-0061".to_owned()],
    };
    (line, entry)
}

#[test]
fn an_append_extends_both_the_timeline_and_the_manifest_together() {
    let mut cockpit = cockpit();
    let before = cockpit.renderer_entry_count();
    let (line, entry) = appended_evidence(cockpit.manifest());

    let added = cockpit.append(&line, &[], vec![entry]).expect("appends");

    assert_eq!(added, 1);
    assert_eq!(cockpit.renderer_entry_count(), before + 1);
    assert_eq!(cockpit.manifest().renderer_entry_count, before + 1);
    assert_eq!(cockpit.manifest().validate(), Vec::<String>::new());
}

#[test]
fn an_event_arriving_during_historical_inspection_does_not_move_the_cursor() {
    // The rule an investigator depends on: new evidence never yanks the view
    // forward. FleetScope counts it as canonical unread instead, and the operator
    // decides when to return to live.
    let mut cockpit = cockpit();
    cockpit.seek_fraction(0.3);
    let parked = cockpit.renderer_entry_index();
    assert!(!cockpit.snapshot().at_edge);

    let (line, entry) = appended_evidence(cockpit.manifest());
    cockpit.append(&line, &[], vec![entry]).expect("appends");

    assert_eq!(
        cockpit.renderer_entry_index(),
        parked,
        "an append moved a historical cursor"
    );
    assert!(!cockpit.snapshot().at_edge);
    assert_eq!(cockpit.snapshot().transport, TransportState::History);
}

#[test]
fn returning_to_live_after_an_append_lands_on_the_newest_evidence_and_skips_nothing() {
    let mut cockpit = cockpit();
    cockpit.seek_fraction(0.3);
    let (line, entry) = appended_evidence(cockpit.manifest());
    let appended_event_id = entry.event_id.clone();
    cockpit.append(&line, &[], vec![entry]).expect("appends");

    cockpit.go_live();
    let snapshot = cockpit.snapshot();

    assert!(snapshot.at_edge);
    assert_eq!(
        snapshot.renderer_entry_index,
        snapshot.renderer_entry_count - 1
    );
    assert_eq!(
        cockpit
            .current_manifest_entry()
            .map(|e| e.event_id.as_str()),
        Some(appended_event_id.as_str()),
        "returning to live must land on the newest accepted evidence"
    );
}

#[test]
fn an_append_that_leaves_a_hole_in_the_manifest_is_refused() {
    let mut cockpit = cockpit();
    let (line, mut entry) = appended_evidence(cockpit.manifest());
    entry.renderer_entry_start += 5; // a hole
    entry.renderer_entry_end += 5;

    let Err(error) = cockpit.append(&line, &[], vec![entry]) else {
        panic!("an append that leaves a hole must be refused");
    };
    assert!(error.to_string().contains("timeline ends at"), "{error}");
    // And the refusal happened before anything reached the timeline.
    assert_eq!(cockpit.manifest().validate(), Vec::<String>::new());
}

#[test]
fn seeking_after_an_append_still_resolves_through_the_manifest() {
    let mut cockpit = cockpit();
    let (line, entry) = appended_evidence(cockpit.manifest());
    cockpit.append(&line, &[], vec![entry]).expect("appends");

    // Growing the timeline changes every fraction's denominator. Recomputing
    // rather than trusting the compile-time value is what keeps this true.
    let manifest = cockpit.manifest().clone();
    for expected in manifest
        .entries
        .iter()
        .filter(|e| e.renderer_entry_count > 0)
    {
        assert!(cockpit.seek_to_case_sequence(expected.case_sequence));
        assert_eq!(
            cockpit
                .current_manifest_entry()
                .map(|e| e.event_id.as_str()),
            Some(expected.event_id.as_str()),
            "caseSequence {} misresolved after an append",
            expected.case_sequence
        );
    }
}

// ── Product naming ──────────────────────────────────────────────────────────

#[test]
fn the_orchestrator_node_is_not_labelled_with_an_unrelated_product() {
    // Upstream titles the main node "claude", which is right for a Claude Code
    // session visualizer and wrong on a governed enterprise audit surface.
    let cockpit = cockpit();
    let flow = &cockpit.app().flow;

    let titles: Vec<String> = cockpit
        .app()
        .session
        .agents
        .keys()
        .filter_map(|id| flow.node(id))
        .map(|node| node.content.title.clone())
        .collect();

    assert!(!titles.is_empty(), "the graph has nodes to inspect");
    for title in &titles {
        assert!(
            !title.to_lowercase().contains("claude"),
            "a node is labelled with an unrelated product: {titles:?}"
        );
    }
    assert!(
        titles.iter().any(|t| t == "orchestrator"),
        "the main node is the orchestrator: {titles:?}"
    );
}
