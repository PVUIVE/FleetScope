//! The transcript the Cockpit loads, produced by the TypeScript Scenario Compiler.
//!
//! The format is JSONL: one header line, then one entry per line. Unknown fields
//! are ignored rather than rejected so the compiler can add renderer-neutral
//! metadata without a lockstep release.

use serde::{Deserialize, Serialize};

/// Back-reference from a rendered entry to the canonical evidence that produced
/// it. Never dropped: selecting anything in the Cockpit must be able to open the
/// exact Decision Evidence behind it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceRef {
    #[serde(rename = "eventId")]
    pub event_id: String,
    #[serde(rename = "caseSequence")]
    pub case_sequence: u64,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    #[serde(rename = "eventType")]
    pub event_type: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    Spawn,
    Message,
    ToolPending,
    ToolResult,
    Status,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentNode {
    pub id: String,
    pub role: String,
    pub label: String,
    #[serde(rename = "parentId")]
    pub parent_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TranscriptEntry {
    pub index: usize,
    #[serde(rename = "agentId")]
    pub agent_id: String,
    pub kind: EntryKind,
    pub label: String,
    pub timestamp: String,
    #[serde(rename = "callId", default)]
    pub call_id: Option<String>,
    #[serde(rename = "toolName", default)]
    pub tool_name: Option<String>,
    #[serde(rename = "isError", default)]
    pub is_error: bool,
    pub fleetscope: EvidenceRef,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TranscriptHeader {
    #[serde(rename = "transcriptVersion")]
    pub transcript_version: String,
    #[serde(rename = "caseId")]
    pub case_id: String,
    pub agents: Vec<AgentNode>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Transcript {
    pub header: Option<TranscriptHeader>,
    pub entries: Vec<TranscriptEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TranscriptError {
    MissingHeader,
    InvalidLine { line: usize, message: String },
}

impl std::fmt::Display for TranscriptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingHeader => write!(f, "transcript has no header line"),
            Self::InvalidLine { line, message } => write!(f, "line {line}: {message}"),
        }
    }
}

impl std::error::Error for TranscriptError {}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum Line {
    #[serde(rename = "header")]
    Header(TranscriptHeader),
    #[serde(rename = "entry")]
    Entry(Box<TranscriptEntry>),
}

impl Transcript {
    /// Parse a full transcript. Fails on the first malformed line: a partially
    /// loaded Case would render an incomplete graph that looks complete.
    pub fn parse_jsonl(input: &str) -> Result<Self, TranscriptError> {
        let mut transcript = Self::default();

        for (offset, raw) in input.lines().enumerate() {
            let line = raw.trim();
            if line.is_empty() {
                continue;
            }
            match serde_json::from_str::<Line>(line) {
                Ok(Line::Header(header)) => transcript.header = Some(header),
                Ok(Line::Entry(entry)) => transcript.entries.push(*entry),
                Err(error) => {
                    return Err(TranscriptError::InvalidLine {
                        line: offset + 1,
                        message: error.to_string(),
                    })
                }
            }
        }

        if transcript.header.is_none() {
            return Err(TranscriptError::MissingHeader);
        }

        // Entries are ordered by canonical Case sequence, not by arrival.
        transcript
            .entries
            .sort_by_key(|entry| entry.fleetscope.case_sequence);

        Ok(transcript)
    }

    /// Append one entry at the live edge.
    ///
    /// Out-of-order arrivals are inserted at their canonical position rather
    /// than pushed, so a late event can never reorder the timeline.
    pub fn append_entry(&mut self, entry: TranscriptEntry) {
        let position = self.entries.partition_point(|existing| {
            existing.fleetscope.case_sequence <= entry.fleetscope.case_sequence
        });
        self.entries.insert(position, entry);
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Highest canonical Case sequence currently loaded.
    pub fn last_case_sequence(&self) -> Option<u64> {
        self.entries
            .last()
            .map(|entry| entry.fleetscope.case_sequence)
    }

    /// First entry index at or after `case_sequence`. Used to translate an
    /// evidence marker into a cursor position.
    pub fn index_of_case_sequence(&self, case_sequence: u64) -> Option<usize> {
        self.entries
            .iter()
            .position(|entry| entry.fleetscope.case_sequence >= case_sequence)
    }
}
