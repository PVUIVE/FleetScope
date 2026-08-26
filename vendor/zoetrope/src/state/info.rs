//! Session-level metadata, folded independently of the agent model.
//!
//! These flat-metadata entries carry no timestamp and aren't activity, so they
//! stay OFF the timeline (kept on `App`, surfaced in the `i` overlay and the
//! `inspect` header) rather than cluttering the graph. Entries arrive in file
//! (chronological) order, so latest-wins for the "current" values; counts
//! accumulate.

use crate::transcript::{Entry, FlatValueEntry};

/// Session-level metadata that carries no timestamp and isn't activity.
#[derive(Debug, Default, Clone)]
pub struct SessionInfo {
    /// Header title, from the `ai-title` entry. Session identity, not an event —
    /// it carries no timestamp and belongs here, not on the timeline.
    pub title: Option<String>,
    /// Final permission mode (`default` / `acceptEdits` / `plan` / `bypass…`).
    pub permission_mode: Option<String>,
    /// Final editor/agent mode (e.g. `normal`).
    pub mode: Option<String>,
    /// The most recent prompt text recorded.
    pub last_prompt: Option<String>,
    /// How many messages were enqueued over the session.
    pub queued_ops: u32,
    /// File-edit checkpoints (`file-history-snapshot` count).
    pub file_snapshots: u32,
}

impl SessionInfo {
    /// Fold one flat-metadata entry into the info (latest-wins / counts). Non-
    /// metadata entries are ignored.
    pub fn apply(&mut self, entry: &Entry) {
        match entry {
            Entry::AiTitle(e) => {
                if let Some(t) = &e.title {
                    self.title = Some(t.clone());
                }
            }
            Entry::Mode(e) => self.mode = str_field(e, "mode").or(self.mode.take()),
            Entry::PermissionMode(e) => {
                self.permission_mode =
                    str_field(e, "permissionMode").or(self.permission_mode.take())
            }
            Entry::LastPrompt(e) => {
                self.last_prompt = str_field(e, "lastPrompt").or(self.last_prompt.take())
            }
            Entry::QueueOperation(e) => {
                if str_field(e, "operation").as_deref() == Some("enqueue") {
                    self.queued_ops += 1;
                }
            }
            Entry::FileHistorySnapshot(_) => self.file_snapshots += 1,
            _ => {}
        }
    }
}

/// Pull a string field out of a flat-metadata entry's captured object.
fn str_field(e: &FlatValueEntry, key: &str) -> Option<String> {
    e.fields
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::parse_line;

    #[test]
    fn session_info_extracts_metadata_latest_wins() {
        let mut info = SessionInfo::default();
        let p = |s: &str| parse_line(s).unwrap();
        info.apply(&p(r#"{"type":"ai-title","aiTitle":"Build the thing"}"#));
        info.apply(&p(r#"{"type":"mode","mode":"normal"}"#));
        info.apply(&p(
            r#"{"type":"permission-mode","permissionMode":"default"}"#,
        ));
        info.apply(&p(
            r#"{"type":"permission-mode","permissionMode":"acceptEdits"}"#,
        ));
        info.apply(&p(r#"{"type":"last-prompt","lastPrompt":"hey"}"#));
        info.apply(&p(r#"{"type":"queue-operation","operation":"enqueue"}"#));
        info.apply(&p(r#"{"type":"queue-operation","operation":"dequeue"}"#));
        info.apply(&p(r#"{"type":"file-history-snapshot","messageId":"x"}"#));
        info.apply(&p(r#"{"type":"file-history-snapshot","messageId":"y"}"#));

        assert_eq!(info.title.as_deref(), Some("Build the thing"));
        assert_eq!(info.mode.as_deref(), Some("normal"));
        assert_eq!(info.permission_mode.as_deref(), Some("acceptEdits")); // latest wins
        assert_eq!(info.last_prompt.as_deref(), Some("hey"));
        assert_eq!(info.queued_ops, 1, "only enqueues counted");
        assert_eq!(info.file_snapshots, 2);
    }
}
