//! Transcript parsing and append ordering.

use fleet_cockpit::transcript::{Transcript, TranscriptEntry, TranscriptError};

fn header() -> &'static str {
    r#"{"type":"header","transcriptVersion":"fleetscope-interim-1","caseId":"CASE-1042","agents":[{"id":"case-root","role":"case","label":"CASE-1042","parentId":null}]}"#
}

fn entry(index: usize, case_sequence: u64) -> String {
    format!(
        r#"{{"type":"entry","index":{index},"agentId":"case-root","kind":"status","label":"runtime.started","timestamp":"2026-08-26T09:00:00.000Z","fleetscope":{{"eventId":"evt-{index:04}","caseSequence":{case_sequence},"sessionId":"sess-001","eventType":"runtime.started"}}}}"#
    )
}

#[test]
fn parses_a_header_and_entries() {
    let input = format!("{}\n{}\n{}\n", header(), entry(0, 0), entry(1, 1));
    let transcript = Transcript::parse_jsonl(&input).unwrap();

    assert_eq!(transcript.header.unwrap().case_id, "CASE-1042");
    assert_eq!(transcript.entries.len(), 2);
    assert_eq!(transcript.entries[0].fleetscope.event_id, "evt-0000");
}

#[test]
fn rejects_a_transcript_with_no_header() {
    let input = format!("{}\n", entry(0, 0));
    assert_eq!(
        Transcript::parse_jsonl(&input),
        Err(TranscriptError::MissingHeader)
    );
}

#[test]
fn reports_the_failing_line_number() {
    let input = format!("{}\n{{\"type\":\"entry\"}}\n", header());
    match Transcript::parse_jsonl(&input) {
        Err(TranscriptError::InvalidLine { line, .. }) => assert_eq!(line, 2),
        other => panic!("expected InvalidLine, got {other:?}"),
    }
}

#[test]
fn skips_blank_lines() {
    let input = format!("{}\n\n{}\n\n", header(), entry(0, 0));
    assert_eq!(Transcript::parse_jsonl(&input).unwrap().entries.len(), 1);
}

#[test]
fn orders_entries_by_case_sequence_regardless_of_file_order() {
    let input = format!(
        "{}\n{}\n{}\n{}\n",
        header(),
        entry(2, 7),
        entry(0, 1),
        entry(1, 4)
    );
    let transcript = Transcript::parse_jsonl(&input).unwrap();

    let sequences: Vec<u64> = transcript
        .entries
        .iter()
        .map(|e| e.fleetscope.case_sequence)
        .collect();
    assert_eq!(sequences, vec![1, 4, 7]);
}

#[test]
fn a_late_append_is_inserted_at_its_canonical_position() {
    let input = format!("{}\n{}\n{}\n", header(), entry(0, 1), entry(1, 9));
    let mut transcript = Transcript::parse_jsonl(&input).unwrap();

    let late: TranscriptEntry = serde_json::from_str(&entry(2, 5)).unwrap();
    transcript.append_entry(late);

    let sequences: Vec<u64> = transcript
        .entries
        .iter()
        .map(|e| e.fleetscope.case_sequence)
        .collect();
    assert_eq!(
        sequences,
        vec![1, 5, 9],
        "a late event must not reorder the timeline"
    );
}

#[test]
fn reports_the_last_case_sequence() {
    let input = format!("{}\n{}\n{}\n", header(), entry(0, 3), entry(1, 11));
    assert_eq!(
        Transcript::parse_jsonl(&input)
            .unwrap()
            .last_case_sequence(),
        Some(11)
    );
}

#[test]
fn translates_a_case_sequence_into_an_entry_index() {
    let input = format!(
        "{}\n{}\n{}\n{}\n",
        header(),
        entry(0, 0),
        entry(1, 5),
        entry(2, 10)
    );
    let transcript = Transcript::parse_jsonl(&input).unwrap();

    assert_eq!(transcript.index_of_case_sequence(5), Some(1));
    // A marker between entries resolves forward to the next recorded event.
    assert_eq!(transcript.index_of_case_sequence(6), Some(2));
    assert_eq!(transcript.index_of_case_sequence(99), None);
}

#[test]
fn tolerates_unknown_fields_so_the_compiler_can_evolve() {
    let extended = r#"{"type":"entry","index":0,"agentId":"case-root","kind":"status","label":"x","timestamp":"2026-08-26T09:00:00.000Z","futureField":42,"fleetscope":{"eventId":"evt-0000","caseSequence":0,"sessionId":null,"eventType":"case.created"}}"#;
    let input = format!("{}\n{}\n", header(), extended);
    assert_eq!(Transcript::parse_jsonl(&input).unwrap().entries.len(), 1);
}
