//! Event Cursor behavior. These are the rules the Cockpit UI must not regress.

use fleet_cockpit::cursor::{Cursor, CursorError};

#[test]
fn a_new_cursor_follows_the_live_edge() {
    let cursor = Cursor::new(10);
    assert_eq!(cursor.index(), 9);
    assert!(cursor.at_edge());
    assert_eq!(cursor.unread(), 0);
}

#[test]
fn seeking_leaves_live_mode() {
    let mut cursor = Cursor::new(10);
    cursor.seek_fraction(0.0).unwrap();
    assert_eq!(cursor.index(), 0);
    assert!(!cursor.at_edge());
}

#[test]
fn seek_to_one_lands_exactly_on_the_last_event() {
    let mut cursor = Cursor::new(59);
    assert_eq!(cursor.seek_fraction(1.0).unwrap(), 58);
    assert!(cursor.at_edge());
}

#[test]
fn seek_rejects_out_of_range_and_non_finite_fractions() {
    let mut cursor = Cursor::new(10);
    assert_eq!(
        cursor.seek_fraction(1.5),
        Err(CursorError::FractionOutOfRange)
    );
    assert_eq!(
        cursor.seek_fraction(-0.1),
        Err(CursorError::FractionOutOfRange)
    );
    assert_eq!(
        cursor.seek_fraction(f64::NAN),
        Err(CursorError::FractionOutOfRange)
    );
    assert_eq!(
        cursor.seek_fraction(f64::INFINITY),
        Err(CursorError::FractionOutOfRange)
    );
    // A rejected seek must not move the cursor.
    assert_eq!(cursor.index(), 9);
}

#[test]
fn an_empty_transcript_cannot_be_seeked() {
    let mut cursor = Cursor::new(0);
    assert_eq!(cursor.seek_fraction(0.5), Err(CursorError::EmptyTranscript));
    assert!(cursor.is_empty());
}

#[test]
fn events_arriving_during_historical_inspection_do_not_move_the_cursor() {
    let mut cursor = Cursor::new(10);
    cursor.seek_index(3).unwrap();

    for _ in 0..5 {
        cursor.on_appended();
    }

    assert_eq!(
        cursor.index(),
        3,
        "the investigator's view must not be yanked forward"
    );
    assert_eq!(cursor.unread(), 5);
    assert_eq!(cursor.len(), 15);
}

#[test]
fn a_live_cursor_follows_appends_without_accruing_unread() {
    let mut cursor = Cursor::new(10);
    cursor.on_appended();
    assert_eq!(cursor.index(), 10);
    assert_eq!(cursor.unread(), 0);
}

#[test]
fn returning_to_live_clears_unread_and_skips_nothing() {
    let mut cursor = Cursor::new(10);
    cursor.seek_index(2).unwrap();
    cursor.on_appended();
    cursor.on_appended();

    assert_eq!(cursor.go_live(), 11);
    assert_eq!(cursor.unread(), 0);
    assert!(cursor.at_edge());
    assert_eq!(cursor.len(), 12);
}

#[test]
fn seeking_back_to_the_edge_also_clears_unread() {
    let mut cursor = Cursor::new(5);
    cursor.seek_index(0).unwrap();
    cursor.on_appended();
    assert_eq!(cursor.unread(), 1);

    cursor.seek_fraction(1.0).unwrap();
    assert_eq!(cursor.unread(), 0);
    assert!(cursor.at_edge());
}

#[test]
fn seek_index_saturates_instead_of_panicking() {
    let mut cursor = Cursor::new(4);
    assert_eq!(cursor.seek_index(999).unwrap(), 3);
}

#[test]
fn fraction_round_trips_through_seek() {
    let mut cursor = Cursor::new(101);
    for target in [0usize, 25, 50, 75, 100] {
        cursor.seek_index(target).unwrap();
        let fraction = cursor.fraction();
        cursor.seek_fraction(fraction).unwrap();
        assert_eq!(cursor.index(), target);
    }
}

#[test]
fn a_single_event_transcript_reports_a_zero_fraction() {
    let cursor = Cursor::new(1);
    assert_eq!(cursor.fraction(), 0.0);
    assert!(cursor.at_edge());
}
