//! Portable replay-stream pieces — the timeline item and its ordering.
//!
//! Shared by the native replay assembly ([`super::replay`]) and the App's
//! `Timeline`, and free of any IO so it compiles on wasm too.

use std::collections::HashMap;

use chrono::{DateTime, Utc};

use super::{Source, Update};
use crate::transcript::Entry;

/// When a timeline item happens — its single source of truth for placement.
///
/// An item is either `Dated` (a real timestamp — its own envelope, an inherited
/// predecessor, or a resolved cross-file join) or **undated**, split into two
/// distinct cases:
///
/// - `Pending` — an externally-dated item (a subagent `meta`, or a workflow
///   journal `result`/`started`) whose true time lives on **another** file: the
///   agent named by `agent`. It rides at the head until that agent's entries are
///   discovered, then [`date_and_sort`] promotes it to `Dated`. Because `Dated`
///   is only ever reached via a real join, the "fabricate a date then freeze it"
///   bug is unrepresentable.
/// - `Leader` — genuinely undated with no join target (an empty subagent file, a
///   true stream leader). Rides at the head permanently.
#[derive(Debug, Clone)]
pub enum Timing {
    Dated(DateTime<Utc>),
    /// Undated, waiting on `agent`'s entries to appear (cross-file join).
    Pending(String),
    /// Undated with nothing to wait on.
    Leader,
}

/// One merged replay step: an entry/meta update with its `Timing`.
///
/// The whole `Vec<ReplayItem>` is handed to the App via `UiEvent::ReplayLoaded`;
/// the App's `Timeline` owns it and folds a prefix up to the playhead.
#[derive(Debug)]
pub struct ReplayItem {
    pub(crate) timing: Timing,
    pub update: Update,
}

impl ReplayItem {
    /// The resolved timestamp, if the item is dated — the value all the
    /// timeline geometry (folding, sorting, the scrubber) reads. `Pending` and
    /// `Leader` are both undated → `None` (they sort to the head).
    pub fn ts(&self) -> Option<DateTime<Utc>> {
        match self.timing {
            Timing::Dated(t) => Some(t),
            Timing::Pending(_) | Timing::Leader => None,
        }
    }

    /// Build an item from an already-resolved timestamp: `Some` → `Dated`,
    /// `None` → the undated case implied by `update` (a meta / agent-referencing
    /// journal line → `Pending` on that agent; anything else → `Leader`).
    pub(crate) fn at(ts: Option<DateTime<Utc>>, update: Update) -> Self {
        let timing = match ts {
            Some(t) => Timing::Dated(t),
            None => undated_timing(&update),
        };
        ReplayItem { timing, update }
    }

    /// Wrap a live update as a timeline item, taking its timestamp from the
    /// entry envelope (metas/journals carry none → undated, they ride at the
    /// head until dated).
    pub fn live(update: Update) -> Self {
        let ts = match &update {
            Update::Entry { entry, .. } => entry_timestamp(entry),
            Update::SubagentMeta { .. } => None,
        };
        Self::at(ts, update)
    }
}

/// The undated `Timing` for an update with no resolved timestamp: `Pending` on
/// the agent it references (a subagent meta, or a journal `result`/`started`),
/// else `Leader`.
fn undated_timing(update: &Update) -> Timing {
    let agent = match update {
        Update::SubagentMeta { agent_id, .. } => Some(agent_id.clone()),
        Update::Entry {
            source: Source::Journal(_),
            entry,
        } => match entry {
            Entry::Result(l) => l.agent_id.clone(),
            Entry::Started(l) => l.agent_id.clone(),
            _ => None,
        },
        Update::Entry { .. } => None,
    };
    agent.map_or(Timing::Leader, Timing::Pending)
}

/// Date the untimed items in place — metas → their agent's first entry, journal
/// `result`/`started` → that agent's last/first entry (else earliest) — then
/// stably sort the whole list by timestamp. For the one-shot
/// bulk replay assembly, where every file has already been parsed so an
/// unmatched journal agent is genuinely an orphan.
///
/// Ties sort metas before entries (so an agent exists before its first entry
/// folds); remaining `None` timestamps (true leaders / empty subagent files)
/// sort first. Idempotent: a meta with no entry yet stays `None` and is re-dated
/// once its entries arrive on a later call.
pub(crate) fn date_and_sort(items: &mut [ReplayItem]) {
    date_and_sort_inner(items, true);
}

/// Like [`date_and_sort`], but for the growing live stream: a journal entry
/// whose agent has no entries YET stays undated — riding at the head like a
/// meta — so a later call re-dates it once the agent's transcript is
/// discovered. The bulk fallback to `earliest` would permanently stamp it with
/// the session START (a `Dated` item is never re-guessed), pinning e.g. a
/// workflow `result` hours before the workflow ran.
pub(crate) fn date_and_sort_live(items: &mut [ReplayItem]) {
    date_and_sort_inner(items, false);
}

fn date_and_sort_inner(items: &mut [ReplayItem], complete: bool) {
    let earliest = items.iter().filter_map(|i| i.ts()).min();

    let mut first_entry_ts: HashMap<String, DateTime<Utc>> = HashMap::new();
    let mut last_entry_ts: HashMap<String, DateTime<Utc>> = HashMap::new();
    for item in items.iter() {
        if let (
            Some(ts),
            Update::Entry {
                source: Source::Sub(id),
                ..
            },
        ) = (item.ts(), &item.update)
        {
            first_entry_ts
                .entry(id.clone())
                .and_modify(|t| *t = (*t).min(ts))
                .or_insert(ts);
            last_entry_ts
                .entry(id.clone())
                .and_modify(|t| *t = (*t).max(ts))
                .or_insert(ts);
        }
    }
    for item in items.iter_mut() {
        // A `Dated` item is settled — only undated (`Pending`/`Leader`) items
        // try to resolve, so a resolved date can never be re-guessed.
        if matches!(item.timing, Timing::Dated(_)) {
            continue;
        }
        // The join rule (which edge of the agent's lifespan to borrow, and the
        // bulk-only orphan fallback) is domain logic keyed on the update kind.
        let resolved = match &item.update {
            Update::SubagentMeta { agent_id, .. } => first_entry_ts.get(agent_id).copied(),
            Update::Entry {
                source: Source::Journal(_),
                entry,
            } => match entry {
                Entry::Result(l) => l
                    .agent_id
                    .as_ref()
                    .and_then(|id| last_entry_ts.get(id))
                    .copied(),
                Entry::Started(l) => l
                    .agent_id
                    .as_ref()
                    .and_then(|id| first_entry_ts.get(id))
                    .copied(),
                _ => None,
            }
            // Bulk only: an orphan journal entry (no matching transcript
            // anywhere) → earliest, so it folds with the start instead of
            // leading as an untimed item. Live keeps it undated so it can
            // be re-dated once the agent's file is discovered. (Metas never
            // take this fallback — they stay `Pending` until their agent lands.)
            .or(if complete { earliest } else { None }),
            _ => None,
        };
        if let Some(t) = resolved {
            item.timing = Timing::Dated(t);
        }
    }

    let rank = |u: &Update| match u {
        Update::SubagentMeta { .. } => 0u8,
        Update::Entry { .. } => 1u8,
    };
    items.sort_by(|a, b| match (a.ts(), b.ts()) {
        (Some(x), Some(y)) => x
            .cmp(&y)
            .then_with(|| rank(&a.update).cmp(&rank(&b.update))),
        (Some(_), None) => std::cmp::Ordering::Greater,
        (None, Some(_)) => std::cmp::Ordering::Less,
        (None, None) => std::cmp::Ordering::Equal,
    });
}

/// The envelope timestamp of an entry, if it carries one.
pub(crate) fn entry_timestamp(entry: &Entry) -> Option<DateTime<Utc>> {
    match entry {
        Entry::User(e) => e.envelope.timestamp,
        Entry::Assistant(e) => e.envelope.timestamp,
        Entry::System(e) => e.envelope.timestamp,
        Entry::Attachment(e) => e.envelope.timestamp,
        _ => None,
    }
}

/// Build a replay stream from a single transcript's text — the browser
/// frontend's data source (a bundled or drag-dropped `.jsonl`).
///
/// Unlike the native `build_replay`, there are no sidecar files to discover, so
/// this parses only the main transcript: subagents appear only insofar as it
/// records them (their own transcripts live in separate files the browser can't
/// reach). Untimed session metadata is routed into [`SessionInfo`](crate::state::SessionInfo);
/// the rest is dated and stably sorted — same shape the App expects from
/// `UiEvent::ReplayLoaded`.
pub fn replay_from_jsonl(text: &str) -> (Vec<ReplayItem>, crate::state::SessionInfo) {
    let mut items: Vec<ReplayItem> = Vec::new();
    push_lines(text, &Source::Main, &mut items);
    finish(items)
}

/// One non-main file for [`replay_from_session`]: a subagent's transcript +
/// `meta.json`, or a workflow's `journal.jsonl`.
///
/// Mirrors what the native `build_replay` discovers on disk, so the browser
/// frontend (which has no filesystem — JS reads the files and hands the text
/// across) produces the same graph from the same session.
pub struct DemoSubagent<'a> {
    pub agent_id: &'a str,
    pub meta: &'a str,
    pub transcript: &'a str,
    /// Owning workflow id for anything under `subagents/workflows/<id>/`;
    /// `None` for a direct subagent. Drives the group node + parentage.
    pub workflow: Option<&'a str>,
    /// True when `transcript` is a workflow's `journal.jsonl` rather than a
    /// subagent transcript — it folds under [`Source::Journal`] and carries no
    /// meta. Requires `workflow` to be set.
    pub journal: bool,
}

/// Build a replay stream from a full session's files — the main transcript plus
/// subagents (transcript + meta), workflow subagents, and workflow journals.
/// This is the multi-file equivalent of [`replay_from_jsonl`]; the native side
/// reads the same shapes off disk via `build_replay`. The meta sets each
/// subagent's parent (→ main, or → its workflow group) and type, so the graph
/// connects even before the spawning tool call is folded.
pub fn replay_from_session(
    main: &str,
    subagents: &[DemoSubagent],
) -> (Vec<ReplayItem>, crate::state::SessionInfo) {
    let mut items: Vec<ReplayItem> = Vec::new();
    push_lines(main, &Source::Main, &mut items);
    for sub in subagents {
        // A journal belongs to the workflow, not to any one agent: no meta, and
        // it folds under its own source. Ignore one with no workflow id — there
        // is nothing to attribute it to.
        if sub.journal {
            if let Some(wf) = sub.workflow {
                push_lines(sub.transcript, &Source::Journal(wf.to_string()), &mut items);
            }
            continue;
        }
        if let Ok(meta) = serde_json::from_str::<crate::transcript::SubagentMeta>(sub.meta) {
            items.push(ReplayItem::at(
                None,
                Update::SubagentMeta {
                    agent_id: sub.agent_id.to_string(),
                    workflow: sub.workflow.map(str::to_owned),
                    meta,
                },
            ));
        }
        push_lines(
            sub.transcript,
            &Source::Sub(sub.agent_id.to_string()),
            &mut items,
        );
    }
    finish(items)
}

/// Parse a transcript's complete lines into `items` under `source`, inheriting
/// the previous in-file timestamp for entries that lack one.
fn push_lines(text: &str, source: &Source, items: &mut Vec<ReplayItem>) {
    let mut last_ts: Option<DateTime<Utc>> = None;
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Some(entry) = crate::transcript::parse_line(line) else {
            continue;
        };
        let ts = entry_timestamp(&entry).or(last_ts);
        if ts.is_some() {
            last_ts = ts;
        }
        items.push(ReplayItem::at(
            ts,
            Update::Entry {
                source: source.clone(),
                entry,
            },
        ));
    }
}

/// Route untimed session-level metadata into the info store (dropping it from
/// the timeline), then date + stably sort the rest.
fn finish(mut items: Vec<ReplayItem>) -> (Vec<ReplayItem>, crate::state::SessionInfo) {
    let mut info = crate::state::SessionInfo::default();
    items.retain(|item| match &item.update {
        Update::Entry { entry, .. } if entry.is_timeline_noise() => {
            info.apply(entry);
            false
        }
        _ => true,
    });
    date_and_sort(&mut items);
    (items, info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn journal_ledger_dates_to_the_agents_first_or_last_entry() {
        let sub = |t: &str| {
            format!(
                r#"{{"type":"user","uuid":"u","timestamp":"{t}","message":{{"role":"user","content":"x"}}}}"#
            )
        };
        let mut items = Vec::new();
        // The subagent's own transcript: first entry at :05, last at :15.
        push_lines(
            &format!(
                "{}\n{}\n",
                sub("2026-06-05T10:00:05.000Z"),
                sub("2026-06-05T10:00:15.000Z")
            ),
            &Source::Sub("subX".into()),
            &mut items,
        );
        // Undated journal ledger lines for that agent — must borrow opposite ends
        // of its lifespan: `started` → first entry, `result` → last entry.
        push_lines(
            r#"{"type":"started","key":"k","agentId":"subX"}"#,
            &Source::Journal("wf".into()),
            &mut items,
        );
        push_lines(
            r#"{"type":"result","key":"k","agentId":"subX","result":"done"}"#,
            &Source::Journal("wf".into()),
            &mut items,
        );

        date_and_sort(&mut items);

        let started_ts = items
            .iter()
            .find(|i| {
                matches!(
                    &i.update,
                    Update::Entry {
                        entry: Entry::Started(_),
                        ..
                    }
                )
            })
            .and_then(|i| i.ts());
        let result_ts = items
            .iter()
            .find(|i| {
                matches!(
                    &i.update,
                    Update::Entry {
                        entry: Entry::Result(_),
                        ..
                    }
                )
            })
            .and_then(|i| i.ts());
        assert_eq!(
            started_ts,
            Some("2026-06-05T10:00:05.000Z".parse::<DateTime<Utc>>().unwrap()),
            "journal `started` dates to the agent's FIRST entry"
        );
        assert_eq!(
            result_ts,
            Some("2026-06-05T10:00:15.000Z".parse::<DateTime<Utc>>().unwrap()),
            "journal `result` dates to the agent's LAST entry"
        );
    }

    #[test]
    fn replay_from_jsonl_parses_orders_and_routes_noise() {
        let text = concat!(
            r#"{"type":"user","uuid":"u1","timestamp":"2026-06-05T10:00:02.000Z","message":{"role":"user","content":"second"}}"#,
            "\n",
            "\n",
            r#"{"type":"user","uuid":"u0","timestamp":"2026-06-05T10:00:01.000Z","message":{"role":"user","content":"first"}}"#,
            "\n",
            r#"garbage that should be skipped"#,
            "\n",
        );
        let (items, _info) = replay_from_jsonl(text);
        // Two valid entries (blank + garbage skipped), sorted by timestamp.
        assert_eq!(items.len(), 2);
        assert!(items[0].ts().unwrap() < items[1].ts().unwrap());
        // All from the main source.
        assert!(items.iter().all(|i| matches!(
            &i.update,
            Update::Entry {
                source: Source::Main,
                ..
            }
        )));
    }

    #[test]
    fn replay_from_session_emits_subagent_meta_and_sub_entries() {
        let main = r#"{"type":"user","uuid":"u1","timestamp":"2026-06-05T10:00:00.000Z","message":{"role":"user","content":"go"}}"#;
        let sub = DemoSubagent {
            agent_id: "a1000000000000001",
            meta: r#"{"agentType":"Explore","description":"map it","toolUseId":"toolu_1"}"#,
            transcript: r#"{"type":"user","uuid":"s1","isSidechain":true,"agentId":"a1000000000000001","timestamp":"2026-06-05T10:00:05.000Z","message":{"role":"user","content":"task"}}"#,
            workflow: None,
            journal: false,
        };
        let (items, _info) = replay_from_session(main, &[sub]);

        assert!(
            items
                .iter()
                .any(|i| matches!(&i.update, Update::SubagentMeta { agent_id, .. } if agent_id == "a1000000000000001")),
            "a subagent meta is emitted"
        );
        assert!(
            items.iter().any(|i| matches!(
                &i.update,
                Update::Entry { source: Source::Sub(id), .. } if id == "a1000000000000001"
            )),
            "subagent entries are tagged Source::Sub"
        );
    }

    /// Workflow parity with the native loader: a subagent under
    /// `subagents/workflows/<id>/` must carry its workflow id (so the model
    /// creates the group node and parents it there), and the workflow's
    /// `journal.jsonl` must fold under `Source::Journal` — not as a subagent.
    /// Without this the browser silently renders workflow sessions as a flat
    /// fan-out, while the native TUI shows the group.
    #[test]
    fn replay_from_session_tags_workflow_subagents_and_journals() {
        let main = r#"{"type":"user","uuid":"u1","timestamp":"2026-06-05T10:00:00.000Z","message":{"role":"user","content":"go"}}"#;
        let subs = [
            DemoSubagent {
                agent_id: "w1000000000000001",
                meta: r#"{"agentType":"workflow-subagent","description":"review:bugs"}"#,
                transcript: r#"{"type":"user","uuid":"s1","isSidechain":true,"agentId":"w1000000000000001","timestamp":"2026-06-05T10:00:05.000Z","message":{"role":"user","content":"task"}}"#,
                workflow: Some("wf-99"),
                journal: false,
            },
            DemoSubagent {
                agent_id: "",
                meta: "",
                transcript: r#"{"type":"started","key":"review","agentId":"w1000000000000001"}"#,
                workflow: Some("wf-99"),
                journal: true,
            },
        ];
        let (items, _info) = replay_from_session(main, &subs);

        assert!(
            items.iter().any(|i| matches!(
                &i.update,
                Update::SubagentMeta { agent_id, workflow: Some(wf), .. }
                    if agent_id == "w1000000000000001" && wf == "wf-99"
            )),
            "a workflow subagent's meta carries its workflow id"
        );
        assert!(
            items.iter().any(|i| matches!(
                &i.update,
                Update::Entry { source: Source::Journal(wf), .. } if wf == "wf-99"
            )),
            "journal lines fold under Source::Journal, not Source::Sub"
        );
        assert!(
            !items.iter().any(|i| matches!(
                &i.update,
                Update::Entry { source: Source::Sub(id), .. } if id.is_empty()
            )),
            "the journal is not mistaken for a subagent transcript"
        );
    }
}
