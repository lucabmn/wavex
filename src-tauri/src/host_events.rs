use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
    /// A remote client blocks on the journal instead of polling it, so a
    /// harness line reaches the socket at the speed it was published.
    published: Condvar,
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
            published: Condvar::new(),
        }
    }

    pub fn stream_id(&self) -> &str {
        &self.stream_id
    }

    fn is_following(&self) -> bool {
        self.following.load(Ordering::Relaxed)
    }

    pub fn record(&self, event: &str, payload: Value) {
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
        drop(journal);
        self.published.notify_all();
    }

    pub fn replay(&self, after_sequence: u64) -> HostEventReplay {
        self.following.store(true, Ordering::Relaxed);
        let journal = self
            .journal
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.snapshot(&journal, after_sequence)
    }

    /// Block until the journal moves past `after_sequence`, then hand back the
    /// backlog and the cursor that goes with it.
    ///
    /// The two are read under one lock acquisition on purpose: a `latest`
    /// sampled after the copy would let a client acknowledge a sequence whose
    /// event it never received, and every event after that would read as a gap.
    pub fn wait_for(&self, after_sequence: u64, timeout: Duration) -> HostEventReplay {
        self.following.store(true, Ordering::Relaxed);
        let deadline = Instant::now() + timeout;
        let mut journal = self
            .journal
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        loop {
            let replay = self.snapshot(&journal, after_sequence);
            if replay.resync_required || !replay.events.is_empty() {
                return replay;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return replay;
            }
            journal = self
                .published
                .wait_timeout(journal, remaining)
                .unwrap_or_else(|error| error.into_inner())
                .0;
        }
    }

    fn snapshot(&self, journal: &Journal, after_sequence: u64) -> HostEventReplay {
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

    #[test]
    fn waiting_returns_the_backlog_and_its_cursor_together() {
        let journal = HostEventJournal::new();
        journal.replay(0);
        journal.record("one", serde_json::json!({ "value": 1 }));
        journal.record("two", serde_json::json!({ "value": 2 }));

        let replay = journal.wait_for(0, Duration::from_millis(10));
        assert_eq!(replay.latest_sequence, 2);
        assert_eq!(
            replay.events.last().map(|event| event.sequence),
            Some(replay.latest_sequence)
        );
    }

    #[test]
    fn waiting_wakes_on_the_next_published_event() {
        use std::sync::Arc;

        let journal = Arc::new(HostEventJournal::new());
        journal.replay(0);
        let writer = Arc::clone(&journal);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            writer.record("late", serde_json::json!({}));
        });

        let replay = journal.wait_for(0, Duration::from_secs(5));
        assert_eq!(replay.events.len(), 1);
        assert_eq!(replay.events[0].event, "late");
    }

    #[test]
    fn waiting_gives_up_quietly_when_nothing_is_published() {
        let journal = HostEventJournal::new();
        journal.replay(0);

        let replay = journal.wait_for(0, Duration::from_millis(5));
        assert!(replay.events.is_empty());
        assert!(!replay.resync_required);
    }
}
