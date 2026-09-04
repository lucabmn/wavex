use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_EVENTS: usize = 4_096;
const MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostEvent {
    pub sequence: u64,
    pub event: String,
    pub payload: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostEventReplay {
    pub stream_id: String,
    pub oldest_sequence: u64,
    pub latest_sequence: u64,
    pub resync_required: bool,
    pub events: Vec<HostEvent>,
}

struct Journal {
    next_sequence: u64,
    bytes: usize,
    events: VecDeque<(usize, HostEvent)>,
}

pub struct HostEventJournal {
    stream_id: String,
    /// Nothing is retained until a client asks for a replay. A local WebView
    /// reads its events straight off the Tauri emit, and PTY bytes and harness
    /// lines run hot enough that a copy per chunk is not free.
    ///
    /// This means the first replay a client asks for is empty and forces a
    /// full resynchronise. Session-scoped journalling moves this to "a client
    /// is attached", which is what makes the first reconnect cheap.
    following: AtomicBool,
    journal: Mutex<Journal>,
}

impl HostEventJournal {
    pub fn new() -> Self {
        let started = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        Self {
            stream_id: format!("{}-{started:x}", std::process::id()),
            following: AtomicBool::new(false),
            journal: Mutex::new(Journal {
                next_sequence: 1,
                bytes: 0,
                events: VecDeque::new(),
            }),
        }
    }

    fn is_following(&self) -> bool {
        self.following.load(Ordering::Relaxed)
    }

    fn record(&self, event: &str, payload: Value) {
        let payload_bytes = serde_json::to_vec(&payload).map_or(0, |value| value.len());
        let size = event.len().saturating_add(payload_bytes);
        let mut journal = self
            .journal
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let sequence = journal.next_sequence;
        journal.next_sequence = journal.next_sequence.saturating_add(1);
        journal.bytes = journal.bytes.saturating_add(size);
        journal.events.push_back((
            size,
            HostEvent {
                sequence,
                event: event.to_string(),
                payload,
            },
        ));

        while journal.events.len() > 1
            && (journal.events.len() > MAX_EVENTS || journal.bytes > MAX_BYTES)
        {
            if let Some((dropped, _)) = journal.events.pop_front() {
                journal.bytes = journal.bytes.saturating_sub(dropped);
            }
        }
    }

    fn replay(&self, after_sequence: u64) -> HostEventReplay {
        self.following.store(true, Ordering::Relaxed);
        let journal = self
            .journal
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let latest_sequence = journal.next_sequence.saturating_sub(1);
        let oldest_sequence = journal
            .events
            .front()
            .map_or(journal.next_sequence, |(_, event)| event.sequence);
        let resync_required = after_sequence.saturating_add(1) < oldest_sequence;
        let events = if resync_required {
            Vec::new()
        } else {
            journal
                .events
                .iter()
                .filter(|(_, event)| event.sequence > after_sequence)
                .map(|(_, event)| event.clone())
                .collect()
        };
        HostEventReplay {
            stream_id: self.stream_id.clone(),
            oldest_sequence,
            latest_sequence,
            resync_required,
            events,
        }
    }
}

/// Publish once to the local WebViews and retain the same payload for remote
/// replay. Process readers never wait for a network client.
pub fn publish<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Some(journal) = app.try_state::<HostEventJournal>() {
        if journal.is_following() {
            if let Ok(value) = serde_json::to_value(&payload) {
                journal.record(event, value);
            }
        }
    }
    let _ = app.emit(event, payload);
}

#[tauri::command]
pub fn host_events_since(
    journal: State<'_, HostEventJournal>,
    after_sequence: u64,
) -> HostEventReplay {
    journal.replay(after_sequence)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retention_starts_at_the_first_replay_request_not_before() {
        let journal = HostEventJournal::new();
        assert!(!journal.is_following());

        let replay = journal.replay(0);
        assert!(journal.is_following());
        assert!(replay.events.is_empty());

        journal.record("one", serde_json::json!({ "value": 1 }));
        assert_eq!(journal.replay(0).events.len(), 1);
    }

    #[test]
    fn replay_is_ordered_and_excludes_acknowledged_events() {
        let journal = HostEventJournal::new();
        journal.record("one", serde_json::json!({ "value": 1 }));
        journal.record("two", serde_json::json!({ "value": 2 }));

        let replay = journal.replay(1);
        assert!(!replay.resync_required);
        assert_eq!(replay.oldest_sequence, 1);
        assert_eq!(replay.latest_sequence, 2);
        assert_eq!(replay.events.len(), 1);
        assert_eq!(replay.events[0].sequence, 2);
        assert_eq!(replay.events[0].event, "two");
    }

    #[test]
    fn an_empty_journal_has_a_stable_initial_cursor() {
        let journal = HostEventJournal::new();
        let replay = journal.replay(0);
        assert_eq!(replay.oldest_sequence, 1);
        assert_eq!(replay.latest_sequence, 0);
        assert!(!replay.resync_required);
        assert!(replay.events.is_empty());
    }
}
