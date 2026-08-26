//! The Event Cursor.
//!
//! Moving the cursor changes only what is projected. It performs no side effect,
//! executes no tool, and never mutates evidence.
//!
//! Two behaviors matter for correctness and are enforced here rather than in the
//! UI, where they would be easy to regress:
//!
//! 1. **Position is allocated by event index, not wall-clock time.** A Case with
//!    a 12-day idle gap must not allocate 12 days of scrubber width.
//! 2. **Events arriving during historical inspection do not move the cursor.**
//!    They increment an unread count until the user explicitly returns to live.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CursorError {
    /// Seek fraction outside `0.0..=1.0`, or not a finite number.
    FractionOutOfRange,
    EmptyTranscript,
}

impl std::fmt::Display for CursorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FractionOutOfRange => {
                write!(f, "seek fraction must be a finite value in 0.0..=1.0")
            }
            Self::EmptyTranscript => write!(f, "cannot move the cursor in an empty transcript"),
        }
    }
}

impl std::error::Error for CursorError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cursor {
    index: usize,
    length: usize,
    at_edge: bool,
    unread: usize,
}

impl Default for Cursor {
    fn default() -> Self {
        Self::new(0)
    }
}

impl Cursor {
    pub fn new(length: usize) -> Self {
        Self {
            index: length.saturating_sub(1),
            length,
            at_edge: true,
            unread: 0,
        }
    }

    pub fn index(&self) -> usize {
        self.index
    }

    pub fn len(&self) -> usize {
        self.length
    }

    pub fn is_empty(&self) -> bool {
        self.length == 0
    }

    /// True when the cursor is following the live edge.
    pub fn at_edge(&self) -> bool {
        self.at_edge
    }

    /// Events accepted while the cursor was held historically.
    pub fn unread(&self) -> usize {
        self.unread
    }

    /// Seek to a fraction of the transcript. `0.0` is the first event, `1.0` the
    /// last. Any seek leaves live mode.
    pub fn seek_fraction(&mut self, fraction: f64) -> Result<usize, CursorError> {
        if self.length == 0 {
            return Err(CursorError::EmptyTranscript);
        }
        if !fraction.is_finite() || !(0.0..=1.0).contains(&fraction) {
            return Err(CursorError::FractionOutOfRange);
        }

        let last = self.length - 1;
        // Round rather than truncate so seek(1.0) lands on the last event and
        // the midpoint of a two-event Case does not bias to the first.
        let index = (fraction * last as f64).round() as usize;
        self.index = index.min(last);
        self.at_edge = self.index == last;
        if self.at_edge {
            self.unread = 0;
        }
        Ok(self.index)
    }

    pub fn seek_index(&mut self, index: usize) -> Result<usize, CursorError> {
        if self.length == 0 {
            return Err(CursorError::EmptyTranscript);
        }
        let last = self.length - 1;
        self.index = index.min(last);
        self.at_edge = self.index == last;
        if self.at_edge {
            self.unread = 0;
        }
        Ok(self.index)
    }

    /// Return to the live edge and clear the unread count.
    pub fn go_live(&mut self) -> usize {
        self.index = self.length.saturating_sub(1);
        self.at_edge = true;
        self.unread = 0;
        self.index
    }

    /// Record that one event was appended.
    ///
    /// While the cursor is historical the index is deliberately left untouched —
    /// a new event must never yank an investigator's view forward.
    pub fn on_appended(&mut self) {
        self.length += 1;
        if self.at_edge {
            self.index = self.length - 1;
        } else {
            self.unread += 1;
        }
    }

    /// Current position as a fraction, for a scrubber. `0.0` for a single-event
    /// transcript, where no meaningful fraction exists.
    pub fn fraction(&self) -> f64 {
        if self.length <= 1 {
            0.0
        } else {
            self.index as f64 / (self.length - 1) as f64
        }
    }
}
