//! The command surface a connected client is allowed to reach.
//!
//! `tauri::generate_handler!` builds a closure, not a table, so a remote call
//! cannot be handed to it by name. Writing the allowlist out is the point
//! rather than the cost: a host is a service that runs commands and writes to
//! a real checkout, and what it will not do has to be legible in one file.
//!
//! Absent by design: anything that draws or moves a window, the Dock badge and
//! the menu bar, profile switching, window transfer, and the two commands that
//! answer with raw bytes instead of JSON. A window belongs to the machine
//! drawing it, and a remote client has none of them to act on.

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::checkpoint::CheckpointStore;
use crate::harness::HarnessHost;
use crate::host_events::HostEventJournal;
use crate::pty::PtyHost;
use crate::session_store::SessionStore;
use crate::{checkpoint, cursor_store, fs, harness, host_events, notes, project_logo};
use crate::{prompt_templates, pty, rate_limits, search, session_store, skills, usage, worktree};

/// Deserializes one command's arguments into a struct named for the call site.
/// `rename_all` matches what the WebView sends, so the wire shape of a remote
/// call is the same shape a local `invoke` uses.
macro_rules! args {
    ($args:expr, { $( $(#[$meta:meta])* $field:ident : $ty:ty ),* $(,)? }) => {{
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Args { $( $(#[$meta])* $field: $ty ),* }
        serde_json::from_value::<Args>($args)
            .map_err(|error| format!("Invalid arguments: {error}"))?
    }};
}

fn ok<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

fn done<T: Serialize>(value: Result<T, String>) -> Result<Value, String> {
    ok(value?)
}

/// Runs a `#[tauri::command] async fn` from the connection's worker thread.
fn wait<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

pub fn dispatch(app: &AppHandle, command: &str, args: Value) -> Result<Value, String> {
    if !dispatch_name(command) {
        return Err(format!("{command} is not available over a connection"));
    }
    call(app, command, args)
}

macro_rules! commands {
    ($($name:literal),* $(,)?) => {
        fn dispatch_name(command: &str) -> bool {
            matches!(command, $($name)|*)
        }
    };
}

commands![
    "default_cwd",
    "home_dir",
    "list_dir",
    "list_project_files",
    "git_diff_stats",
    "git_diff_index",
    "git_file_diff",
    "git_history",
    "git_commit_files",
    "git_commit_file_diff",
    "git_stage_file",
    "git_stage_contents",
    "git_unstage_file",
    "git_discard_file",
    "git_discard_all",
    "git_stage_all",
    "git_unstage_all",
    "git_commit",
    "git_staged_context",
    "git_push",
    "git_pull",
    "git_sync",
    "git_range_context",
    "git_pr_status",
    "git_pr_create",
    "git_github_repo",
    "git_github_work_items",
    "git_github_work_item_details",
    "git_github_work_item_thread",
    "git_github_work_item_comment",
    "git_github_pr_diff",
    "git_branches",
    "git_checkout",
    "git_create_branch",
    "git_stash",
    "git_worktree_list",
    "git_worktree_create",
    "git_worktree_remove",
    "git_worktree_prune",
    "create_path",
    "rename_path",
    "delete_path",
    "copy_path",
    "move_path",
    "clone_repo",
    "read_file_preview",
    "stat_files",
    "inspect_paths",
    "read_file_base64",
    "write_attachment",
    "write_file_base64",
    "write_generated_image",
    "read_text_file",
    "write_text_file",
    "list_skills",
    "list_skill_details",
    "set_skill_enabled",
    "delete_skills",
    "install_skills",
    "search_project",
    "cursor_tool_calls",
    "usage_summary",
    "usage_model_rates",
    "harness_resolve_cursor",
    "harness_resolve_codex",
    "harness_resolve_opencode",
    "harness_resolve_claude",
    "harness_resolve_omp",
    "harness_resolve_pi",
    "harness_resolve_fx",
    "harness_resolve_grok",
    "harness_free_port",
    "harness_spawn",
    "harness_write",
    "harness_kill",
    "harness_kill_all",
    "harness_http",
    "harness_sse_open",
    "harness_sse_close",
    "harness_exec",
    "host_events_since",
    "fetch_claude_usage",
    "codex_usage_cache_read",
    "codex_usage_cache_write",
    "pty_spawn",
    "pty_write",
    "pty_resize",
    "pty_status",
    "pty_kill",
    "pty_kill_all",
    "session_upsert",
    "session_list_by_project",
    "session_list_by_scope",
    "work_chat_dir",
    "session_search",
    "session_get",
    "session_delete",
    "session_set_archived",
    "session_set_pinned",
    "session_set_in_flight",
    "session_list_in_flight",
    "session_take_in_flight",
    "workspace_set_snapshot",
    "workspace_get_snapshot",
    "notes_list",
    "notes_get",
    "notes_upsert",
    "notes_delete",
    "prompt_templates_list",
    "prompt_templates_upsert",
    "prompt_templates_delete",
    "prompt_templates_delete_project",
    "session_checkpoint_ensure",
    "session_checkpoint_capture",
    "session_checkpoint_sync",
    "session_checkpoint_status",
    "session_checkpoint_undo",
    "session_checkpoint_keep",
    "save_project_logo",
    "remove_project_logo",
];

#[allow(clippy::too_many_lines)]
fn call(app: &AppHandle, command: &str, args: Value) -> Result<Value, String> {
    match command {
        "default_cwd" => ok(crate::default_cwd()),
        "home_dir" => ok(crate::home_dir()),

        "list_dir" => {
            let a = args!(args, { path: String });
            done(fs::list_dir(a.path))
        }
        "list_project_files" => {
            let a = args!(args, { cwd: String });
            done(wait(fs::list_project_files(a.cwd)))
        }
        "git_diff_stats" => {
            let a = args!(args, { cwd: String });
            done(wait(fs::git_diff_stats(a.cwd)))
        }
        "git_diff_index" => {
            let a = args!(args, { cwd: String });
            done(wait(fs::git_diff_index(a.cwd)))
        }
        "git_file_diff" => {
            let a = args!(args, { cwd: String, relative: String });
            done(wait(fs::git_file_diff(a.cwd, a.relative)))
        }
        "git_history" => {
            let a = args!(args, { cwd: String, #[serde(default)] limit: Option<u32> });
            done(wait(fs::git_history(a.cwd, a.limit)))
        }
        "git_commit_files" => {
            let a = args!(args, { cwd: String, sha: String });
            done(wait(fs::git_commit_files(a.cwd, a.sha)))
        }
        "git_commit_file_diff" => {
            let a = args!(args, { cwd: String, sha: String, relative: String });
            done(wait(fs::git_commit_file_diff(a.cwd, a.sha, a.relative)))
        }
        "git_stage_file" => {
            let a = args!(args, { cwd: String, relative: String });
            done(wait(fs::git_stage_file(a.cwd, a.relative)))
        }
        "git_stage_contents" => {
            let a = args!(args, { cwd: String, relative: String, contents: String });
            done(wait(fs::git_stage_contents(a.cwd, a.relative, a.contents)))
        }
        "git_unstage_file" => {
            let a = args!(args, { cwd: String, relative: String });
            done(wait(fs::git_unstage_file(a.cwd, a.relative)))
        }
        "git_discard_file" => {
            let a = args!(args, { cwd: String, relative: String });
            done(wait(fs::git_discard_file(a.cwd, a.relative)))
        }
        "git_discard_all" => {
            let a = args!(args, { cwd: String });
            done(wait(fs::git_discard_all(a.cwd)))
        }
        "git_stage_all" => {
            let a = args!(args, { cwd: String });
            done(wait(fs::git_stage_all(a.cwd)))
        }
        "git_unstage_all" => {
            let a = args!(args, { cwd: String });
            done(wait(fs::git_unstage_all(a.cwd)))
        }
        "git_commit" => {
            let a = args!(args, { cwd: String, message: String });
            done(wait(fs::git_commit(a.cwd, a.message)))
        }
        "git_staged_context" => {
            let a = args!(args, { cwd: String });
            done(wait(fs::git_staged_context(a.cwd)))
        }
        "git_push" => {
            let a = args!(args, { cwd: String });
            done(wait(fs::git_push(a.cwd)))
        }
        "git_pull" => {
            let a = args!(args, { cwd: String });
            done(wait(fs::git_pull(a.cwd)))
        }
        "git_sync" => {
            let a = args!(args, { cwd: String });
            done(wait(fs::git_sync(a.cwd)))
        }
        "git_range_context" => {
            let a = args!(args, { cwd: String });
            done(wait(fs::git_range_context(a.cwd)))
        }
        "git_pr_status" => {
            let a = args!(args, { cwd: String });
            done(wait(fs::git_pr_status(a.cwd)))
        }
        "git_pr_create" => {
            let a = args!(args, {
                cwd: String,
                title: String,
                body: String,
                base: String,
                head: String,
            });
            done(wait(fs::git_pr_create(
                a.cwd, a.title, a.body, a.base, a.head,
            )))
        }
        "git_github_repo" => {
            let a = args!(args, { cwd: String });
            done(wait(fs::git_github_repo(a.cwd)))
        }
        "git_github_work_items" => {
            let a = args!(args, {
                cwd: String,
                kind: String,
                assigned_to_me: bool,
                state: String,
                search: String,
                #[serde(default)] limit: Option<u32>,
            });
            done(wait(fs::git_github_work_items(
                a.cwd,
                a.kind,
                a.assigned_to_me,
                a.state,
                a.search,
                a.limit,
            )))
        }
        "git_github_work_item_details" => {
            let a = args!(args, { cwd: String, kind: String, number: i64 });
            done(wait(fs::git_github_work_item_details(
                a.cwd, a.kind, a.number,
            )))
        }
        "git_github_work_item_thread" => {
            let a = args!(args, { cwd: String, kind: String, number: i64 });
            done(wait(fs::git_github_work_item_thread(
                a.cwd, a.kind, a.number,
            )))
        }
        "git_github_work_item_comment" => {
            let a = args!(args, {
                cwd: String,
                kind: String,
                number: i64,
                body: String,
                in_reply_to: String,
            });
            done(wait(fs::git_github_work_item_comment(
                a.cwd,
                a.kind,
                a.number,
                a.body,
                a.in_reply_to,
            )))
        }
        "git_github_pr_diff" => {
            let a = args!(args, { cwd: String, number: i64 });
            done(wait(fs::git_github_pr_diff(a.cwd, a.number)))
        }
        "git_branches" => {
            let a = args!(args, { cwd: String });
            done(wait(fs::git_branches(a.cwd)))
        }
        "git_checkout" => {
            let a = args!(args, {
                cwd: String,
                name: String,
                #[serde(default)] remote: Option<String>,
            });
            done(wait(fs::git_checkout(a.cwd, a.name, a.remote)))
        }
        "git_create_branch" => {
            let a = args!(args, { cwd: String, name: String });
            done(wait(fs::git_create_branch(a.cwd, a.name)))
        }
        "git_stash" => {
            let a = args!(args, { cwd: String, #[serde(default)] message: Option<String> });
            done(wait(fs::git_stash(a.cwd, a.message)))
        }

        "git_worktree_list" => {
            let a = args!(args, { cwd: String });
            done(wait(worktree::git_worktree_list(a.cwd)))
        }
        "git_worktree_create" => {
            let a = args!(args, {
                cwd: String,
                path: String,
                branch: String,
                #[serde(default)] base: Option<String>,
            });
            done(wait(worktree::git_worktree_create(
                a.cwd, a.path, a.branch, a.base,
            )))
        }
        "git_worktree_remove" => {
            let a = args!(args, {
                cwd: String,
                path: String,
                force: bool,
                delete_branch: bool,
            });
            done(wait(worktree::git_worktree_remove(
                a.cwd,
                a.path,
                a.force,
                a.delete_branch,
            )))
        }
        "git_worktree_prune" => {
            let a = args!(args, { cwd: String });
            done(wait(worktree::git_worktree_prune(a.cwd)))
        }

        "create_path" => {
            let a = args!(args, { parent: String, name: String, is_dir: bool });
            done(fs::create_path(a.parent, a.name, a.is_dir))
        }
        "rename_path" => {
            let a = args!(args, { path: String, name: String });
            done(wait(fs::rename_path(a.path, a.name)))
        }
        "delete_path" => {
            let a = args!(args, { path: String });
            done(wait(fs::delete_path(a.path)))
        }
        "copy_path" => {
            let a = args!(args, { from: String, dest_parent: String });
            done(wait(fs::copy_path(a.from, a.dest_parent)))
        }
        "move_path" => {
            let a = args!(args, { from: String, dest_parent: String });
            done(wait(fs::move_path(a.from, a.dest_parent)))
        }
        "clone_repo" => {
            let a = args!(args, { url: String, parent: String });
            done(wait(fs::clone_repo(a.url, a.parent)))
        }
        "read_file_preview" => {
            let a = args!(args, {
                path: String,
                max_lines: usize,
                #[serde(default)] start_line: Option<usize>,
            });
            done(fs::read_file_preview(a.path, a.max_lines, a.start_line))
        }
        "stat_files" => {
            let a = args!(args, { paths: Vec<String> });
            done(fs::stat_files(a.paths))
        }
        "inspect_paths" => {
            let a = args!(args, { paths: Vec<String> });
            ok(fs::inspect_paths(a.paths))
        }
        "read_file_base64" => {
            let a = args!(args, { path: String });
            done(wait(fs::read_file_base64(a.path)))
        }
        "write_attachment" => {
            let a = args!(args, { name: String, data: String });
            done(wait(fs::write_attachment(a.name, a.data)))
        }
        "write_file_base64" => {
            let a = args!(args, { path: String, data: String });
            done(wait(fs::write_file_base64(a.path, a.data)))
        }
        "write_generated_image" => {
            let a = args!(args, { name: String, data: String });
            done(wait(fs::write_generated_image(app.clone(), a.name, a.data)))
        }
        "read_text_file" => {
            let a = args!(args, { path: String });
            done(wait(fs::read_text_file(a.path)))
        }
        "write_text_file" => {
            let a = args!(args, { path: String, content: String });
            done(wait(fs::write_text_file(a.path, a.content)))
        }

        "list_skills" => {
            let a = args!(args, { cwd: String });
            done(skills::list_skills(a.cwd))
        }
        "list_skill_details" => {
            let a = args!(args, { cwd: String });
            done(skills::list_skill_details(a.cwd))
        }
        "set_skill_enabled" => {
            let a = args!(args, { cwd: String, dirs: Vec<String>, enabled: bool });
            done(skills::set_skill_enabled(a.cwd, a.dirs, a.enabled))
        }
        "delete_skills" => {
            let a = args!(args, { cwd: String, dirs: Vec<String> });
            done(skills::delete_skills(a.cwd, a.dirs))
        }
        "install_skills" => {
            let a = args!(args, {
                cwd: String,
                package: String,
                agents: Vec<String>,
                skills: Vec<String>,
                global: bool,
            });
            done(skills::install_skills(
                a.cwd, a.package, a.agents, a.skills, a.global,
            ))
        }
        "search_project" => {
            let a = args!(args, { options: search::SearchOptions });
            done(wait(search::search_project(a.options)))
        }
        "cursor_tool_calls" => {
            let a = args!(args, { session_id: String, tool_call_ids: Vec<String> });
            done(wait(cursor_store::cursor_tool_calls(
                a.session_id,
                a.tool_call_ids,
            )))
        }
        "usage_summary" => {
            let a = args!(args, { query: usage::UsageQuery });
            done(wait(usage::usage_summary(a.query)))
        }
        "usage_model_rates" => done(wait(usage::usage_model_rates(app.clone()))),

        "harness_resolve_cursor" => done(harness::harness_resolve_cursor()),
        "harness_resolve_codex" => done(harness::harness_resolve_codex()),
        "harness_resolve_opencode" => done(harness::harness_resolve_opencode()),
        "harness_resolve_claude" => done(harness::harness_resolve_claude()),
        "harness_resolve_omp" => done(harness::harness_resolve_omp()),
        "harness_resolve_pi" => done(harness::harness_resolve_pi()),
        "harness_resolve_fx" => done(harness::harness_resolve_fx()),
        "harness_resolve_grok" => done(harness::harness_resolve_grok()),
        "harness_free_port" => done(harness::harness_free_port()),
        "harness_spawn" => {
            let a = args!(args, {
                session_id: String,
                command: String,
                args: Vec<String>,
                cwd: String,
            });
            done(harness::harness_spawn(
                app.clone(),
                app.state::<HarnessHost>(),
                a.session_id,
                a.command,
                a.args,
                a.cwd,
            ))
        }
        "harness_write" => {
            let a = args!(args, { session_id: String, line: String });
            done(harness::harness_write(
                app.state::<HarnessHost>(),
                a.session_id,
                a.line,
            ))
        }
        "harness_kill" => {
            let a = args!(args, { session_id: String });
            done(harness::harness_kill(
                app.state::<HarnessHost>(),
                a.session_id,
            ))
        }
        "harness_kill_all" => done(harness::harness_kill_all(app.state::<HarnessHost>())),
        "harness_http" => {
            let a = args!(args, {
                url: String,
                method: String,
                #[serde(default)] headers: Option<std::collections::HashMap<String, String>>,
                #[serde(default)] body: Option<String>,
                #[serde(default)] timeout_ms: Option<u64>,
            });
            done(wait(harness::harness_http(
                a.url,
                a.method,
                a.headers,
                a.body,
                a.timeout_ms,
            )))
        }
        "harness_sse_open" => {
            let a = args!(args, {
                session_id: String,
                url: String,
                #[serde(default)] headers: Option<std::collections::HashMap<String, String>>,
            });
            done(harness::harness_sse_open(
                app.clone(),
                app.state::<HarnessHost>(),
                a.session_id,
                a.url,
                a.headers,
            ))
        }
        "harness_sse_close" => {
            let a = args!(args, { session_id: String });
            done(harness::harness_sse_close(
                app.state::<HarnessHost>(),
                a.session_id,
            ))
        }
        "harness_exec" => {
            let a = args!(args, {
                command: String,
                args: Vec<String>,
                #[serde(default)] cwd: Option<String>,
            });
            done(wait(harness::harness_exec(a.command, a.args, a.cwd)))
        }

        "host_events_since" => {
            let a = args!(args, { after_sequence: u64 });
            ok(host_events::host_events_since(
                app.state::<HostEventJournal>(),
                a.after_sequence,
            ))
        }
        "fetch_claude_usage" => {
            let a = args!(args, { #[serde(default)] force: Option<bool> });
            done(wait(rate_limits::fetch_claude_usage(a.force)))
        }
        "codex_usage_cache_read" => ok(rate_limits::codex_usage_cache_read()),
        "codex_usage_cache_write" => {
            let a = args!(args, { raw: String });
            rate_limits::codex_usage_cache_write(a.raw);
            ok(Value::Null)
        }

        "pty_spawn" => {
            let a = args!(args, { id: String, cwd: String, cols: u16, rows: u16 });
            done(pty::pty_spawn(
                app.clone(),
                app.state::<PtyHost>(),
                a.id,
                a.cwd,
                a.cols,
                a.rows,
            ))
        }
        "pty_write" => {
            let a = args!(args, { id: String, data: String });
            done(pty::pty_write(app.state::<PtyHost>(), a.id, a.data))
        }
        "pty_resize" => {
            let a = args!(args, { id: String, cols: u16, rows: u16 });
            done(pty::pty_resize(
                app.state::<PtyHost>(),
                a.id,
                a.cols,
                a.rows,
            ))
        }
        "pty_status" => {
            let a = args!(args, { id: String });
            done(pty::pty_status(app.state::<PtyHost>(), a.id))
        }
        "pty_kill" => {
            let a = args!(args, { id: String });
            done(pty::pty_kill(app.state::<PtyHost>(), a.id))
        }
        "pty_kill_all" => done(pty::pty_kill_all(app.state::<PtyHost>())),

        "session_upsert" => {
            let a = args!(args, { session: session_store::SessionUpsert });
            done(session_store::session_upsert(
                app.state::<SessionStore>(),
                a.session,
            ))
        }
        "session_list_by_project" => {
            let a = args!(args, { cwd: String });
            done(session_store::session_list_by_project(
                app.state::<SessionStore>(),
                a.cwd,
            ))
        }
        "session_list_by_scope" => {
            let a = args!(args, { scope: String });
            done(session_store::session_list_by_scope(
                app.state::<SessionStore>(),
                a.scope,
            ))
        }
        "work_chat_dir" => done(session_store::work_chat_dir(app.clone())),
        "session_search" => {
            let a = args!(args, { options: session_store::SessionSearchOptions });
            done(session_store::session_search(
                app.state::<SessionStore>(),
                a.options,
            ))
        }
        "session_get" => {
            let a = args!(args, { session_id: String });
            done(session_store::session_get(
                app.state::<SessionStore>(),
                a.session_id,
            ))
        }
        "session_delete" => {
            let a = args!(args, { session_id: String });
            done(session_store::session_delete(
                app.state::<SessionStore>(),
                a.session_id,
            ))
        }
        "session_set_archived" => {
            let a = args!(args, { session_id: String, archived: bool });
            done(session_store::session_set_archived(
                app.state::<SessionStore>(),
                a.session_id,
                a.archived,
            ))
        }
        "session_set_pinned" => {
            let a = args!(args, { session_id: String, pinned: bool });
            done(session_store::session_set_pinned(
                app.state::<SessionStore>(),
                a.session_id,
                a.pinned,
            ))
        }
        "session_set_in_flight" => {
            let a = args!(args, { sessions: Vec<session_store::InFlightSession> });
            done(session_store::session_set_in_flight(
                app.state::<SessionStore>(),
                a.sessions,
            ))
        }
        "session_list_in_flight" => done(session_store::session_list_in_flight(
            app.state::<SessionStore>(),
        )),
        "session_take_in_flight" => done(session_store::session_take_in_flight(
            app.state::<SessionStore>(),
        )),
        "workspace_set_snapshot" => {
            let a = args!(args, { snapshot: Value });
            done(session_store::workspace_set_snapshot(
                app.state::<SessionStore>(),
                a.snapshot,
            ))
        }
        "workspace_get_snapshot" => done(session_store::workspace_get_snapshot(
            app.state::<SessionStore>(),
        )),

        "notes_list" => done(notes::notes_list(app.state::<SessionStore>())),
        "notes_get" => {
            let a = args!(args, { id: String });
            done(notes::notes_get(app.state::<SessionStore>(), a.id))
        }
        "notes_upsert" => {
            let a = args!(args, { note: notes::NoteUpsert });
            done(notes::notes_upsert(app.state::<SessionStore>(), a.note))
        }
        "notes_delete" => {
            let a = args!(args, { id: String });
            done(notes::notes_delete(app.state::<SessionStore>(), a.id))
        }

        "prompt_templates_list" => {
            let a = args!(args, { project_key: String });
            done(prompt_templates::prompt_templates_list(
                app.state::<SessionStore>(),
                a.project_key,
            ))
        }
        "prompt_templates_upsert" => {
            let a = args!(args, { template: prompt_templates::PromptTemplateUpsert });
            done(prompt_templates::prompt_templates_upsert(
                app.state::<SessionStore>(),
                a.template,
            ))
        }
        "prompt_templates_delete" => {
            let a = args!(args, { id: String });
            done(prompt_templates::prompt_templates_delete(
                app.state::<SessionStore>(),
                a.id,
            ))
        }
        "prompt_templates_delete_project" => {
            let a = args!(args, { project_key: String });
            done(prompt_templates::prompt_templates_delete_project(
                app.state::<SessionStore>(),
                a.project_key,
            ))
        }

        "session_checkpoint_ensure" => {
            let a = args!(args, { session_id: String, cwd: String });
            done(wait(checkpoint::session_checkpoint_ensure(
                app.state::<CheckpointStore>(),
                a.session_id,
                a.cwd,
            )))
        }
        "session_checkpoint_capture" => {
            let a = args!(args, { session_id: String, cwd: String, paths: Vec<String> });
            done(wait(checkpoint::session_checkpoint_capture(
                app.state::<CheckpointStore>(),
                a.session_id,
                a.cwd,
                a.paths,
            )))
        }
        "session_checkpoint_sync" => {
            let a = args!(args, { session_id: String, cwd: String });
            done(wait(checkpoint::session_checkpoint_sync(
                app.state::<CheckpointStore>(),
                a.session_id,
                a.cwd,
            )))
        }
        "session_checkpoint_status" => {
            let a = args!(args, { session_id: String, cwd: String });
            done(wait(checkpoint::session_checkpoint_status(
                app.state::<CheckpointStore>(),
                a.session_id,
                a.cwd,
            )))
        }
        "session_checkpoint_undo" => {
            let a = args!(args, {
                session_id: String,
                cwd: String,
                #[serde(default)] relative: Option<String>,
            });
            done(wait(checkpoint::session_checkpoint_undo(
                app.state::<CheckpointStore>(),
                a.session_id,
                a.cwd,
                a.relative,
            )))
        }
        "session_checkpoint_keep" => {
            let a = args!(args, {
                session_id: String,
                cwd: String,
                #[serde(default)] relative: Option<String>,
            });
            done(wait(checkpoint::session_checkpoint_keep(
                app.state::<CheckpointStore>(),
                a.session_id,
                a.cwd,
                a.relative,
            )))
        }

        "save_project_logo" => {
            let a = args!(args, { project: String, source_path: String });
            done(wait(project_logo::save_project_logo(
                app.clone(),
                a.project,
                a.source_path,
            )))
        }
        "remove_project_logo" => {
            let a = args!(args, { project: String });
            done(wait(project_logo::remove_project_logo(
                app.clone(),
                a.project,
            )))
        }

        _ => Err(format!("{command} is not available over a connection")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_the_commands_that_own_the_checkout() {
        assert!(dispatch_name("git_diff_stats"));
        assert!(dispatch_name("harness_spawn"));
        assert!(dispatch_name("pty_write"));
        assert!(dispatch_name("session_upsert"));
    }

    #[test]
    fn refuses_window_and_profile_commands_a_client_cannot_own() {
        for command in [
            "set_dock_badge",
            "open_new_window",
            "hide_window",
            "destroy_window",
            "confirm_quit",
            "profile_switch",
            "profile_delete_data",
            "stage_window_transfer",
            "menu_bar_open_app",
            "connect_host_start",
        ] {
            assert!(!dispatch_name(command), "{command} must not be reachable");
        }
    }

    #[test]
    fn refuses_the_commands_that_answer_in_raw_bytes() {
        assert!(!dispatch_name("read_binary_file"));
        assert!(!dispatch_name("fetch_inbox_media"));
        assert!(!dispatch_name("reveal_path"));
    }

    /// An application opens on the machine that launches it, and a host
    /// reached over a connection has nobody sitting in front of it.
    #[test]
    fn refuses_launching_another_application_on_the_host() {
        assert!(!dispatch_name("list_open_with_apps"));
        assert!(!dispatch_name("open_path_with"));
    }
}
