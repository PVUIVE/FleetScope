//! The Render Manifest, renderer-side.
//!
//! This is the Rust mirror of `packages/scenario-compiler/src/render-manifest.ts`.
//! The TypeScript compiler is the sole PRODUCER; this crate only reads. Both
//! sides load the same blessed bytes from
//! `packages/fixtures/cases/<case>/renderer/render-manifest.json`, so the two
//! representations cannot drift apart without a test failing.
//!
//! # The rule this type exists to enforce
//!
//! A cursor position is never computed as `case_sequence / last_case_sequence`.
//! One Canonical Event may compile to zero renderer entries (`usage.recorded`),
//! one (`tool.requested`), or several (an allowed `gateway.routed`), so the ratio
//! is wrong by an amount that nothing measures. Every translation goes through
//! [`RenderManifest::fraction_for_case_sequence`] and
//! [`RenderManifest::entry_for_renderer_index`] instead.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenderOutcome {
    Succeeded,
    /// Completed with content modified by policy. A SUCCESS, not a failure.
    Sanitized,
    /// Screened and allowed with a finding recorded. A success, not a failure.
    Flagged,
    /// An authorization or routing policy said no. Not a crash.
    Denied,
    /// Model Armor refused the content. Not a crash.
    Blocked,
    /// Genuine execution failure of the thing that was attempted.
    Failed,
    Pending,
    Informational,
}

impl RenderOutcome {
    /// Whether the renderer draws this with its error styling.
    ///
    /// Three distinct outcomes share it because Zoetrope has no `denied` state.
    /// The styling is a rendering compromise; the outcome is not. Decision
    /// Evidence reads [`RenderManifestEntry::label`], so the operator sees
    /// "Identity denied", never "Tool failed".
    pub fn is_error_styled(self) -> bool {
        matches!(self, Self::Denied | Self::Blocked | Self::Failed)
    }

    /// Whether the underlying control actually did its job.
    pub fn is_success(self) -> bool {
        matches!(self, Self::Succeeded | Self::Sanitized | Self::Flagged)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RenderManifestEntry {
    #[serde(rename = "eventId")]
    pub event_id: String,
    #[serde(rename = "caseSequence")]
    pub case_sequence: u64,

    #[serde(rename = "rendererEntryStart")]
    pub renderer_entry_start: usize,
    /// Inclusive. Equals `renderer_entry_start - 1` when the event produced
    /// nothing, which is why this is signed.
    #[serde(rename = "rendererEntryEnd")]
    pub renderer_entry_end: i64,
    #[serde(rename = "rendererEntryCount")]
    pub renderer_entry_count: usize,

    /// The compile-time fraction, carried in the wire format for the static
    /// browser path. It is DERIVED from `renderer_entry_start` and the manifest's
    /// total, so an append invalidates it — every lookup recomputes instead of
    /// trusting it, and [`RenderManifest::validate`] checks the two agree.
    #[serde(rename = "rendererFraction")]
    pub renderer_fraction: f64,

    pub domain: String,
    pub outcome: RenderOutcome,
    /// Operator-safe. Never model reasoning, never raw vendor content.
    pub label: String,
    #[serde(rename = "evidenceEventIds")]
    pub evidence_event_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RenderManifest {
    #[serde(rename = "manifestVersion")]
    pub manifest_version: String,
    #[serde(rename = "caseId")]
    pub case_id: String,
    #[serde(rename = "adapterId")]
    pub adapter_id: String,
    #[serde(rename = "rendererEntryCount")]
    pub renderer_entry_count: usize,
    #[serde(rename = "firstCaseSequence")]
    pub first_case_sequence: u64,
    #[serde(rename = "lastCaseSequence")]
    pub last_case_sequence: u64,
    pub entries: Vec<RenderManifestEntry>,
}

impl RenderManifest {
    pub fn parse(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }

    /// Entries that actually produced something. The others are recorded so the
    /// manifest stays a complete account of the Case, but they can never be a
    /// cursor destination — there is nothing there to look at.
    fn rendered(&self) -> impl Iterator<Item = &RenderManifestEntry> {
        self.entries.iter().filter(|e| e.renderer_entry_count > 0)
    }

    /// Canonical → renderer. Exact hit wins; otherwise the nearest rendered
    /// event AT OR BEFORE the target, because a cursor parked on an event that
    /// drew nothing belongs at the last thing that was drawn. Moving it forward
    /// would show evidence the operator has not reached yet.
    pub fn entry_for_case_sequence(&self, case_sequence: u64) -> Option<&RenderManifestEntry> {
        self.rendered()
            .take_while(|e| e.case_sequence <= case_sequence)
            .last()
            .or_else(|| self.rendered().next())
    }

    /// Fraction of a renderer index over the CURRENT total.
    ///
    /// Computed rather than read from the entry: appending to a live Case grows
    /// the denominator, so a stored fraction goes stale the moment the Case does.
    pub fn fraction_for_entry_index(&self, index: usize) -> f64 {
        if self.renderer_entry_count <= 1 {
            return 0.0;
        }
        let last = self.renderer_entry_count - 1;
        index.min(last) as f64 / last as f64
    }

    pub fn fraction_for_case_sequence(&self, case_sequence: u64) -> Option<f64> {
        self.entry_for_case_sequence(case_sequence)
            .map(|e| self.fraction_for_entry_index(e.renderer_entry_start))
    }

    /// Restate every stored fraction against the current total. Called after an
    /// append so the wire value never contradicts the computed one.
    pub fn recompute_fractions(&mut self) {
        let total = self.renderer_entry_count;
        for entry in self.entries.iter_mut() {
            entry.renderer_fraction = if total <= 1 {
                0.0
            } else {
                entry.renderer_entry_start.min(total - 1) as f64 / (total - 1) as f64
            };
        }
    }

    /// Append newly compiled manifest entries at the live edge.
    ///
    /// Rejects an entry that does not continue the existing ranges: a hole or an
    /// overlap would silently misalign every subsequent cursor translation.
    pub fn append_entries(
        &mut self,
        entries: impl IntoIterator<Item = RenderManifestEntry>,
    ) -> Result<usize, String> {
        let mut added = 0usize;
        for entry in entries {
            if entry.renderer_entry_start != self.renderer_entry_count {
                return Err(format!(
                    "appended {} starts at {} but the timeline ends at {}",
                    entry.event_id, entry.renderer_entry_start, self.renderer_entry_count
                ));
            }
            if self
                .entries
                .last()
                .is_some_and(|l| entry.case_sequence <= l.case_sequence)
            {
                return Err(format!(
                    "appended {} does not advance the case sequence",
                    entry.event_id
                ));
            }
            self.renderer_entry_count += entry.renderer_entry_count;
            self.last_case_sequence = entry.case_sequence;
            self.entries.push(entry);
            added += 1;
        }
        self.recompute_fractions();
        Ok(added)
    }

    /// Renderer → canonical. The reverse direction, used when the operator
    /// scrubs the Cockpit and the FleetScope Event Cursor has to follow.
    pub fn entry_for_renderer_index(&self, index: usize) -> Option<&RenderManifestEntry> {
        self.rendered()
            .take_while(|e| e.renderer_entry_start <= index)
            .last()
    }

    pub fn entry_for_event_id(&self, event_id: &str) -> Option<&RenderManifestEntry> {
        self.entries.iter().find(|e| e.event_id == event_id)
    }

    /// Structural checks a per-entry shape cannot express. An empty vector means
    /// the manifest is internally consistent.
    pub fn validate(&self) -> Vec<String> {
        let mut problems = Vec::new();
        let mut expected_next_start = 0usize;
        let mut previous_case_sequence: Option<u64> = None;

        for (index, entry) in self.entries.iter().enumerate() {
            let at = format!("entry[{index}] {}", entry.event_id);

            if previous_case_sequence.is_some_and(|p| entry.case_sequence <= p) {
                problems.push(format!(
                    "{at}: caseSequence {} does not increase",
                    entry.case_sequence
                ));
            }
            previous_case_sequence = Some(entry.case_sequence);

            let span = entry.renderer_entry_end - entry.renderer_entry_start as i64 + 1;
            if span != entry.renderer_entry_count as i64 {
                problems.push(format!(
                    "{at}: rendererEntryCount {} disagrees with its range",
                    entry.renderer_entry_count
                ));
            }
            if entry.renderer_entry_start != expected_next_start {
                problems.push(format!(
                    "{at}: rendererEntryStart {} leaves a hole after {expected_next_start}",
                    entry.renderer_entry_start
                ));
            }
            expected_next_start = entry.renderer_entry_start + entry.renderer_entry_count;

            if !entry.evidence_event_ids.contains(&entry.event_id) {
                problems.push(format!("{at}: evidenceEventIds omits its own eventId"));
            }

            let computed = if self.renderer_entry_count <= 1 {
                0.0
            } else {
                entry
                    .renderer_entry_start
                    .min(self.renderer_entry_count - 1) as f64
                    / (self.renderer_entry_count - 1) as f64
            };
            if (entry.renderer_fraction - computed).abs() > 1e-9 {
                problems.push(format!(
                    "{at}: stored rendererFraction {} disagrees with the computed {computed}",
                    entry.renderer_fraction
                ));
            }
        }

        if expected_next_start != self.renderer_entry_count {
            problems.push(format!(
                "manifest: entries account for {expected_next_start} renderer items but rendererEntryCount is {}",
                self.renderer_entry_count
            ));
        }

        problems
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(
        event_id: &str,
        case_sequence: u64,
        start: usize,
        count: usize,
        total: usize,
    ) -> RenderManifestEntry {
        RenderManifestEntry {
            event_id: event_id.to_owned(),
            case_sequence,
            renderer_entry_start: start,
            renderer_entry_end: start as i64 + count as i64 - 1,
            renderer_entry_count: count,
            renderer_fraction: if total <= 1 {
                0.0
            } else {
                start.min(total - 1) as f64 / (total - 1) as f64
            },
            domain: "tool".to_owned(),
            outcome: RenderOutcome::Succeeded,
            label: event_id.to_owned(),
            evidence_event_ids: vec![event_id.to_owned()],
        }
    }

    /// Zero / one / many renderer items from consecutive Canonical Events — the
    /// exact shape a `caseSequence / lastCaseSequence` ratio gets wrong.
    fn mixed() -> RenderManifest {
        let total = 6;
        RenderManifest {
            manifest_version: "1.0.0".into(),
            case_id: "CASE-T".into(),
            adapter_id: "test".into(),
            renderer_entry_count: total,
            first_case_sequence: 0,
            last_case_sequence: 4,
            entries: vec![
                entry("e0", 0, 0, 1, total), // one
                entry("e1", 1, 1, 0, total), // NONE — usage.recorded
                entry("e2", 2, 1, 3, total), // three — gateway.routed
                entry("e3", 3, 4, 0, total), // NONE — milestone
                entry("e4", 4, 4, 2, total), // two
            ],
        }
    }

    #[test]
    fn a_consistent_manifest_validates() {
        assert_eq!(mixed().validate(), Vec::<String>::new());
    }

    #[test]
    fn a_hole_between_ranges_is_reported() {
        let mut manifest = mixed();
        manifest.entries[2].renderer_entry_start = 2;
        manifest.entries[2].renderer_entry_end = 4;
        assert!(manifest.validate().iter().any(|p| p.contains("hole")));
    }

    #[test]
    fn a_count_that_disagrees_with_its_range_is_reported() {
        let mut manifest = mixed();
        manifest.entries[0].renderer_entry_count = 9;
        assert!(manifest.validate().iter().any(|p| p.contains("disagrees")));
    }

    #[test]
    fn case_sequence_maps_through_the_manifest_not_by_division() {
        let manifest = mixed();
        // Event 2 produced three items starting at renderer index 1. Its fraction
        // is 1/5 = 0.2. The forbidden ratio would have said 2/4 = 0.5.
        let fraction = manifest.fraction_for_case_sequence(2).unwrap();
        assert!((fraction - 0.2).abs() < 1e-9, "got {fraction}");
        assert_ne!(fraction, 2.0 / 4.0);
    }

    #[test]
    fn an_event_that_rendered_nothing_resolves_to_the_last_visible_one() {
        let manifest = mixed();
        // Event 3 drew nothing. The cursor belongs on event 2's items, not ahead
        // of them on evidence the operator has not reached.
        assert_eq!(
            manifest
                .entry_for_case_sequence(3)
                .map(|e| e.event_id.as_str()),
            Some("e2")
        );
    }

    #[test]
    fn a_case_sequence_before_the_stream_resolves_to_the_first_rendered_event() {
        let mut manifest = mixed();
        manifest.entries[0].case_sequence = 10;
        for e in manifest.entries.iter_mut() {
            e.case_sequence += 10;
        }
        assert_eq!(
            manifest
                .entry_for_case_sequence(0)
                .map(|e| e.event_id.as_str()),
            Some("e0")
        );
    }

    #[test]
    fn renderer_index_maps_back_to_the_canonical_event_that_produced_it() {
        let manifest = mixed();
        assert_eq!(manifest.entry_for_renderer_index(0).unwrap().event_id, "e0");
        // Indices 1..3 all belong to the single event that produced three items.
        for index in 1..=3 {
            assert_eq!(
                manifest.entry_for_renderer_index(index).unwrap().event_id,
                "e2",
                "renderer index {index}"
            );
        }
        assert_eq!(manifest.entry_for_renderer_index(4).unwrap().event_id, "e4");
        assert_eq!(manifest.entry_for_renderer_index(5).unwrap().event_id, "e4");
    }

    #[test]
    fn round_trips_every_rendered_event_through_both_directions() {
        let manifest = mixed();
        for expected in manifest
            .entries
            .iter()
            .filter(|e| e.renderer_entry_count > 0)
        {
            let back = manifest
                .entry_for_renderer_index(expected.renderer_entry_start)
                .expect("a rendered entry resolves");
            assert_eq!(back.event_id, expected.event_id);
        }
    }

    #[test]
    fn outcomes_stay_semantically_distinct() {
        // The whole point of the enum: `sanitized` is a working control, not a
        // broken one, and a policy denial is not an execution failure.
        assert!(RenderOutcome::Sanitized.is_success());
        assert!(!RenderOutcome::Sanitized.is_error_styled());
        assert!(RenderOutcome::Flagged.is_success());
        assert!(RenderOutcome::Denied.is_error_styled());
        assert!(RenderOutcome::Blocked.is_error_styled());
        assert!(RenderOutcome::Failed.is_error_styled());
        assert!(!RenderOutcome::Denied.is_success());
        assert_ne!(RenderOutcome::Denied, RenderOutcome::Failed);
        assert_ne!(RenderOutcome::Blocked, RenderOutcome::Failed);
    }
}
