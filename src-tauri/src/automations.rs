//! Storage for scheduled agent tasks.
//!
//! Rust is the clerk here, not the scheduler: it stores a definition, an
//! instant to fire at, and a bounded run history, and it never parses a
//! schedule. Intervals, weekdays, time zones, and daylight-saving policy live
//! once in `src/lib/automations/`, which computes the next instant and writes
//! it back. Implementing that twice would mean testing it once.
//!
//! What does belong here is the part storage can guarantee and a window
//! cannot: a run is claimed inside a transaction, so however many windows tick
//! at the same moment, exactly one of them starts a due occurrence.
//!
//! The database is the profile's, so definitions and history are
//! profile-scoped for free, and a profile switch reopens the store beneath
//! these queries the same way it does for sessions.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::session_store::{now_millis, validate_id, SessionStore};

const NAME_MAX: usize = 64;
const PROMPT_MAX: usize = 100_000;
/// Per-automation history cap. Mirrors `RUN_HISTORY_MAX` in TypeScript.
const RUN_HISTORY_MAX: i64 = 50;
const RUN_LIST_MAX: i64 = 200;

/// How long a run may go without its driver saying so before another window
/// may settle it. Comfortably more than the tick that renews it, so a busy or
/// throttled window does not lose a run it is still driving.
const RUN_LEASE_MS: i64 = 3 * 60 * 1000;

/// When this process started. A run row still marked `running` from before it
/// cannot be live — the harness children died with the process that owned
/// them — while a run another window started a moment ago is. Without the
/// distinction, opening a second window would end the first window's run.
pub struct Automations {
    started_at: i64,
}

pub fn init(app: &AppHandle) {
    app.manage(Automations {
        started_at: now_millis(),
    });
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub project_ref: String,
    pub cwd: String,
    pub host_id: String,
    pub harness: String,
    pub model: String,
    pub runtime_mode: String,
    pub schedule: Value,
    pub time_zone: String,
    pub dst_policy: String,
    pub overlap_policy: String,
    pub missed_policy: String,
    pub notify: bool,
    pub enabled: bool,
    pub end_at_ms: Option<i64>,
    pub max_runs: Option<i64>,
    pub next_due_at: Option<i64>,
    pub last_run_at: Option<i64>,
    pub run_count: i64,
    pub paused_reason: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationUpsert {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub project_ref: String,
    pub cwd: String,
    pub host_id: String,
    pub harness: String,
    #[serde(default)]
    pub model: String,
    pub runtime_mode: String,
    pub schedule: Value,
    pub time_zone: String,
    pub dst_policy: String,
    pub overlap_policy: String,
    pub missed_policy: String,
    #[serde(default = "yes")]
    pub notify: bool,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub end_at_ms: Option<i64>,
    #[serde(default)]
    pub max_runs: Option<i64>,
    #[serde(default)]
    pub next_due_at: Option<i64>,
    #[serde(default)]
    pub paused_reason: String,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRun {
    pub id: String,
    pub automation_id: String,
    pub session_id: Option<String>,
    pub due_at: i64,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub status: String,
    pub error: Option<String>,
    pub summary: Option<String>,
}

pub fn ensure_automations_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS automations (
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           prompt TEXT NOT NULL,
           project_ref TEXT NOT NULL,
           cwd TEXT NOT NULL,
           host_id TEXT NOT NULL DEFAULT 'local',
           harness TEXT NOT NULL,
           model TEXT NOT NULL DEFAULT '',
           runtime_mode TEXT NOT NULL DEFAULT 'supervised',
           schedule_json TEXT NOT NULL,
           time_zone TEXT NOT NULL DEFAULT 'UTC',
           dst_policy TEXT NOT NULL DEFAULT 'shift',
           overlap_policy TEXT NOT NULL DEFAULT 'skip',
           missed_policy TEXT NOT NULL DEFAULT 'once',
           notify INTEGER NOT NULL DEFAULT 1,
           enabled INTEGER NOT NULL DEFAULT 0,
           end_at INTEGER,
           max_runs INTEGER,
           next_due_at INTEGER,
           last_run_at INTEGER,
           run_count INTEGER NOT NULL DEFAULT 0,
           paused_reason TEXT NOT NULL DEFAULT '',
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS automation_runs (
           id TEXT PRIMARY KEY,
           automation_id TEXT NOT NULL,
           session_id TEXT,
           due_at INTEGER NOT NULL,
           started_at INTEGER NOT NULL,
           finished_at INTEGER,
           heartbeat_at INTEGER,
           status TEXT NOT NULL,
           error TEXT NOT NULL DEFAULT '',
           summary TEXT NOT NULL DEFAULT ''
         );
         CREATE INDEX IF NOT EXISTS automation_runs_idx
           ON automation_runs (automation_id, started_at DESC);
         CREATE TABLE IF NOT EXISTS automation_settings (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           all_paused INTEGER NOT NULL DEFAULT 0
         );",
    )?;
    ensure_run_column(conn, "heartbeat_at", "INTEGER")
}

/// The first build of this table had no lease column, and a recorded migration
/// version is not proof a column landed.
fn ensure_run_column(conn: &Connection, name: &str, decl: &str) -> rusqlite::Result<()> {
    let present: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('automation_runs') WHERE name = ?1",
        params![name],
        |row| row.get(0),
    )?;
    if present > 0 {
        return Ok(());
    }
    conn.execute(
        &format!("ALTER TABLE automation_runs ADD COLUMN {name} {decl}"),
        [],
    )?;
    Ok(())
}

#[tauri::command(async)]
pub fn automations_list(store: State<'_, SessionStore>) -> Result<Vec<Automation>, String> {
    let conn = store.lock_conn()?;
    list_automations(&conn).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn automations_upsert(
    store: State<'_, SessionStore>,
    automation: AutomationUpsert,
) -> Result<Automation, String> {
    validate_id(&automation.id, "automation")?;
    let conn = store.lock_conn()?;
    upsert_automation(&conn, &automation)
}

#[tauri::command(async)]
pub fn automations_delete(store: State<'_, SessionStore>, id: String) -> Result<(), String> {
    validate_id(&id, "automation")?;
    let conn = store.lock_conn()?;
    delete_automation(&conn, &id).map_err(|e| e.to_string())
}

/// Enablement, the booked instant, and why it is parked move together: a
/// paused automation with a stale next run would come back and fire instantly.
#[tauri::command(async)]
pub fn automations_set_state(
    store: State<'_, SessionStore>,
    id: String,
    enabled: bool,
    next_due_at: Option<i64>,
    paused_reason: String,
) -> Result<Option<Automation>, String> {
    validate_id(&id, "automation")?;
    let conn = store.lock_conn()?;
    conn.execute(
        "UPDATE automations
         SET enabled = ?1, next_due_at = ?2, paused_reason = ?3, updated_at = ?4
         WHERE id = ?5",
        params![
            enabled as i64,
            next_due_at,
            paused_reason.trim(),
            now_millis(),
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    read_automation(&conn, &id).map_err(|e| e.to_string())
}

/// The global emergency stop. Held apart from each automation's own flag so
/// releasing it restores exactly what was enabled before.
#[tauri::command(async)]
pub fn automations_set_all_paused(
    store: State<'_, SessionStore>,
    paused: bool,
) -> Result<bool, String> {
    let conn = store.lock_conn()?;
    conn.execute(
        "INSERT INTO automation_settings (id, all_paused) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET all_paused = excluded.all_paused",
        params![paused as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(paused)
}

#[tauri::command(async)]
pub fn automations_all_paused(store: State<'_, SessionStore>) -> Result<bool, String> {
    let conn = store.lock_conn()?;
    read_all_paused(&conn).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn automation_runs_list(
    store: State<'_, SessionStore>,
    automation_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<AutomationRun>, String> {
    let conn = store.lock_conn()?;
    let limit = limit.unwrap_or(RUN_HISTORY_MAX).clamp(1, RUN_LIST_MAX);
    list_runs(&conn, automation_id.as_deref(), limit).map_err(|e| e.to_string())
}

/// Claim a due occurrence.
///
/// `Ok(None)` means another window already holds this automation — either a
/// run is still going, or this exact occurrence has already been taken. The
/// check and the insert share one transaction, so two windows ticking on the
/// same second cannot both win.
#[tauri::command(async)]
pub fn automation_run_start(
    store: State<'_, SessionStore>,
    automation_id: String,
    run_id: String,
    due_at: i64,
    manual: bool,
) -> Result<Option<AutomationRun>, String> {
    validate_id(&automation_id, "automation")?;
    validate_id(&run_id, "automation run")?;
    let mut conn = store.lock_conn()?;
    claim_run(&mut conn, &automation_id, &run_id, due_at, manual).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn automation_run_attach_session(
    store: State<'_, SessionStore>,
    run_id: String,
    session_id: String,
) -> Result<(), String> {
    validate_id(&run_id, "automation run")?;
    validate_id(&session_id, "session")?;
    let conn = store.lock_conn()?;
    conn.execute(
        "UPDATE automation_runs SET session_id = ?1 WHERE id = ?2",
        params![session_id, run_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(async)]
pub fn automation_run_finish(
    store: State<'_, SessionStore>,
    run_id: String,
    status: String,
    error: Option<String>,
    summary: Option<String>,
) -> Result<Option<AutomationRun>, String> {
    validate_id(&run_id, "automation run")?;
    let status = normalize_status(&status)?;
    let conn = store.lock_conn()?;
    conn.execute(
        "UPDATE automation_runs
         SET status = ?1, finished_at = ?2, error = ?3, summary = ?4
         WHERE id = ?5",
        params![
            status,
            now_millis(),
            truncate(error.unwrap_or_default().trim(), 2_000),
            truncate(summary.unwrap_or_default().trim(), 4_000),
            run_id
        ],
    )
    .map_err(|e| e.to_string())?;
    read_run(&conn, &run_id).map_err(|e| e.to_string())
}

/// Renew the lease on the runs a window is driving.
///
/// A run that stops being renewed is a run whose driver is gone — its window
/// closed, or the call that was going to settle it never landed.
#[tauri::command(async)]
pub fn automation_runs_heartbeat(
    store: State<'_, SessionStore>,
    run_ids: Vec<String>,
) -> Result<(), String> {
    if run_ids.is_empty() {
        return Ok(());
    }
    let conn = store.lock_conn()?;
    let now = now_millis();
    for run_id in &run_ids {
        validate_id(run_id, "automation run")?;
        conn.execute(
            "UPDATE automation_runs SET heartbeat_at = ?1 WHERE id = ?2 AND status = 'running'",
            params![now, run_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Settle runs whose driver is gone.
///
/// Two ways that happens. A run still marked `running` from before this
/// process started has no agent behind it, because the harness children died
/// with the process that owned them. And a run whose window closed mid-turn —
/// or whose finishing call never landed — stops renewing its lease while this
/// process keeps going.
///
/// Both have to be settled, because `claim_run` refuses every later claim
/// while a run is marked going: a row nobody will ever finish would take the
/// automation off the schedule for good while the surface still called it
/// active. Runs being renewed are untouched, so a second window opening does
/// not end the first window's work, and neither does a turn that legitimately
/// takes hours.
#[tauri::command(async)]
pub fn automation_runs_reconcile(
    store: State<'_, SessionStore>,
    automations: State<'_, Automations>,
) -> Result<usize, String> {
    let conn = store.lock_conn()?;
    let now = now_millis();
    conn.execute(
        "UPDATE automation_runs
         SET status = 'interrupted', finished_at = COALESCE(finished_at, ?1)
         WHERE status = 'running'
           AND (started_at < ?2 OR COALESCE(heartbeat_at, started_at) < ?3)",
        params![now, automations.started_at, now - RUN_LEASE_MS],
    )
    .map_err(|e| e.to_string())
}

fn normalize_status(raw: &str) -> Result<String, String> {
    match raw {
        "running" | "success" | "failed" | "cancelled" | "needs-attention" | "interrupted" => {
            Ok(raw.to_string())
        }
        _ => Err(format!("Unknown run status: {raw}")),
    }
}

fn read_all_paused(conn: &Connection) -> rusqlite::Result<bool> {
    let value: Option<i64> = conn
        .query_row(
            "SELECT all_paused FROM automation_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value.unwrap_or(0) != 0)
}

const SELECT_AUTOMATION: &str = "SELECT id, name, prompt, project_ref, cwd, host_id, harness,
            model, runtime_mode, schedule_json, time_zone, dst_policy,
            overlap_policy, missed_policy, notify, enabled, end_at, max_runs,
            next_due_at, last_run_at, run_count, paused_reason, created_at, updated_at
     FROM automations";

fn list_automations(conn: &Connection) -> rusqlite::Result<Vec<Automation>> {
    let mut stmt = conn.prepare(&format!("{SELECT_AUTOMATION} ORDER BY created_at ASC"))?;
    let rows = stmt.query_map([], read_automation_row)?;
    rows.collect()
}

fn read_automation(conn: &Connection, id: &str) -> rusqlite::Result<Option<Automation>> {
    conn.query_row(
        &format!("{SELECT_AUTOMATION} WHERE id = ?1"),
        params![id],
        read_automation_row,
    )
    .optional()
}

fn read_automation_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Automation> {
    let schedule_json: String = row.get(9)?;
    Ok(Automation {
        id: row.get(0)?,
        name: row.get(1)?,
        prompt: row.get(2)?,
        project_ref: row.get(3)?,
        cwd: row.get(4)?,
        host_id: row.get(5)?,
        harness: row.get(6)?,
        model: row.get(7)?,
        runtime_mode: row.get(8)?,
        schedule: serde_json::from_str(&schedule_json).unwrap_or(Value::Null),
        time_zone: row.get(10)?,
        dst_policy: row.get(11)?,
        overlap_policy: row.get(12)?,
        missed_policy: row.get(13)?,
        notify: row.get::<_, i64>(14)? != 0,
        enabled: row.get::<_, i64>(15)? != 0,
        end_at_ms: row.get(16)?,
        max_runs: row.get(17)?,
        next_due_at: row.get(18)?,
        last_run_at: row.get(19)?,
        run_count: row.get(20)?,
        paused_reason: row.get(21)?,
        created_at: row.get(22)?,
        updated_at: row.get(23)?,
    })
}

fn upsert_automation(conn: &Connection, input: &AutomationUpsert) -> Result<Automation, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("An automation needs a name".into());
    }
    if name.chars().count() > NAME_MAX {
        return Err("That name is too long".into());
    }
    let prompt = input.prompt.replace("\r\n", "\n").replace('\r', "\n");
    if prompt.trim().is_empty() {
        return Err("An automation needs a prompt".into());
    }
    // Characters, not bytes: the form counts UTF-16 units against the same
    // limit, and a host that rejected what the form accepted would lose a
    // prompt the user had already been told was fine.
    if prompt.chars().count() > PROMPT_MAX {
        return Err("That prompt is too large to store".into());
    }
    if input.cwd.trim().is_empty() || input.project_ref.trim().is_empty() {
        return Err("An automation needs a project to run in".into());
    }
    let schedule_json = serde_json::to_string(&input.schedule).map_err(|e| e.to_string())?;
    let now = now_millis();

    let created_at: Option<i64> = conn
        .query_row(
            "SELECT created_at FROM automations WHERE id = ?1",
            params![input.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO automations (
           id, name, prompt, project_ref, cwd, host_id, harness, model,
           runtime_mode, schedule_json, time_zone, dst_policy, overlap_policy,
           missed_policy, notify, enabled, end_at, max_runs, next_due_at,
           paused_reason, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                   ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           prompt = excluded.prompt,
           project_ref = excluded.project_ref,
           cwd = excluded.cwd,
           host_id = excluded.host_id,
           harness = excluded.harness,
           model = excluded.model,
           runtime_mode = excluded.runtime_mode,
           schedule_json = excluded.schedule_json,
           time_zone = excluded.time_zone,
           dst_policy = excluded.dst_policy,
           overlap_policy = excluded.overlap_policy,
           missed_policy = excluded.missed_policy,
           notify = excluded.notify,
           enabled = excluded.enabled,
           end_at = excluded.end_at,
           max_runs = excluded.max_runs,
           next_due_at = excluded.next_due_at,
           paused_reason = excluded.paused_reason,
           updated_at = excluded.updated_at",
        params![
            input.id,
            name,
            prompt,
            input.project_ref.trim(),
            input.cwd.trim(),
            input.host_id.trim(),
            input.harness.trim(),
            input.model.trim(),
            input.runtime_mode.trim(),
            schedule_json,
            input.time_zone.trim(),
            input.dst_policy.trim(),
            input.overlap_policy.trim(),
            input.missed_policy.trim(),
            input.notify as i64,
            input.enabled as i64,
            input.end_at_ms,
            input.max_runs,
            input.next_due_at,
            input.paused_reason.trim(),
            created_at.unwrap_or(now),
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    read_automation(conn, &input.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Automation vanished while it was being saved".to_string())
}

/// Deleting an automation takes its history with it. The sessions its runs
/// created are not touched: they are ordinary sessions the user may still want.
fn delete_automation(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM automation_runs WHERE automation_id = ?1",
        params![id],
    )?;
    conn.execute("DELETE FROM automations WHERE id = ?1", params![id])?;
    Ok(())
}

const SELECT_RUN: &str = "SELECT id, automation_id, session_id, due_at, started_at,
            finished_at, status, error, summary
     FROM automation_runs";

fn list_runs(
    conn: &Connection,
    automation_id: Option<&str>,
    limit: i64,
) -> rusqlite::Result<Vec<AutomationRun>> {
    match automation_id {
        Some(id) => {
            let mut stmt = conn.prepare(&format!(
                "{SELECT_RUN} WHERE automation_id = ?1 ORDER BY started_at DESC, rowid DESC LIMIT ?2"
            ))?;
            let runs = stmt.query_map(params![id, limit], read_run_row)?.collect();
            runs
        }
        None => {
            let mut stmt = conn.prepare(&format!(
                "{SELECT_RUN} ORDER BY started_at DESC, rowid DESC LIMIT ?1"
            ))?;
            let runs = stmt.query_map(params![limit], read_run_row)?.collect();
            runs
        }
    }
}

fn read_run(conn: &Connection, id: &str) -> rusqlite::Result<Option<AutomationRun>> {
    conn.query_row(
        &format!("{SELECT_RUN} WHERE id = ?1"),
        params![id],
        read_run_row,
    )
    .optional()
}

fn read_run_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationRun> {
    let error: String = row.get(7)?;
    let summary: String = row.get(8)?;
    Ok(AutomationRun {
        id: row.get(0)?,
        automation_id: row.get(1)?,
        session_id: row.get(2)?,
        due_at: row.get(3)?,
        started_at: row.get(4)?,
        finished_at: row.get(5)?,
        status: row.get(6)?,
        error: (!error.is_empty()).then_some(error),
        summary: (!summary.is_empty()).then_some(summary),
    })
}

fn claim_run(
    conn: &mut Connection,
    automation_id: &str,
    run_id: &str,
    due_at: i64,
    manual: bool,
) -> rusqlite::Result<Option<AutomationRun>> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    let exists: i64 = tx.query_row(
        "SELECT COUNT(*) FROM automations WHERE id = ?1",
        params![automation_id],
        |row| row.get(0),
    )?;
    if exists == 0 {
        return Ok(None);
    }

    let running: i64 = tx.query_row(
        "SELECT COUNT(*) FROM automation_runs WHERE automation_id = ?1 AND status = 'running'",
        params![automation_id],
        |row| row.get(0),
    )?;
    if running > 0 {
        return Ok(None);
    }

    if !manual {
        // The occurrence, not the clock, is what may only happen once. A
        // window that ticks late must not re-run a slot another already took.
        let taken: i64 = tx.query_row(
            "SELECT COUNT(*) FROM automation_runs WHERE automation_id = ?1 AND due_at = ?2",
            params![automation_id, due_at],
            |row| row.get(0),
        )?;
        if taken > 0 {
            return Ok(None);
        }
    }

    let now = now_millis();
    tx.execute(
        "INSERT INTO automation_runs
           (id, automation_id, session_id, due_at, started_at, heartbeat_at, status)
         VALUES (?1, ?2, NULL, ?3, ?4, ?4, 'running')",
        params![run_id, automation_id, due_at, now],
    )?;
    // Only a scheduled run spends the budget `max_runs` caps. "Run now" is a
    // test the user asked for, and counting it would let trying an automation
    // once finish it.
    tx.execute(
        "UPDATE automations
         SET run_count = run_count + ?1, last_run_at = ?2, updated_at = ?2
         WHERE id = ?3",
        params![i64::from(!manual), now, automation_id],
    )?;
    // Prune here rather than on a timer: this is the only place rows appear.
    // `rowid` breaks the tie when two runs share a millisecond, so "newest"
    // means insertion order rather than whichever id sorts first.
    tx.execute(
        "DELETE FROM automation_runs
         WHERE automation_id = ?1
           AND id NOT IN (
             SELECT id FROM automation_runs WHERE automation_id = ?1
             ORDER BY started_at DESC, rowid DESC LIMIT ?2
           )",
        params![automation_id, RUN_HISTORY_MAX],
    )?;

    tx.commit()?;
    read_run(conn, run_id)
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    value.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        ensure_automations_tables(&conn).expect("schema");
        conn
    }

    fn upsert(id: &str, name: &str) -> AutomationUpsert {
        AutomationUpsert {
            id: id.into(),
            name: name.into(),
            prompt: "Triage new issues\r\nand report".into(),
            project_ref: "/repo".into(),
            cwd: "/repo".into(),
            host_id: "local".into(),
            harness: "claude".into(),
            model: String::new(),
            runtime_mode: "supervised".into(),
            schedule: serde_json::json!({ "kind": "interval", "every": 4, "unit": "hours" }),
            time_zone: "America/New_York".into(),
            dst_policy: "shift".into(),
            overlap_policy: "skip".into(),
            missed_policy: "once".into(),
            notify: true,
            enabled: false,
            end_at_ms: None,
            max_runs: None,
            next_due_at: Some(1_000),
            paused_reason: String::new(),
        }
    }

    #[test]
    fn stores_and_reads_back_a_definition() {
        let conn = conn();
        let saved = upsert_automation(&conn, &upsert("a1", "Nightly triage")).expect("insert");
        assert_eq!(saved.name, "Nightly triage");
        assert_eq!(saved.prompt, "Triage new issues\nand report");
        assert_eq!(saved.schedule["every"], 4);
        assert!(!saved.enabled);
        assert_eq!(list_automations(&conn).expect("list").len(), 1);
    }

    #[test]
    fn editing_keeps_the_created_timestamp_and_the_run_count() {
        let mut conn = conn();
        let first = upsert_automation(&conn, &upsert("a1", "Nightly")).expect("insert");
        claim_run(&mut conn, "a1", "r1", 10, false).expect("claim");

        let mut edit = upsert("a1", "Nightly triage");
        edit.enabled = true;
        let second = upsert_automation(&conn, &edit).expect("edit");

        assert_eq!(second.created_at, first.created_at);
        assert_eq!(second.run_count, 1);
        assert!(second.enabled);
    }

    #[test]
    fn refuses_a_definition_that_could_not_run() {
        let conn = conn();
        let mut blank_name = upsert("a1", "  ");
        blank_name.name = "   ".into();
        assert!(upsert_automation(&conn, &blank_name).is_err());

        let mut blank_prompt = upsert("a2", "Nightly");
        blank_prompt.prompt = "\n\n".into();
        assert!(upsert_automation(&conn, &blank_prompt).is_err());

        let mut no_project = upsert("a3", "Nightly");
        no_project.cwd = String::new();
        assert!(upsert_automation(&conn, &no_project).is_err());
    }

    #[test]
    fn only_one_claim_wins_an_occurrence() {
        let mut conn = conn();
        upsert_automation(&conn, &upsert("a1", "Nightly")).expect("insert");

        let first = claim_run(&mut conn, "a1", "r1", 5_000, false).expect("claim");
        assert!(first.is_some());
        // A second window ticking the same second finds the run already going.
        assert!(claim_run(&mut conn, "a1", "r2", 5_000, false)
            .expect("claim")
            .is_none());

        automation_finish(&mut conn, "r1", "success");
        // Even finished, the occurrence itself is spent.
        assert!(claim_run(&mut conn, "a1", "r3", 5_000, false)
            .expect("claim")
            .is_none());
        // A later occurrence is not.
        assert!(claim_run(&mut conn, "a1", "r4", 9_000, false)
            .expect("claim")
            .is_some());
    }

    #[test]
    fn a_manual_run_does_not_spend_the_run_budget() {
        let mut conn = conn();
        upsert_automation(&conn, &upsert("a1", "Nightly")).expect("insert");
        claim_run(&mut conn, "a1", "r1", 5_000, true).expect("claim");
        let after_manual = read_automation(&conn, "a1").expect("read").expect("row");
        assert_eq!(after_manual.run_count, 0);
        assert!(after_manual.last_run_at.is_some());

        automation_finish(&mut conn, "r1", "success");
        claim_run(&mut conn, "a1", "r2", 9_000, false).expect("claim");
        assert_eq!(
            read_automation(&conn, "a1")
                .expect("read")
                .expect("row")
                .run_count,
            1
        );
    }

    #[test]
    fn a_manual_run_may_repeat_an_occurrence_but_not_overlap_one() {
        let mut conn = conn();
        upsert_automation(&conn, &upsert("a1", "Nightly")).expect("insert");
        claim_run(&mut conn, "a1", "r1", 5_000, false).expect("claim");
        assert!(claim_run(&mut conn, "a1", "r2", 5_000, true)
            .expect("claim")
            .is_none());

        automation_finish(&mut conn, "r1", "failed");
        assert!(claim_run(&mut conn, "a1", "r3", 5_000, true)
            .expect("claim")
            .is_some());
    }

    #[test]
    fn refuses_to_claim_for_an_automation_that_is_gone() {
        let mut conn = conn();
        assert!(claim_run(&mut conn, "ghost", "r1", 1, false)
            .expect("claim")
            .is_none());
    }

    #[test]
    fn keeps_the_history_bounded() {
        let mut conn = conn();
        upsert_automation(&conn, &upsert("a1", "Nightly")).expect("insert");
        for i in 0..(RUN_HISTORY_MAX + 10) {
            let id = format!("r{i}");
            claim_run(&mut conn, "a1", &id, i, false).expect("claim");
            automation_finish(&mut conn, &id, "success");
        }
        let runs = list_runs(&conn, Some("a1"), RUN_LIST_MAX).expect("list");
        assert_eq!(runs.len() as i64, RUN_HISTORY_MAX);
        // The newest survive.
        assert_eq!(runs[0].id, format!("r{}", RUN_HISTORY_MAX + 9));
    }

    #[test]
    fn deleting_takes_the_history_with_it() {
        let mut conn = conn();
        upsert_automation(&conn, &upsert("a1", "Nightly")).expect("insert");
        upsert_automation(&conn, &upsert("a2", "Weekly")).expect("insert");
        claim_run(&mut conn, "a1", "r1", 1, false).expect("claim");
        claim_run(&mut conn, "a2", "r2", 1, false).expect("claim");

        delete_automation(&conn, "a1").expect("delete");
        assert_eq!(list_automations(&conn).expect("list").len(), 1);
        let runs = list_runs(&conn, None, RUN_LIST_MAX).expect("list");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].automation_id, "a2");
    }

    #[test]
    fn a_run_whose_window_went_away_stops_blocking_the_automation() {
        let mut conn = conn();
        upsert_automation(&conn, &upsert("a1", "Nightly")).expect("insert");
        claim_run(&mut conn, "a1", "r1", 5_000, false).expect("claim");
        // Nothing will ever finish this row: the window driving it is gone.
        assert!(claim_run(&mut conn, "a1", "r2", 9_000, false)
            .expect("claim")
            .is_none());

        let expired = now_millis() - RUN_LEASE_MS - 1;
        conn.execute(
            "UPDATE automation_runs SET heartbeat_at = ?1 WHERE id = 'r1'",
            params![expired],
        )
        .expect("expire");
        assert_eq!(reconcile(&conn, now_millis()), 1);
        assert_eq!(
            read_run(&conn, "r1").expect("read").expect("row").status,
            "interrupted"
        );
        assert!(claim_run(&mut conn, "a1", "r3", 9_000, false)
            .expect("claim")
            .is_some());
    }

    #[test]
    fn a_renewed_run_is_left_alone_however_long_it_takes() {
        let mut conn = conn();
        upsert_automation(&conn, &upsert("a1", "Nightly")).expect("insert");
        claim_run(&mut conn, "a1", "r1", 5_000, false).expect("claim");
        // Started hours ago, but its window is still saying so every tick.
        conn.execute(
            "UPDATE automation_runs SET started_at = ?1, heartbeat_at = ?2 WHERE id = 'r1'",
            params![now_millis() - 6 * 60 * 60 * 1000, now_millis()],
        )
        .expect("age");
        // Started long before now, but after this process did.
        let process_start = now_millis() - 24 * 60 * 60 * 1000;
        assert_eq!(reconcile(&conn, process_start), 0);
        assert_eq!(
            read_run(&conn, "r1").expect("read").expect("row").status,
            "running"
        );
    }

    #[test]
    fn the_global_pause_survives_a_read() {
        let conn = conn();
        assert!(!read_all_paused(&conn).expect("read"));
        conn.execute(
            "INSERT INTO automation_settings (id, all_paused) VALUES (1, 1)
             ON CONFLICT(id) DO UPDATE SET all_paused = excluded.all_paused",
            [],
        )
        .expect("write");
        assert!(read_all_paused(&conn).expect("read"));
    }

    #[test]
    fn rejects_a_status_that_is_not_one() {
        assert!(normalize_status("success").is_ok());
        assert!(normalize_status("exploded").is_err());
    }

    /// The reconcile query, with the process-start clock the command reads
    /// from managed state.
    fn reconcile(conn: &Connection, process_start: i64) -> usize {
        let now = now_millis();
        conn.execute(
            "UPDATE automation_runs
             SET status = 'interrupted', finished_at = COALESCE(finished_at, ?1)
             WHERE status = 'running'
               AND (started_at < ?2 OR COALESCE(heartbeat_at, started_at) < ?3)",
            params![now, process_start, now - RUN_LEASE_MS],
        )
        .expect("reconcile")
    }

    fn automation_finish(conn: &mut Connection, run_id: &str, status: &str) {
        conn.execute(
            "UPDATE automation_runs SET status = ?1, finished_at = ?2 WHERE id = ?3",
            params![status, now_millis(), run_id],
        )
        .expect("finish");
    }
}
