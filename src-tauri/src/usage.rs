//! Token and cost reporting, read from the provider CLIs' own transcripts.
//!
//! Every supported CLI already writes each assistant turn — with the token
//! counts the provider billed — to a session file under the user's home. Those
//! files are the source here, for two reasons: usage stays complete for turns
//! that were never driven through wavex, and reporting costs zero provider API
//! calls, so opening the view can never eat into a rate limit. `ccusage` and
//! t3code read the same files the same way.
//!
//! The scan is the expensive half, so it lives in Rust and returns
//! pre-aggregated `(day, provider, model)` buckets. Pricing and presentation
//! stay in `src/lib/usage/`, where the Vitest suite covers them.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::dirs_home;

/// Rates come from the table `ccusage` prices against, so figures line up with
/// the tool people already compare against.
const RATES_URL: &str =
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const RATES_TTL_MS: i64 = 24 * 60 * 60 * 1000;
const RATES_TIMEOUT: Duration = Duration::from_secs(15);
/// Guards against a truncated or hostile response filling memory.
const RATES_MAX_BYTES: u64 = 32 * 1024 * 1024;

/// Files are skipped by mtime before they are opened. The slack covers a
/// session whose last write lands just before local midnight on the first day
/// of the window.
const MTIME_SLACK_MS: i64 = 36 * 60 * 60 * 1000;

/// A transcript tree is walked to this depth. Claude nests one level
/// (`projects/<slug>/*.jsonl`), Codex three (`sessions/<y>/<m>/<d>/*.jsonl`).
const MAX_WALK_DEPTH: usize = 6;

/// Longest window the UI offers, plus slack, in whole days.
const MAX_DAYS: usize = 400;

/* -------------------------------------------------------------------------- */
/* Providers                                                                  */
/* -------------------------------------------------------------------------- */

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum Provider {
    Claude,
    Codex,
    Pi,
    Omp,
    Grok,
}

impl Provider {
    /// Scan order, and the order sources are reported in.
    const ALL: [Provider; 5] = [
        Provider::Claude,
        Provider::Codex,
        Provider::Pi,
        Provider::Omp,
        Provider::Grok,
    ];

    /// Matches `HarnessId` on the frontend so the existing labels and icons
    /// apply without a translation table.
    fn id(self) -> &'static str {
        match self {
            Provider::Claude => "claude",
            Provider::Codex => "codex",
            Provider::Pi => "pi",
            Provider::Omp => "omp",
            Provider::Grok => "grok",
        }
    }

    /// Transcript root, relative to the user's home.
    fn root(self) -> &'static str {
        match self {
            Provider::Claude => ".claude/projects",
            Provider::Codex => ".codex/sessions",
            Provider::Pi => ".pi/agent/sessions",
            Provider::Omp => ".omp/agent/sessions",
            Provider::Grok => ".grok/sessions",
        }
    }

    /// Grok keeps one `updates.jsonl` per session directory alongside other
    /// `.jsonl` files that carry no usage. Everyone else uses the whole tree.
    fn file_name(self) -> Option<&'static str> {
        match self {
            Provider::Grok => Some("updates.jsonl"),
            _ => None,
        }
    }

    /// Substring gate applied before `serde_json` sees a line.
    ///
    /// Transcripts are mostly tool output; only a minority of lines carry
    /// usage. Skipping the rest without parsing them is worth roughly an order
    /// of magnitude on a large window.
    fn line_gate(self, line: &str) -> bool {
        match self {
            // Codex needs the model and fork markers that arrive on their own
            // lines, so the reducer has to see those too.
            Provider::Codex => {
                line.contains("\"token_count\"")
                    || line.contains("\"turn_context\"")
                    || line.contains("\"session_meta\"")
            }
            Provider::Grok => line.contains("\"turn_completed\""),
            _ => line.contains("\"usage\""),
        }
    }
}

/* -------------------------------------------------------------------------- */
/* Wire types                                                                 */
/* -------------------------------------------------------------------------- */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageQuery {
    /// Day boundaries as epoch milliseconds, ascending, one more than the
    /// number of days requested.
    ///
    /// The frontend resolves these with `Intl`, which is the only thing that
    /// gets an arbitrary IANA zone right across a DST transition or a
    /// half-hour offset. Rust only has to place a timestamp between two of
    /// them, so no timezone database is needed here.
    pub day_starts_ms: Vec<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket {
    pub day_index: u32,
    pub provider: String,
    pub model: String,
    pub uncached_input_tokens: u64,
    pub cached_input_tokens: u64,
    pub cache_creation_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_tokens: u64,
    /// Set only on buckets whose records all carried a provider-reported cost.
    /// Buckets without one are priced from the rate table on the frontend, and
    /// the two never mix, so a cost is never counted twice.
    pub reported_cost_usd: Option<f64>,
    pub records: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSource {
    pub provider: String,
    /// `ok`, `missing` (no transcript directory) or `failed`.
    pub status: String,
    pub path: String,
    pub scanned_files: u32,
    /// Distinct sessions that contributed at least one record in the window.
    pub sessions: u32,
    pub message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub buckets: Vec<UsageBucket>,
    pub sources: Vec<UsageSource>,
    pub scan_duration_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRates {
    /// `fresh`, `cached` or `unavailable`.
    pub status: String,
    pub source: String,
    pub fetched_at_ms: Option<i64>,
    /// The raw LiteLLM document. Empty when no copy could be obtained, in
    /// which case every model reports as unpriced rather than the view failing.
    pub document: Option<String>,
}

/* -------------------------------------------------------------------------- */
/* Records                                                                    */
/* -------------------------------------------------------------------------- */

#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
struct Totals {
    uncached_input: u64,
    cached_input: u64,
    cache_creation: u64,
    output: u64,
    /// A subset of `output`, surfaced for the token mix. Never added on top.
    reasoning: u64,
}

impl Totals {
    fn tokens(&self) -> u64 {
        self.uncached_input + self.cached_input + self.cache_creation + self.output
    }

    fn add(&mut self, other: &Totals) {
        self.uncached_input += other.uncached_input;
        self.cached_input += other.cached_input;
        self.cache_creation += other.cache_creation;
        self.output += other.output;
        self.reasoning += other.reasoning;
    }
}

#[derive(Clone, Debug)]
struct Record {
    timestamp_ms: i64,
    model: Arc<str>,
    session_id: Arc<str>,
    totals: Totals,
    reported_cost_usd: Option<f64>,
    /// Key for cross-file de-duplication, or `None` when the record is
    /// inherently unique to its file.
    dedupe_key: Option<Arc<str>>,
}

/* -------------------------------------------------------------------------- */
/* Scan cache                                                                 */
/* -------------------------------------------------------------------------- */

#[derive(Clone)]
struct CachedFile {
    size: u64,
    mtime_ms: i64,
    records: Arc<Vec<Record>>,
}

/// Transcripts are append-only, so a file whose size and mtime are unchanged
/// can never parse to different usage. Holding the parse in memory makes every
/// scan after the first one effectively free; the cold scan is fast enough
/// that persisting this across launches would not earn its complexity.
static SCAN_CACHE: Mutex<Option<HashMap<PathBuf, CachedFile>>> = Mutex::new(None);

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

/// Scan every provider's transcripts and return priced-per-token buckets.
#[tauri::command]
pub async fn usage_summary(query: UsageQuery) -> Result<UsageSummary, String> {
    tauri::async_runtime::spawn_blocking(move || scan(&query))
        .await
        .map_err(|e| e.to_string())?
}

/// The LiteLLM rate table, refreshed at most daily and cached to disk so the
/// view keeps pricing while offline.
#[tauri::command]
pub async fn usage_model_rates(app: AppHandle) -> Result<ModelRates, String> {
    let cache_path = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("usage-model-rates.json"))
        .ok();
    tauri::async_runtime::spawn_blocking(move || load_model_rates(cache_path.as_deref()))
        .await
        .map_err(|e| e.to_string())
}

/* -------------------------------------------------------------------------- */
/* Scan                                                                       */
/* -------------------------------------------------------------------------- */

fn scan(query: &UsageQuery) -> Result<UsageSummary, String> {
    let day_starts = &query.day_starts_ms;
    if day_starts.len() < 2 {
        return Err("Usage window needs at least one day".into());
    }
    if day_starts.len() > MAX_DAYS + 1 {
        return Err("Usage window is too long".into());
    }
    if day_starts.windows(2).any(|pair| pair[1] <= pair[0]) {
        return Err("Usage window boundaries must ascend".into());
    }

    let started = Instant::now();
    let home = dirs_home().ok_or("Home directory is unavailable")?;
    let window_start_ms = day_starts[0];
    let mtime_floor_ms = window_start_ms - MTIME_SLACK_MS;

    let mut aggregator = Aggregator::new(day_starts);
    let mut sources = Vec::with_capacity(Provider::ALL.len());

    for provider in Provider::ALL {
        let root = Path::new(&home).join(provider.root());
        if !root.is_dir() {
            sources.push(UsageSource {
                provider: provider.id().into(),
                status: "missing".into(),
                path: root.to_string_lossy().into_owned(),
                scanned_files: 0,
                sessions: 0,
                message: None,
            });
            continue;
        }

        let mut files = Vec::new();
        let mut walk_error: Option<String> = None;
        collect_files(
            &root,
            provider,
            0,
            mtime_floor_ms,
            &mut files,
            &mut walk_error,
        );

        let mut scanned_files = 0u32;
        let mut sessions: HashSet<Arc<str>> = HashSet::new();
        for file in &files {
            let records = match records_for(provider, file) {
                Ok(records) => records,
                Err(message) => {
                    walk_error.get_or_insert(message);
                    continue;
                }
            };
            scanned_files += 1;
            for record in records.iter() {
                if aggregator.add(provider, record) {
                    sessions.insert(Arc::clone(&record.session_id));
                }
            }
        }

        sources.push(UsageSource {
            provider: provider.id().into(),
            status: if walk_error.is_some() { "failed" } else { "ok" }.into(),
            path: root.to_string_lossy().into_owned(),
            scanned_files,
            sessions: sessions.len() as u32,
            message: walk_error,
        });

        prune_cache(&root, &files, mtime_floor_ms);
    }

    Ok(UsageSummary {
        buckets: aggregator.finish(),
        sources,
        scan_duration_ms: started.elapsed().as_millis() as u64,
    })
}

struct ScannedFile {
    path: PathBuf,
    size: u64,
    mtime_ms: i64,
}

fn collect_files(
    dir: &Path,
    provider: Provider,
    depth: usize,
    mtime_floor_ms: i64,
    out: &mut Vec<ScannedFile>,
    error: &mut Option<String>,
) {
    if depth > MAX_WALK_DEPTH {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            error.get_or_insert(format!("Could not read {}: {err}", dir.display()));
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            collect_files(&path, provider, depth + 1, mtime_floor_ms, out, error);
            continue;
        }
        if !metadata.is_file() {
            continue;
        }

        let name = entry.file_name();
        let name = name.to_string_lossy();
        match provider.file_name() {
            Some(expected) if name != expected => continue,
            None if !name.ends_with(".jsonl") => continue,
            _ => {}
        }

        let mtime_ms = system_time_ms(metadata.modified().ok());
        if mtime_ms < mtime_floor_ms {
            continue;
        }
        out.push(ScannedFile {
            path,
            size: metadata.len(),
            mtime_ms,
        });
    }
}

fn records_for(provider: Provider, file: &ScannedFile) -> Result<Arc<Vec<Record>>, String> {
    if let Some(hit) = cache_lookup(&file.path, file.size, file.mtime_ms) {
        return Ok(hit);
    }
    let records = Arc::new(parse_file(provider, &file.path)?);
    cache_store(file, Arc::clone(&records));
    Ok(records)
}

fn cache_lookup(path: &Path, size: u64, mtime_ms: i64) -> Option<Arc<Vec<Record>>> {
    let guard = SCAN_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let entry = guard.as_ref()?.get(path)?;
    if entry.size == size && entry.mtime_ms == mtime_ms {
        Some(Arc::clone(&entry.records))
    } else {
        None
    }
}

fn cache_store(file: &ScannedFile, records: Arc<Vec<Record>>) {
    let mut guard = SCAN_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    guard.get_or_insert_with(HashMap::new).insert(
        file.path.clone(),
        CachedFile {
            size: file.size,
            mtime_ms: file.mtime_ms,
            records,
        },
    );
}

/// Drops entries for files that have disappeared.
///
/// Absence from the walk only proves deletion inside the window that was
/// actually walked: an entry older than the mtime floor was never looked for,
/// so evicting it would throw away a warm 90-day scan every time someone
/// looked at 7 days.
fn prune_cache(root: &Path, live: &[ScannedFile], mtime_floor_ms: i64) {
    let live: HashSet<&Path> = live.iter().map(|file| file.path.as_path()).collect();
    let mut guard = SCAN_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let Some(cache) = guard.as_mut() else {
        return;
    };
    cache.retain(|path, entry| {
        !path.starts_with(root) || entry.mtime_ms < mtime_floor_ms || live.contains(path.as_path())
    });
}

/* -------------------------------------------------------------------------- */
/* Aggregation                                                                */
/* -------------------------------------------------------------------------- */

#[derive(Default)]
struct MutableBucket {
    totals: Totals,
    reported_cost_usd: f64,
    records: u32,
}

struct Aggregator<'a> {
    day_starts: &'a [i64],
    buckets: HashMap<(u32, &'static str, Arc<str>, bool), MutableBucket>,
    seen: HashSet<Arc<str>>,
}

impl<'a> Aggregator<'a> {
    fn new(day_starts: &'a [i64]) -> Self {
        Self {
            day_starts,
            buckets: HashMap::new(),
            seen: HashSet::new(),
        }
    }

    /// Folds one record in, reporting whether it actually landed so callers can
    /// count sessions from what contributed rather than from what the mtime
    /// prefilter happened to admit.
    ///
    /// De-duplication is global across the whole scan, not per file: a resumed
    /// or forked session replays its parent's records into a new transcript, so
    /// the same key legitimately appears in several files.
    fn add(&mut self, provider: Provider, record: &Record) -> bool {
        if let Some(key) = &record.dedupe_key {
            if !self.seen.insert(Arc::clone(key)) {
                return false;
            }
        }
        let Some(day_index) = self.day_index(record.timestamp_ms) else {
            return false;
        };

        let reported = record.reported_cost_usd.is_some();
        let key = (
            day_index,
            provider.id(),
            Arc::clone(&record.model),
            reported,
        );
        let bucket = self.buckets.entry(key).or_default();
        bucket.totals.add(&record.totals);
        bucket.reported_cost_usd += record.reported_cost_usd.unwrap_or(0.0);
        bucket.records += 1;
        true
    }

    fn day_index(&self, timestamp_ms: i64) -> Option<u32> {
        if timestamp_ms < self.day_starts[0] {
            return None;
        }
        let index = self
            .day_starts
            .partition_point(|start| *start <= timestamp_ms);
        if index == 0 || index >= self.day_starts.len() {
            return None;
        }
        Some((index - 1) as u32)
    }

    fn finish(self) -> Vec<UsageBucket> {
        let mut buckets: Vec<UsageBucket> = self
            .buckets
            .into_iter()
            .map(
                |((day_index, provider, model, reported), bucket)| UsageBucket {
                    day_index,
                    provider: provider.into(),
                    model: model.to_string(),
                    uncached_input_tokens: bucket.totals.uncached_input,
                    cached_input_tokens: bucket.totals.cached_input,
                    cache_creation_tokens: bucket.totals.cache_creation,
                    output_tokens: bucket.totals.output,
                    reasoning_tokens: bucket.totals.reasoning,
                    reported_cost_usd: reported.then_some(bucket.reported_cost_usd),
                    records: bucket.records,
                },
            )
            .collect();
        // Stable ordering keeps the payload diffable and the tests meaningful.
        buckets.sort_by(|a, b| {
            a.day_index
                .cmp(&b.day_index)
                .then_with(|| a.provider.cmp(&b.provider))
                .then_with(|| a.model.cmp(&b.model))
                .then_with(|| {
                    a.reported_cost_usd
                        .is_some()
                        .cmp(&b.reported_cost_usd.is_some())
                })
        });
        buckets
    }
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

fn parse_file(provider: Provider, path: &Path) -> Result<Vec<Record>, String> {
    let file =
        File::open(path).map_err(|err| format!("Could not open {}: {err}", path.display()))?;
    let mut reader = BufReader::with_capacity(256 * 1024, file);
    let mut records = Vec::new();
    let mut codex_state = CodexState::default();
    // Pi and Omp name the file `<timestamp>_<session id>.jsonl`; the id inside
    // the session header would cost a second gate for the same value.
    let session_id: Arc<str> = session_id_from_path(path);
    let mut buffer = Vec::new();

    loop {
        buffer.clear();
        let read = reader
            .read_until(b'\n', &mut buffer)
            .map_err(|err| format!("Could not read {}: {err}", path.display()))?;
        if read == 0 {
            break;
        }
        // Transcripts are UTF-8, but a torn write must not abort the file.
        let line = String::from_utf8_lossy(&buffer);
        let line = line.trim_end_matches(['\n', '\r']);
        if line.is_empty() || !provider.line_gate(line) {
            continue;
        }
        match provider {
            Provider::Claude => {
                if let Some(record) = parse_claude_line(line) {
                    records.push(record);
                }
            }
            Provider::Codex => {
                if let Some(record) = parse_codex_line(line, &mut codex_state) {
                    records.push(record);
                }
            }
            Provider::Pi | Provider::Omp => {
                if let Some(record) = parse_pi_line(line, &session_id) {
                    records.push(record);
                }
            }
            Provider::Grok => parse_grok_line(line, &mut records),
        }
    }

    Ok(dedupe_within_file(records))
}

fn session_id_from_path(path: &Path) -> Arc<str> {
    let stem = path.file_stem().map(|value| value.to_string_lossy());
    let Some(stem) = stem else {
        return Arc::from("");
    };
    match stem.rsplit_once('_') {
        Some((_, id)) if !id.is_empty() => Arc::from(id),
        _ => Arc::from(stem.as_ref()),
    }
}

/// Within-file de-duplication, applied before an entry is cached.
///
/// The global pass at aggregate time still runs. Doing it here as well keeps a
/// cached entry self-consistent: if the global set were the only filter, a warm
/// hit for one file would be missing rows another file claimed on an earlier
/// scan, and totals would depend on scan order.
fn dedupe_within_file(records: Vec<Record>) -> Vec<Record> {
    let mut seen: HashSet<Arc<str>> = HashSet::new();
    let mut kept = Vec::with_capacity(records.len());
    for record in records {
        if let Some(key) = &record.dedupe_key {
            if !seen.insert(Arc::clone(key)) {
                continue;
            }
        }
        kept.push(record);
    }
    kept
}

/* --------------------------------- Claude --------------------------------- */

/// Claude Code writes one record per assistant *content block*, and every one
/// repeats the parent message's complete `usage` object. Summing them
/// overcounts by roughly 2.4x, so the caller must drop repeats by key.
fn parse_claude_line(line: &str) -> Option<Record> {
    let value: Value = serde_json::from_str(line).ok()?;
    if value.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let message = value.get("message")?;
    let usage = message.get("usage")?;
    if !usage.is_object() {
        return None;
    }
    let timestamp_ms = parse_rfc3339_ms(value.get("timestamp")?.as_str()?)?;
    let model = non_empty_str(message.get("model"))?;

    let message_id = non_empty_str(message.get("id"));
    let request_id = non_empty_str(value.get("requestId"));
    // Matches ccusage: prefer the message/request pair, fall back to whichever
    // half exists. Records with neither cannot be de-duplicated.
    let dedupe_key = match (message_id, request_id) {
        (None, None) => None,
        (message_id, request_id) => Some(Arc::from(format!(
            "{}:{}",
            message_id.unwrap_or(""),
            request_id.unwrap_or("")
        ))),
    };

    Some(Record {
        timestamp_ms,
        model: Arc::from(model),
        session_id: Arc::from(non_empty_str(value.get("sessionId")).unwrap_or("")),
        totals: Totals {
            uncached_input: u64_field(usage, "input_tokens"),
            cached_input: u64_field(usage, "cache_read_input_tokens"),
            cache_creation: u64_field(usage, "cache_creation_input_tokens"),
            output: u64_field(usage, "output_tokens"),
            // Anthropic folds thinking into output and does not break it out.
            reasoning: 0,
        },
        reported_cost_usd: f64_field(&value, "costUSD"),
        dedupe_key,
    })
}

/* --------------------------------- Codex ---------------------------------- */

/// A forked or subagent rollout opens with the parent's history copied in,
/// every line re-stamped to the fork instant. Those copies are written in one
/// synchronous burst, while the child's first genuine usage event only lands
/// after a real model turn. One second of separation splits the two cleanly;
/// `ccusage` uses the same threshold.
const FORK_COPY_MAX_GAP_MS: i64 = 1000;

#[derive(Default)]
struct CodexState {
    /// `token_count` events carry no model, so it is carried forward from the
    /// most recent `turn_context`. A session that switches models mid-run
    /// attributes correctly from the switch onward.
    model: Option<Arc<str>>,
    session_id: Arc<str>,
    last_signature: Option<String>,
    saw_session_meta: bool,
    suppressing_fork_copies: bool,
    fork_copy_anchor_ms: i64,
}

fn parse_codex_line(line: &str, state: &mut CodexState) -> Option<Record> {
    let value: Value = serde_json::from_str(line).ok()?;
    let payload = value.get("payload")?;
    if !payload.is_object() {
        return None;
    }
    let record_type = value.get("type").and_then(Value::as_str);

    if record_type == Some("session_meta") {
        // Only the first meta describes this file's own session. A forked
        // rollout repeats its ancestors' metas right after it; letting those
        // through would reassign every later record to an ancestor session.
        if state.saw_session_meta {
            return None;
        }
        state.saw_session_meta = true;
        if let Some(id) =
            non_empty_str(payload.get("id")).or_else(|| non_empty_str(payload.get("session_id")))
        {
            state.session_id = Arc::from(id);
        }
        if let Some(timestamp_ms) = value
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_rfc3339_ms)
        {
            if is_forked_session_meta(payload) {
                state.suppressing_fork_copies = true;
                state.fork_copy_anchor_ms = timestamp_ms;
            }
        }
        return None;
    }

    if record_type == Some("turn_context") {
        if let Some(model) = non_empty_str(payload.get("model")) {
            state.model = Some(Arc::from(model));
        }
        return None;
    }

    if payload.get("type").and_then(Value::as_str) != Some("token_count") {
        return None;
    }

    // Deltas come from `last_token_usage`. Summing those across a session
    // reconciles with its final `total_token_usage`, provided consecutive
    // duplicate events are dropped.
    let last = payload.get("info")?.get("last_token_usage")?;
    if !last.is_object() {
        return None;
    }

    // Only an otherwise-eligible event may consume the duplicate signature. A
    // `token_count` arriving before its `turn_context` (no model yet) must not
    // poison it, or the re-emitted copy once the model is known would be
    // skipped as a duplicate and those tokens never counted.
    let timestamp_ms = parse_rfc3339_ms(value.get("timestamp")?.as_str()?)?;
    let model = Arc::clone(state.model.as_ref()?);

    // Codex re-emits an unchanged `token_count` on some stream boundaries.
    let signature = last.to_string();
    if state.last_signature.as_deref() == Some(signature.as_str()) {
        return None;
    }
    state.last_signature = Some(signature);

    // In a forked rollout the copied history was already counted from the
    // parent's own file. Drop the leading burst; the first usage event
    // separated from its predecessor by a real turn's worth of time ends it.
    if state.suppressing_fork_copies {
        if timestamp_ms - state.fork_copy_anchor_ms < FORK_COPY_MAX_GAP_MS {
            state.fork_copy_anchor_ms = timestamp_ms;
            return None;
        }
        state.suppressing_fork_copies = false;
    }

    let input = u64_field(last, "input_tokens");
    let cached_input = u64_field(last, "cached_input_tokens");
    let cache_creation = u64_field(last, "cache_write_input_tokens");
    let output = u64_field(last, "output_tokens");
    let totals = Totals {
        // Codex reports `input_tokens` inclusive of the cached portion.
        uncached_input: input
            .saturating_sub(cached_input)
            .saturating_sub(cache_creation),
        cached_input,
        cache_creation,
        output,
        reasoning: u64_field(last, "reasoning_output_tokens").min(output),
    };
    if totals.tokens() == 0 {
        return None;
    }

    Some(Record {
        timestamp_ms,
        model,
        session_id: Arc::clone(&state.session_id),
        totals,
        // Codex does not report cost in the rollout.
        reported_cost_usd: None,
        // Events surviving the fork-copy suppression are unique to this file.
        dedupe_key: None,
    })
}

fn is_forked_session_meta(payload: &Value) -> bool {
    if payload
        .get("forked_from_id")
        .and_then(Value::as_str)
        .is_some()
    {
        return true;
    }
    payload
        .get("source")
        .and_then(|source| source.get("subagent"))
        .and_then(|subagent| subagent.get("thread_spawn"))
        .and_then(|spawn| spawn.get("parent_thread_id"))
        .and_then(Value::as_str)
        .is_some()
}

/* ------------------------------- Pi and Omp ------------------------------- */

/// Pi and Omp share a CLI and a transcript format, differing only in the home
/// directory. Assistant messages carry both the token split and a cost the
/// provider already worked out, so those turns never need the rate table.
///
/// Unlike Codex, `input` here excludes the cached and cache-write portions.
fn parse_pi_line(line: &str, session_id: &Arc<str>) -> Option<Record> {
    let value: Value = serde_json::from_str(line).ok()?;
    if value.get("type")?.as_str()? != "message" {
        return None;
    }
    let message = value.get("message")?;
    if message.get("role").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let usage = message.get("usage")?;
    if !usage.is_object() {
        return None;
    }
    let model = non_empty_str(message.get("model"))?;
    let timestamp_ms = value
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(parse_rfc3339_ms)
        .or_else(|| message.get("timestamp").and_then(Value::as_i64))?;

    let output = u64_field(usage, "output");
    let totals = Totals {
        uncached_input: u64_field(usage, "input"),
        cached_input: u64_field(usage, "cacheRead"),
        cache_creation: u64_field(usage, "cacheWrite"),
        output,
        reasoning: u64_field(usage, "reasoning").min(output),
    };
    if totals.tokens() == 0 {
        return None;
    }

    Some(Record {
        timestamp_ms,
        model: Arc::from(model),
        session_id: Arc::clone(session_id),
        totals,
        reported_cost_usd: usage.get("cost").and_then(|cost| f64_field(cost, "total")),
        // A resumed or forked run replays earlier responses into the new file,
        // so the provider's response id is what keeps them counted once.
        dedupe_key: non_empty_str(message.get("responseId")).map(Arc::from),
    })
}

/* ---------------------------------- Grok ---------------------------------- */

/// Grok reports cost in integer ticks where 1 USD is 10^10 ticks.
const GROK_COST_USD_TICKS_PER_DOLLAR: f64 = 10_000_000_000.0;

fn grok_cost_usd(value: Option<&Value>) -> Option<f64> {
    let ticks = value?.as_f64()?;
    if !ticks.is_finite() || ticks < 0.0 {
        return None;
    }
    Some(ticks / GROK_COST_USD_TICKS_PER_DOLLAR)
}

/// Usage lands on `turn_completed` session updates. Per-model breakdowns live
/// under `usage.modelUsage`; when present each model becomes its own record and
/// the aggregate cost is split across them.
fn parse_grok_line(line: &str, out: &mut Vec<Record>) {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return;
    };
    let Some(params) = value.get("params") else {
        return;
    };
    let Some(update) = params.get("update") else {
        return;
    };
    if update.get("sessionUpdate").and_then(Value::as_str) != Some("turn_completed") {
        return;
    }
    let Some(usage) = update.get("usage") else {
        return;
    };
    if !usage.is_object() {
        return;
    }

    // Prefer the high-resolution agent clock; fall back to the outer seconds.
    let timestamp_ms = params
        .get("_meta")
        .and_then(|meta| meta.get("agentTimestampMs"))
        .and_then(Value::as_i64)
        .or_else(|| {
            let raw = value.get("timestamp")?.as_f64()?;
            if !raw.is_finite() {
                return None;
            }
            Some(if raw > 1e12 {
                raw as i64
            } else {
                (raw * 1000.0) as i64
            })
        });
    let Some(timestamp_ms) = timestamp_ms else {
        return;
    };

    let session_id: Arc<str> = Arc::from(non_empty_str(params.get("sessionId")).unwrap_or(""));
    let prompt_id = non_empty_str(update.get("prompt_id"));
    // Without a prompt id two same-instant updates cannot be told apart.
    let dedupe_key = |session: &str, model: &str| {
        prompt_id.map(|prompt| Arc::from(format!("{session}:{prompt}:{model}")))
    };

    let models: Vec<(String, &Value)> = usage
        .get("modelUsage")
        .and_then(Value::as_object)
        .map(|entries| {
            entries
                .iter()
                .filter(|(model, _)| !model.is_empty())
                .map(|(model, totals)| (model.clone(), totals))
                .collect()
        })
        .unwrap_or_default();

    if models.is_empty() {
        let totals = grok_totals(usage);
        if totals.tokens() == 0 {
            return;
        }
        out.push(Record {
            timestamp_ms,
            totals,
            reported_cost_usd: grok_cost_usd(usage.get("costUsdTicks")),
            dedupe_key: dedupe_key(&session_id, "grok"),
            model: Arc::from("grok"),
            session_id,
        });
        return;
    }

    // Models with their own ticks keep them. Whatever aggregate cost is left
    // over is pro-rated across the models that reported none, by token share
    // among those models only.
    let mut used_ticked_usd = 0.0;
    let mut unticked_tokens = 0u64;
    for (_, raw) in &models {
        let tokens = grok_totals(raw).tokens();
        if tokens == 0 {
            continue;
        }
        match grok_cost_usd(raw.get("costUsdTicks")) {
            Some(cost) => used_ticked_usd += cost,
            None => unticked_tokens += tokens,
        }
    }
    let remaining_usd =
        grok_cost_usd(usage.get("costUsdTicks")).map(|total| (total - used_ticked_usd).max(0.0));

    for (model, raw) in &models {
        let totals = grok_totals(raw);
        if totals.tokens() == 0 {
            continue;
        }
        let reported_cost_usd = grok_cost_usd(raw.get("costUsdTicks")).or_else(|| {
            let remaining = remaining_usd?;
            if unticked_tokens == 0 {
                return None;
            }
            Some(remaining * (totals.tokens() as f64 / unticked_tokens as f64))
        });
        out.push(Record {
            timestamp_ms,
            model: Arc::from(model.as_str()),
            session_id: Arc::clone(&session_id),
            totals,
            reported_cost_usd,
            dedupe_key: dedupe_key(&session_id, model),
        });
    }
}

fn grok_totals(value: &Value) -> Totals {
    let cached_input = u64_field(value, "cachedReadTokens");
    let cache_creation = u64_field(value, "cacheCreationTokens");
    let output = u64_field(value, "outputTokens");
    Totals {
        // Grok reports `inputTokens` inclusive of the cached portion.
        uncached_input: u64_field(value, "inputTokens")
            .saturating_sub(cached_input)
            .saturating_sub(cache_creation),
        cached_input,
        cache_creation,
        output,
        reasoning: u64_field(value, "reasoningTokens").min(output),
    }
}

/* -------------------------------------------------------------------------- */
/* Rate table                                                                 */
/* -------------------------------------------------------------------------- */

fn load_model_rates(cache_path: Option<&Path>) -> ModelRates {
    let cached = cache_path.and_then(read_rates_cache);
    let now_ms = now_ms();
    if let Some((fetched_at_ms, document)) = &cached {
        if now_ms - fetched_at_ms < RATES_TTL_MS {
            return ModelRates {
                status: "cached".into(),
                source: RATES_URL.into(),
                fetched_at_ms: Some(*fetched_at_ms),
                document: Some(document.clone()),
            };
        }
    }

    match fetch_rates() {
        Some(document) => {
            if let Some(path) = cache_path {
                write_rates_cache(path, now_ms, &document);
            }
            ModelRates {
                status: "fresh".into(),
                source: RATES_URL.into(),
                fetched_at_ms: Some(now_ms),
                document: Some(document),
            }
        }
        // The refresh failed, so whatever is on disk is now past its TTL and
        // must not keep claiming to be fresh. Serving it beats reporting every
        // model as unpriced.
        None => match cached {
            Some((fetched_at_ms, document)) => ModelRates {
                status: "cached".into(),
                source: RATES_URL.into(),
                fetched_at_ms: Some(fetched_at_ms),
                document: Some(document),
            },
            None => ModelRates {
                status: "unavailable".into(),
                source: RATES_URL.into(),
                fetched_at_ms: None,
                document: None,
            },
        },
    }
}

fn fetch_rates() -> Option<String> {
    let agent = ureq::AgentBuilder::new().timeout(RATES_TIMEOUT).build();
    let response = agent.get(RATES_URL).call().ok()?;
    let mut body = String::new();
    response
        .into_reader()
        .take(RATES_MAX_BYTES)
        .read_to_string(&mut body)
        .ok()?;
    // A truncated or non-JSON body would poison the cache for a day.
    serde_json::from_str::<Value>(&body).ok()?;
    Some(body)
}

fn read_rates_cache(path: &Path) -> Option<(i64, String)> {
    let raw = std::fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let fetched_at_ms = value.get("fetchedAtMs")?.as_i64()?;
    let document = value.get("document")?;
    Some((fetched_at_ms, document.to_string()))
}

fn write_rates_cache(path: &Path, fetched_at_ms: i64, document: &str) {
    let Ok(parsed) = serde_json::from_str::<Value>(document) else {
        return;
    };
    let payload = serde_json::json!({ "fetchedAtMs": fetched_at_ms, "document": parsed });
    let Ok(raw) = serde_json::to_string(&payload) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, raw);
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

fn non_empty_str(value: Option<&Value>) -> Option<&str> {
    let text = value?.as_str()?.trim();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn u64_field(value: &Value, key: &str) -> u64 {
    let Some(number) = value.get(key).and_then(Value::as_f64) else {
        return 0;
    };
    if !number.is_finite() || number <= 0.0 {
        return 0;
    }
    number as u64
}

fn f64_field(value: &Value, key: &str) -> Option<f64> {
    let number = value.get(key)?.as_f64()?;
    number.is_finite().then_some(number)
}

fn system_time_ms(time: Option<SystemTime>) -> i64 {
    time.and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn now_ms() -> i64 {
    system_time_ms(Some(SystemTime::now()))
}

/// Parses the RFC 3339 timestamps the CLIs write, with `Z` or a numeric offset.
///
/// A date crate would be a dependency for one function: transcripts only ever
/// carry this one shape, and the civil-day arithmetic below is exact.
fn parse_rfc3339_ms(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 19 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    if bytes[10] != b'T' && bytes[10] != b't' && bytes[10] != b' ' {
        return None;
    }
    let year: i64 = text.get(0..4)?.parse().ok()?;
    let month: i64 = text.get(5..7)?.parse().ok()?;
    let day: i64 = text.get(8..10)?.parse().ok()?;
    let hour: i64 = text.get(11..13)?.parse().ok()?;
    let minute: i64 = text.get(14..16)?.parse().ok()?;
    let second: i64 = text.get(17..19)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let mut rest = text.get(19..)?;
    let mut millis = 0i64;
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits: String = fraction.chars().take_while(char::is_ascii_digit).collect();
        rest = &fraction[digits.len()..];
        let mut scaled = digits.clone();
        scaled.truncate(3);
        while scaled.len() < 3 {
            scaled.push('0');
        }
        millis = scaled.parse().ok()?;
    }

    let offset_minutes = match rest.as_bytes().first() {
        None | Some(b'Z') | Some(b'z') => 0,
        Some(sign @ (b'+' | b'-')) => {
            let hours: i64 = rest.get(1..3)?.parse().ok()?;
            let minutes: i64 = rest.get(4..6).unwrap_or("00").parse().unwrap_or(0);
            let magnitude = hours * 60 + minutes;
            if *sign == b'-' {
                -magnitude
            } else {
                magnitude
            }
        }
        _ => return None,
    };

    let days = days_from_civil(year, month, day);
    let seconds = days * 86_400 + hour * 3_600 + minute * 60 + second - offset_minutes * 60;
    Some(seconds * 1000 + millis)
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's
/// `days_from_civil`).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day_starts(count: usize) -> Vec<i64> {
        (0..=count).map(|day| day as i64 * 86_400_000).collect()
    }

    #[test]
    fn parses_rfc3339_variants() {
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00.250Z"), Some(250));
        // Fractions shorter or longer than milliseconds still land exactly.
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00.2Z"), Some(200));
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00.123456Z"), Some(123));
        assert_eq!(
            parse_rfc3339_ms("2026-06-15T13:15:15.235Z"),
            Some(1_781_529_315_235)
        );
        assert_eq!(
            parse_rfc3339_ms("2026-06-15T15:15:15.235+02:00"),
            Some(1_781_529_315_235)
        );
        assert_eq!(parse_rfc3339_ms("not a timestamp"), None);
    }

    #[test]
    fn claude_line_carries_usage_and_dedupe_key() {
        let line = r#"{"type":"assistant","timestamp":"2026-06-15T13:15:15.235Z","sessionId":"s1","requestId":"req_1","message":{"id":"msg_1","model":"claude-opus-5","usage":{"input_tokens":2,"cache_creation_input_tokens":15014,"cache_read_input_tokens":21335,"output_tokens":266}}}"#;
        let record = parse_claude_line(line).expect("record");
        assert_eq!(record.model.as_ref(), "claude-opus-5");
        assert_eq!(record.session_id.as_ref(), "s1");
        assert_eq!(record.totals.uncached_input, 2);
        assert_eq!(record.totals.cached_input, 21335);
        assert_eq!(record.totals.cache_creation, 15014);
        assert_eq!(record.totals.output, 266);
        assert_eq!(record.dedupe_key.as_deref(), Some("msg_1:req_1"));
        assert_eq!(record.reported_cost_usd, None);
    }

    #[test]
    fn claude_non_assistant_lines_are_ignored() {
        assert!(parse_claude_line(r#"{"type":"user","message":{"usage":{}}}"#).is_none());
        assert!(parse_claude_line("not json").is_none());
    }

    #[test]
    fn repeated_content_blocks_collapse_to_one_record() {
        let line = r#"{"type":"assistant","timestamp":"2026-06-15T13:15:15.235Z","sessionId":"s1","requestId":"req_1","message":{"id":"msg_1","model":"claude-opus-5","usage":{"input_tokens":10,"output_tokens":5}}}"#;
        let records = vec![
            parse_claude_line(line).expect("record"),
            parse_claude_line(line).expect("record"),
        ];
        assert_eq!(dedupe_within_file(records).len(), 1);
    }

    #[test]
    fn codex_carries_model_forward_and_drops_repeats() {
        let mut state = CodexState::default();
        assert!(parse_codex_line(
            r#"{"type":"session_meta","timestamp":"2026-06-15T13:00:00.000Z","payload":{"id":"sess-1"}}"#,
            &mut state,
        )
        .is_none());
        // A token_count before the turn_context has no model and must not
        // consume the duplicate signature.
        let usage = r#"{"timestamp":"2026-06-15T13:15:15.235Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":15967,"cached_input_tokens":4992,"output_tokens":364,"reasoning_output_tokens":100}}}}"#;
        assert!(parse_codex_line(usage, &mut state).is_none());
        assert!(parse_codex_line(
            r#"{"type":"turn_context","timestamp":"2026-06-15T13:15:00.000Z","payload":{"model":"gpt-5.6-codex"}}"#,
            &mut state,
        )
        .is_none());

        let record = parse_codex_line(usage, &mut state).expect("record");
        assert_eq!(record.model.as_ref(), "gpt-5.6-codex");
        assert_eq!(record.session_id.as_ref(), "sess-1");
        // input_tokens is inclusive of the cached portion.
        assert_eq!(record.totals.uncached_input, 15967 - 4992);
        assert_eq!(record.totals.cached_input, 4992);
        assert_eq!(record.totals.output, 364);
        assert_eq!(record.totals.reasoning, 100);
        assert!(record.dedupe_key.is_none());

        // The identical re-emission is dropped.
        assert!(parse_codex_line(usage, &mut state).is_none());
    }

    #[test]
    fn codex_suppresses_the_fork_copy_burst() {
        let mut state = CodexState::default();
        parse_codex_line(
            r#"{"type":"session_meta","timestamp":"2026-06-15T13:00:00.000Z","payload":{"id":"fork-1","forked_from_id":"parent-1"}}"#,
            &mut state,
        );
        parse_codex_line(
            r#"{"type":"turn_context","timestamp":"2026-06-15T13:00:00.000Z","payload":{"model":"gpt-5.6-codex"}}"#,
            &mut state,
        );
        let copy = r#"{"timestamp":"2026-06-15T13:00:00.020Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"output_tokens":10}}}}"#;
        assert!(parse_codex_line(copy, &mut state).is_none());
        let own = r#"{"timestamp":"2026-06-15T13:00:30.000Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":200,"output_tokens":20}}}}"#;
        assert!(parse_codex_line(own, &mut state).is_some());
    }

    #[test]
    fn pi_line_keeps_input_exclusive_of_cache() {
        let session: Arc<str> = Arc::from("sess-9");
        let line = r#"{"type":"message","timestamp":"2026-06-15T13:15:15.235Z","message":{"role":"assistant","model":"gpt-5.6-sol","responseId":"resp_1","usage":{"input":8914,"output":51,"cacheRead":1000,"cacheWrite":20,"reasoning":16,"totalTokens":9985,"cost":{"total":0.0461}}}}"#;
        let record = parse_pi_line(line, &session).expect("record");
        assert_eq!(record.totals.uncached_input, 8914);
        assert_eq!(record.totals.cached_input, 1000);
        assert_eq!(record.totals.cache_creation, 20);
        assert_eq!(record.totals.output, 51);
        assert_eq!(record.totals.reasoning, 16);
        assert_eq!(record.totals.tokens(), 8914 + 1000 + 20 + 51);
        assert_eq!(record.reported_cost_usd, Some(0.0461));
        assert_eq!(record.dedupe_key.as_deref(), Some("resp_1"));
        assert_eq!(record.session_id.as_ref(), "sess-9");
    }

    #[test]
    fn grok_splits_aggregate_cost_across_models() {
        let mut records = Vec::new();
        let line = r#"{"timestamp":1781507715,"params":{"sessionId":"g1","_meta":{"agentTimestampMs":1781507715235},"update":{"sessionUpdate":"turn_completed","prompt_id":"p1","usage":{"inputTokens":300,"outputTokens":60,"costUsdTicks":30000000000,"modelUsage":{"grok-code":{"inputTokens":100,"outputTokens":20},"grok-fast":{"inputTokens":200,"outputTokens":40}}}}}}"#;
        parse_grok_line(line, &mut records);
        assert_eq!(records.len(), 2);
        let total: f64 = records
            .iter()
            .map(|record| record.reported_cost_usd.unwrap_or(0.0))
            .sum();
        assert!((total - 3.0).abs() < 1e-9);
        // The split follows token share: 120 of 360 tokens.
        let code = records
            .iter()
            .find(|record| record.model.as_ref() == "grok-code")
            .expect("grok-code");
        assert!((code.reported_cost_usd.unwrap() - 1.0).abs() < 1e-9);
        assert_eq!(code.dedupe_key.as_deref(), Some("g1:p1:grok-code"));
    }

    #[test]
    fn aggregator_buckets_by_day_and_splits_cost_sources() {
        let starts = day_starts(2);
        let mut aggregator = Aggregator::new(&starts);
        let priced = Record {
            timestamp_ms: 1_000,
            model: Arc::from("model-a"),
            session_id: Arc::from("s1"),
            totals: Totals {
                uncached_input: 10,
                output: 5,
                ..Totals::default()
            },
            reported_cost_usd: None,
            dedupe_key: None,
        };
        let reported = Record {
            reported_cost_usd: Some(0.5),
            ..priced.clone()
        };
        assert!(aggregator.add(Provider::Claude, &priced));
        assert!(aggregator.add(Provider::Claude, &reported));
        // Second day.
        assert!(aggregator.add(
            Provider::Claude,
            &Record {
                timestamp_ms: 86_400_000 + 5,
                ..priced.clone()
            },
        ));
        // Outside the window on both ends.
        assert!(!aggregator.add(
            Provider::Claude,
            &Record {
                timestamp_ms: -1,
                ..priced.clone()
            },
        ));
        assert!(!aggregator.add(
            Provider::Claude,
            &Record {
                timestamp_ms: 2 * 86_400_000,
                ..priced.clone()
            },
        ));

        let buckets = aggregator.finish();
        assert_eq!(buckets.len(), 3);
        assert_eq!(buckets[0].day_index, 0);
        assert_eq!(buckets[0].reported_cost_usd, None);
        assert_eq!(buckets[1].day_index, 0);
        assert_eq!(buckets[1].reported_cost_usd, Some(0.5));
        assert_eq!(buckets[2].day_index, 1);
    }

    #[test]
    fn aggregator_drops_duplicates_across_files() {
        let starts = day_starts(1);
        let mut aggregator = Aggregator::new(&starts);
        let record = Record {
            timestamp_ms: 1_000,
            model: Arc::from("model-a"),
            session_id: Arc::from("s1"),
            totals: Totals {
                uncached_input: 10,
                ..Totals::default()
            },
            reported_cost_usd: None,
            dedupe_key: Some(Arc::from("msg_1:req_1")),
        };
        assert!(aggregator.add(Provider::Claude, &record));
        assert!(!aggregator.add(Provider::Claude, &record));
        let buckets = aggregator.finish();
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].uncached_input_tokens, 10);
    }

    #[test]
    fn scan_rejects_a_malformed_window() {
        assert!(scan(&UsageQuery {
            day_starts_ms: vec![0]
        })
        .is_err());
        assert!(scan(&UsageQuery {
            day_starts_ms: vec![10, 0]
        })
        .is_err());
    }

    #[test]
    fn session_id_comes_from_the_file_stem() {
        let path = Path::new("/tmp/2026-09-02T17-29-08-224Z_01a0632a-db80.jsonl");
        assert_eq!(session_id_from_path(path).as_ref(), "01a0632a-db80");
        assert_eq!(
            session_id_from_path(Path::new("/tmp/plain.jsonl")).as_ref(),
            "plain"
        );
    }

    struct TempDir(PathBuf);

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn temp_dir(label: &str) -> TempDir {
        let dir = std::env::temp_dir().join(format!("wavex-usage-{label}-{}", now_ms()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        TempDir(dir)
    }

    #[test]
    fn walks_nested_transcripts_and_skips_other_files() {
        let dir = temp_dir("walk");
        let nested = dir.0.join("2026/06/15");
        std::fs::create_dir_all(&nested).expect("nested");
        std::fs::write(nested.join("rollout.jsonl"), "").expect("write");
        std::fs::write(dir.0.join("notes.txt"), "").expect("write");

        let mut files = Vec::new();
        let mut error = None;
        collect_files(&dir.0, Provider::Codex, 0, 0, &mut files, &mut error);
        assert_eq!(error, None);
        assert_eq!(files.len(), 1);
        assert!(files[0].path.ends_with("rollout.jsonl"));
    }

    #[test]
    fn walk_skips_files_older_than_the_window() {
        let dir = temp_dir("mtime");
        std::fs::write(dir.0.join("old.jsonl"), "").expect("write");

        let mut files = Vec::new();
        let mut error = None;
        // A floor far in the future stands in for a file written long ago.
        collect_files(
            &dir.0,
            Provider::Claude,
            0,
            now_ms() * 2,
            &mut files,
            &mut error,
        );
        assert_eq!(error, None);
        assert!(files.is_empty());
    }

    #[test]
    fn parses_a_pi_transcript_end_to_end() {
        let dir = temp_dir("pi");
        let path = dir.0.join("2026-09-02T17-29-08-224Z_sess-7.jsonl");
        std::fs::write(
            &path,
            concat!(
                r#"{"type":"session","id":"sess-7","timestamp":"2026-09-02T17:29:08.224Z"}"#,
                "\n",
                r#"{"type": "message", "timestamp": "2026-09-02T17:29:10.000Z", "message": {"role": "user", "content": []}}"#,
                "\n",
                r#"{"type": "message", "timestamp": "2026-09-02T17:29:12.000Z", "message": {"role": "assistant", "model": "gpt-5.6-sol", "responseId": "resp_1", "usage": {"input": 100, "output": 10, "cacheRead": 0, "cacheWrite": 0, "reasoning": 4, "cost": {"total": 0.25}}}}"#,
                "\n",
                // The same response replayed after a resume: counted once.
                r#"{"type": "message", "timestamp": "2026-09-02T17:29:12.000Z", "message": {"role": "assistant", "model": "gpt-5.6-sol", "responseId": "resp_1", "usage": {"input": 100, "output": 10, "cost": {"total": 0.25}}}}"#,
                "\n",
                // A torn final line must not fail the file.
                r#"{"type": "message", "mes"#,
            ),
        )
        .expect("write");

        let records = parse_file(Provider::Pi, &path).expect("records");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].session_id.as_ref(), "sess-7");
        assert_eq!(records[0].totals.output, 10);
        assert_eq!(records[0].reported_cost_usd, Some(0.25));
    }
}
