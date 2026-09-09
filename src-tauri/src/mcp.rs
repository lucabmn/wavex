//! Model Context Protocol servers, as the installed agent CLIs already define
//! them.
//!
//! wavex owns no MCP registry and installs no server. Each agent CLI keeps its
//! own configuration — Claude in `~/.claude.json`, Codex in
//! `~/.codex/config.toml`, Cursor in `mcp.json` — and this module reads those
//! files and nothing else. Same posture `skills.rs` takes with a CLI's skill
//! folders: discovered, reported, never rewritten.
//!
//! Parsing lives in Rust because Codex's configuration is TOML and the WebView
//! has no parser for it, and because a config file is the CLI's data rather
//! than the frontend's.
//!
//! Secrets never cross the boundary. A server definition routinely carries an
//! API key in `env` or an `Authorization` header, so only the *names* of those
//! entries are returned. The values stay here, which is why `probe_mcp_server`
//! takes a server's name and re-reads its definition rather than accepting one
//! back from the WebView.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::dirs_home;
use crate::fs::expand_home;

/// A user with more MCP servers than this has a configuration problem wavex
/// should not try to render.
const MAX_SERVERS: usize = 200;
/// `~/.claude.json` grows with conversation history, so the read is capped
/// rather than trusting the file to stay a config file.
const MAX_CONFIG_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredMcpServer {
    /// The key the CLI filed it under. Not unique across sources: the same
    /// server is commonly configured for several CLIs.
    pub name: String,
    /// The agent CLI whose configuration this came from.
    pub source: String,
    /// `user` or `project`.
    pub scope: String,
    /// `stdio`, `http`, or `sse`.
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    /// Names only — the values are the user's secrets. See the module note.
    pub env_keys: Vec<String>,
    /// Header names only, for the same reason.
    pub header_keys: Vec<String>,
    pub cwd: Option<String>,
    /// False when the CLI's own configuration switched it off. wavex reports
    /// that rather than overriding it: the CLI owns the definition.
    pub enabled_in_cli: bool,
    pub config_path: String,
}

/// A discovered server plus what only Rust may hold: the values behind
/// `env_keys` and `header_keys`.
pub(crate) struct McpDefinition {
    pub server: DiscoveredMcpServer,
    env: Vec<(String, String)>,
    headers: Vec<(String, String)>,
    /// The checkout the discovery was asked from, so a relative `cwd` resolves.
    project: PathBuf,
}

/// Every MCP server the installed agent CLIs define, for this checkout.
///
/// Both scopes are returned rather than merged, because "Claude has this at
/// user scope and Cursor only inside this project" is exactly what explains why
/// one agent has a tool and another does not.
#[tauri::command(async)]
pub fn list_mcp_servers(cwd: String) -> Result<Vec<DiscoveredMcpServer>, String> {
    let project = expand_home(&cwd);
    let home = dirs_home().map(PathBuf::from);
    Ok(discover(&project, home.as_deref()))
}

pub(crate) fn discover(project: &Path, home: Option<&Path>) -> Vec<DiscoveredMcpServer> {
    definitions(project, home)
        .into_iter()
        .map(|definition| definition.server)
        .collect()
}

pub(crate) fn definitions(project: &Path, home: Option<&Path>) -> Vec<McpDefinition> {
    let mut found: Vec<McpDefinition> = Vec::new();

    if let Some(home) = home {
        // Claude keeps global servers and per-project ones in one file, the
        // latter keyed by the project's absolute path.
        let claude_json = home.join(".claude.json");
        if let Some(value) = read_json(&claude_json) {
            collect_json(
                value.get("mcpServers"),
                "claude",
                "user",
                &claude_json,
                project,
                &mut found,
            );
            if let Some(entry) = project_entry(&value, project) {
                collect_json(
                    entry.get("mcpServers"),
                    "claude",
                    "project",
                    &claude_json,
                    project,
                    &mut found,
                );
            }
        }

        let codex_toml = home.join(".codex").join("config.toml");
        if let Some(value) = read_toml(&codex_toml) {
            collect_toml(
                value.get("mcp_servers"),
                "codex",
                "user",
                &codex_toml,
                project,
                &mut found,
            );
        }

        let cursor_json = home.join(".cursor").join("mcp.json");
        if let Some(value) = read_json(&cursor_json) {
            collect_json(
                value.get("mcpServers"),
                "cursor",
                "user",
                &cursor_json,
                project,
                &mut found,
            );
        }
    }

    // Checked into the repository, so these are the checkout's servers rather
    // than the machine's.
    let project_mcp = project.join(".mcp.json");
    if let Some(value) = read_json(&project_mcp) {
        collect_json(
            value.get("mcpServers"),
            "claude",
            "project",
            &project_mcp,
            project,
            &mut found,
        );
    }

    let cursor_project = project.join(".cursor").join("mcp.json");
    if let Some(value) = read_json(&cursor_project) {
        collect_json(
            value.get("mcpServers"),
            "cursor",
            "project",
            &cursor_project,
            project,
            &mut found,
        );
    }

    found.sort_by(|a, b| {
        a.server
            .name
            .to_lowercase()
            .cmp(&b.server.name.to_lowercase())
            .then(a.server.source.cmp(&b.server.source))
            .then(a.server.scope.cmp(&b.server.scope))
    });
    found.truncate(MAX_SERVERS);
    found
}

/// Claude's `projects` map is keyed by absolute path. Compare the way the rest
/// of wavex does — a trailing separator or a case difference on a
/// case-insensitive filesystem is the same checkout, not another one.
fn project_entry<'a>(
    value: &'a serde_json::Value,
    project: &Path,
) -> Option<&'a serde_json::Value> {
    let projects = value.get("projects")?.as_object()?;
    let wanted = path_key(project);
    projects
        .iter()
        .find(|(key, _)| path_key(Path::new(key.as_str())) == wanted)
        .map(|(_, entry)| entry)
}

fn path_key(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let trimmed = text.trim_end_matches('/');
    let base = if trimmed.is_empty() { "/" } else { trimmed };
    if cfg!(any(target_os = "macos", windows)) {
        base.to_lowercase()
    } else {
        base.to_string()
    }
}

fn read_json(path: &Path) -> Option<serde_json::Value> {
    serde_json::from_str(&read_capped(path)?).ok()
}

/// A whole file is a `Table`; `Value`'s own `FromStr` parses a single value
/// and rejects a document.
fn read_toml(path: &Path) -> Option<toml::Table> {
    read_capped(path)?.parse::<toml::Table>().ok()
}

fn read_capped(path: &Path) -> Option<String> {
    if std::fs::metadata(path).ok()?.len() > MAX_CONFIG_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

fn collect_json(
    value: Option<&serde_json::Value>,
    source: &str,
    scope: &str,
    config_path: &Path,
    project: &Path,
    out: &mut Vec<McpDefinition>,
) {
    let Some(map) = value.and_then(serde_json::Value::as_object) else {
        return;
    };
    for (name, entry) in map {
        if out.len() >= MAX_SERVERS {
            return;
        }
        let Some(entry) = entry.as_object() else {
            continue;
        };
        let url = string_field(entry.get("url"));
        let env = json_pairs(entry.get("env"));
        let headers = json_pairs(entry.get("headers"));
        // `disabled: true` is the JSON dialect's off switch; Codex spells the
        // same thing `enabled = false`.
        let disabled = entry
            .get("disabled")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        out.push(McpDefinition {
            server: DiscoveredMcpServer {
                name: name.clone(),
                source: source.to_string(),
                scope: scope.to_string(),
                transport: transport_of(
                    entry.get("type").and_then(serde_json::Value::as_str),
                    url.as_deref(),
                ),
                command: string_field(entry.get("command")),
                args: entry
                    .get("args")
                    .and_then(serde_json::Value::as_array)
                    .map(|list| {
                        list.iter()
                            .filter_map(|value| value.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default(),
                url,
                env_keys: env.iter().map(|(key, _)| key.clone()).collect(),
                header_keys: headers.iter().map(|(key, _)| key.clone()).collect(),
                cwd: string_field(entry.get("cwd")),
                enabled_in_cli: !disabled,
                config_path: crate::fs::path_to_js(config_path),
            },
            env,
            headers,
            project: project.to_path_buf(),
        });
    }
}

fn collect_toml(
    value: Option<&toml::Value>,
    source: &str,
    scope: &str,
    config_path: &Path,
    project: &Path,
    out: &mut Vec<McpDefinition>,
) {
    let Some(map) = value.and_then(toml::Value::as_table) else {
        return;
    };
    for (name, entry) in map {
        if out.len() >= MAX_SERVERS {
            return;
        }
        let Some(entry) = entry.as_table() else {
            continue;
        };
        let url = entry
            .get("url")
            .and_then(toml::Value::as_str)
            .map(str::to_string);
        let env: Vec<(String, String)> = entry
            .get("env")
            .and_then(toml::Value::as_table)
            .map(|table| {
                table
                    .iter()
                    .filter_map(|(key, value)| {
                        value.as_str().map(|value| (key.clone(), value.to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default();
        // Codex names the environment variable holding the token rather than
        // the header, so the name belongs with the other names the user has to
        // have set, and the value is read here at probe time.
        let bearer = entry
            .get("bearer_token_env_var")
            .and_then(toml::Value::as_str);
        let headers = bearer
            .and_then(|variable| std::env::var(variable).ok())
            .map(|token| vec![("authorization".to_string(), format!("Bearer {token}"))])
            .unwrap_or_default();
        out.push(McpDefinition {
            server: DiscoveredMcpServer {
                name: name.clone(),
                source: source.to_string(),
                scope: scope.to_string(),
                transport: transport_of(
                    entry.get("type").and_then(toml::Value::as_str),
                    url.as_deref(),
                ),
                command: entry
                    .get("command")
                    .and_then(toml::Value::as_str)
                    .map(str::to_string),
                args: entry
                    .get("args")
                    .and_then(toml::Value::as_array)
                    .map(|list| {
                        list.iter()
                            .filter_map(|value| value.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default(),
                url,
                env_keys: env.iter().map(|(key, _)| key.clone()).collect(),
                header_keys: bearer
                    .map(|value| vec![value.to_string()])
                    .unwrap_or_default(),
                cwd: entry
                    .get("cwd")
                    .and_then(toml::Value::as_str)
                    .map(str::to_string),
                enabled_in_cli: entry
                    .get("enabled")
                    .and_then(toml::Value::as_bool)
                    .unwrap_or(true),
                config_path: crate::fs::path_to_js(config_path),
            },
            env,
            headers,
            project: project.to_path_buf(),
        });
    }
}

/// An explicit `type` wins; otherwise a `url` means a remote server and its
/// absence means the CLI spawns a child and talks over its pipes.
fn transport_of(declared: Option<&str>, url: Option<&str>) -> String {
    match declared.map(str::trim).filter(|value| !value.is_empty()) {
        Some("sse") => "sse".to_string(),
        Some("http" | "streamable-http" | "streamable_http") => "http".to_string(),
        Some("stdio" | "local") => "stdio".to_string(),
        Some(other) => other.to_lowercase(),
        None if url.is_some() => "http".to_string(),
        None => "stdio".to_string(),
    }
}

fn string_field(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn json_pairs(value: Option<&serde_json::Value>) -> Vec<(String, String)> {
    value
        .and_then(serde_json::Value::as_object)
        .map(|map| {
            map.iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Probing a server for its tools
// ---------------------------------------------------------------------------

/// One tool a server advertised.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub name: String,
    pub description: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpProbeResult {
    pub ok: bool,
    pub tools: Vec<McpTool>,
    pub error: Option<String>,
}

/// A probe spends the user's machine, so it is bounded rather than patient.
const PROBE_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_TOOLS: usize = 500;
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;

/// Ask one server what tools it has.
///
/// This starts the server. Nothing else in this module does, and nothing calls
/// this on wavex's own initiative — it is wired to an explicit action, for the
/// same reason a language server is never started just because a file was
/// opened. An MCP server is an arbitrary program the user's CLI would run;
/// listing it in a settings page is not consent to execute it.
///
/// The server is named rather than described: the definition is re-read here
/// from the CLI's own config, so the API keys in `env` and `headers` are used
/// without ever having been handed to the WebView.
#[tauri::command(async)]
pub fn probe_mcp_server(
    cwd: String,
    source: String,
    scope: String,
    name: String,
) -> Result<McpProbeResult, String> {
    let project = expand_home(&cwd);
    let home = dirs_home().map(PathBuf::from);
    let definition = definitions(&project, home.as_deref())
        .into_iter()
        .find(|definition| {
            definition.server.name == name
                && definition.server.source == source
                && definition.server.scope == scope
        })
        .ok_or_else(|| format!("No MCP server named {name} in the {source} configuration"))?;

    Ok(match probe(&definition) {
        Ok(tools) => McpProbeResult {
            ok: true,
            tools,
            error: None,
        },
        Err(error) => McpProbeResult {
            ok: false,
            tools: Vec::new(),
            error: Some(error),
        },
    })
}

fn probe(definition: &McpDefinition) -> Result<Vec<McpTool>, String> {
    match definition.server.transport.as_str() {
        "stdio" => probe_stdio(definition),
        "http" => probe_http(definition),
        // The deprecated HTTP+SSE transport opens a stream and reads a POST
        // endpoint back off it. Reporting that plainly beats a probe that
        // half-works.
        other => Err(format!("wavex cannot probe a {other} server yet")),
    }
}

/// The three messages that get from "started" to "what can you do".
fn handshake_messages() -> [String; 3] {
    [
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "wavex", "version": env!("CARGO_PKG_VERSION") },
            },
        })
        .to_string(),
        serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }).to_string(),
        serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} })
            .to_string(),
    ]
}

fn probe_stdio(definition: &McpDefinition) -> Result<Vec<McpTool>, String> {
    let command = definition
        .server
        .command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("The server has no command to run")?;
    let program = resolve_program(command)
        .ok_or_else(|| format!("{command} is not installed on this machine"))?;

    let mut cmd = crate::process::command(&program);
    cmd.args(&definition.server.args);
    crate::harness::apply_gui_env(&mut cmd);
    for (key, value) in &definition.env {
        cmd.env(key, value);
    }
    if let Some(dir) = definition.server.cwd.as_deref() {
        let resolved = expand_home(dir);
        // A relative `cwd` is relative to the config's own project, which is
        // the checkout the probe was asked from.
        cmd.current_dir(if resolved.is_absolute() {
            resolved
        } else {
            definition.project.join(resolved)
        });
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = crate::process::spawn(&mut cmd).map_err(|error| error.to_string())?;
    let result = talk_stdio(&mut child);
    // The server outlives neither the probe nor a failure inside it.
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn talk_stdio(child: &mut std::process::Child) -> Result<Vec<McpTool>, String> {
    let mut stdin = child.stdin.take().ok_or("The server has no stdin")?;
    let stdout = child.stdout.take().ok_or("The server has no stdout")?;
    let stderr = child.stderr.take();

    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            if line.len() > MAX_LINE_BYTES {
                break;
            }
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    for message in handshake_messages() {
        writeln!(stdin, "{message}").map_err(|error| error.to_string())?;
    }
    stdin.flush().map_err(|error| error.to_string())?;

    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(startup_failure(stderr)
                .unwrap_or_else(|| "The server did not answer within 20 seconds".to_string()));
        }
        match rx.recv_timeout(left) {
            Ok(line) => {
                if let Some(tools) = tools_from_response(&line, 2)? {
                    return Ok(tools);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Err(startup_failure(stderr)
                    .unwrap_or_else(|| "The server did not answer within 20 seconds".to_string()))
            }
            // stdout closed: the server exited, and its own words say why
            // better than "the pipe closed" does.
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(startup_failure(stderr)
                    .unwrap_or_else(|| "The server exited before answering".to_string()))
            }
        }
    }
}

/// What the server complained about on its way out, trimmed to something a row
/// can hold.
fn startup_failure(stderr: Option<std::process::ChildStderr>) -> Option<String> {
    let mut text = String::new();
    stderr?
        .take(16 * 1024)
        .read_to_string(&mut text)
        .ok()
        .filter(|read| *read > 0)?;
    let line = text.lines().map(str::trim).rfind(|line| !line.is_empty())?;
    Some(line.chars().take(400).collect())
}

fn probe_http(definition: &McpDefinition) -> Result<Vec<McpTool>, String> {
    let url = definition
        .server
        .url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("The server has no url")?;

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(PROBE_TIMEOUT)
        .build();
    let messages = handshake_messages();
    // A streamable-HTTP server hands out a session id on `initialize` and
    // expects it back; one that does not simply never sets the header.
    let mut session: Option<String> = None;

    for (index, message) in messages.iter().enumerate() {
        let mut request = agent
            .post(url)
            .set("content-type", "application/json")
            .set("accept", "application/json, text/event-stream");
        for (key, value) in &definition.headers {
            request = request.set(key, value);
        }
        if let Some(id) = &session {
            request = request.set("mcp-session-id", id);
        }
        let response = request
            .send_string(message)
            .map_err(|error| http_error(&error))?;
        if session.is_none() {
            session = response
                .header("mcp-session-id")
                .map(str::to_string)
                .filter(|value| !value.is_empty());
        }
        let body = response.into_string().map_err(|error| error.to_string())?;
        if index == 2 {
            for line in json_payloads(&body) {
                if let Some(tools) = tools_from_response(&line, 2)? {
                    return Ok(tools);
                }
            }
            return Err("The server answered without a tool list".to_string());
        }
    }
    Err("The server answered without a tool list".to_string())
}

fn http_error(error: &ureq::Error) -> String {
    match error {
        ureq::Error::Status(code, _) => format!("The server answered HTTP {code}"),
        ureq::Error::Transport(transport) => transport.to_string(),
    }
}

/// A streamable-HTTP server may answer with a plain JSON body or with an SSE
/// stream carrying the same object in a `data:` field.
fn json_payloads(body: &str) -> Vec<String> {
    let trimmed = body.trim_start();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return vec![body.to_string()];
    }
    body.lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

/// `Ok(None)` means "a message, but not the answer we are waiting for" — a
/// server is free to send logs and progress notifications first.
fn tools_from_response(line: &str, id: u64) -> Result<Option<Vec<McpTool>>, String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
        return Ok(None);
    };
    if value.get("id").and_then(serde_json::Value::as_u64) != Some(id) {
        return Ok(None);
    }
    if let Some(error) = value.get("error") {
        let message = error
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("The server refused the request");
        return Err(message.to_string());
    }
    let tools = value
        .get("result")
        .and_then(|result| result.get("tools"))
        .and_then(|tools| tools.as_array())
        .map(|tools| {
            tools
                .iter()
                .take(MAX_TOOLS)
                .filter_map(|tool| {
                    let name = tool.get("name")?.as_str()?.to_string();
                    Some(McpTool {
                        name,
                        description: tool
                            .get("description")
                            .and_then(|value| value.as_str())
                            .unwrap_or_default()
                            .chars()
                            .take(400)
                            .collect(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(Some(tools))
}

/// A configured command is a program name to look up, unless the user already
/// wrote a path. The lookup uses the same search path the agent CLIs get, so a
/// Finder-launched wavex finds `npx` where a terminal would.
fn resolve_program(command: &str) -> Option<PathBuf> {
    let path = Path::new(command);
    if path.components().count() > 1 {
        let expanded = expand_home(command);
        return expanded.exists().then_some(expanded);
    }
    crate::harness::which_in_path(&crate::harness::gui_search_path(), command)
}

// ---------------------------------------------------------------------------
// Handing servers to an ACP agent
// ---------------------------------------------------------------------------

/// One server in the shape ACP's `session/new` takes.
///
/// This is the one place a secret does leave Rust, and it has to: the ACP
/// message is composed in TypeScript and an MCP server's API key travels in it.
/// So the exposure is kept to what the protocol needs — only servers the user
/// switched on, only when a session is actually starting, and never the whole
/// list. `list_mcp_servers` is what the settings page reads, and it still
/// returns names alone.
///
/// Deliberately absent from `connect/dispatch.rs`: over a connection this would
/// send the host's API keys to the client that drew the window. A connected
/// client therefore starts ACP sessions with no MCP servers, exactly as every
/// client did before this existed.
#[tauri::command(async)]
pub fn mcp_session_servers(
    cwd: String,
    names: Vec<String>,
    http: bool,
) -> Result<Vec<serde_json::Value>, String> {
    let project = expand_home(&cwd);
    let home = dirs_home().map(PathBuf::from);
    Ok(acp_entries(
        &definitions(&project, home.as_deref()),
        &names,
        http,
    ))
}

fn acp_entries(
    definitions: &[McpDefinition],
    names: &[String],
    http: bool,
) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    for name in names {
        // A name configured for several CLIs is one server, so the agent is
        // handed it once. Which definition wins is decided by whether an entry
        // can be built from it rather than by sort order alone: the same name
        // is commonly stdio in one CLI and http in another, and taking the
        // first blindly would drop a server the agent could have used.
        let entry = definitions
            .iter()
            .filter(|definition| {
                &definition.server.name == name && definition.server.enabled_in_cli
            })
            .find_map(|definition| acp_entry(definition, http));
        if let Some(entry) = entry {
            out.push(entry);
        }
    }
    out
}

fn acp_entry(definition: &McpDefinition, http: bool) -> Option<serde_json::Value> {
    let name = definition.server.name.clone();
    match definition.server.transport.as_str() {
        "stdio" => {
            let command = definition.server.command.clone()?;
            Some(serde_json::json!({
                "name": name,
                "command": command,
                "args": definition.server.args,
                "env": name_values(&definition.env),
            }))
        }
        // An agent that never advertised HTTP support would reject the entry
        // and take the whole session down with it.
        "http" if http => Some(serde_json::json!({
            "type": "http",
            "name": name,
            "url": definition.server.url.clone()?,
            "headers": name_values(&definition.headers),
        })),
        _ => None,
    }
}

fn name_values(pairs: &[(String, String)]) -> Vec<serde_json::Value> {
    pairs
        .iter()
        .map(|(name, value)| serde_json::json!({ "name": name, "value": value }))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, body: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "wavex-mcp-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_claude_user_and_project_servers() {
        let root = temp_dir("claude");
        let home = root.join("home");
        let project = root.join("code/app");
        std::fs::create_dir_all(&project).unwrap();
        write(
            &home.join(".claude.json"),
            &format!(
                r#"{{
                  "mcpServers": {{
                    "context7": {{ "command": "npx", "args": ["-y", "@upstash/context7-mcp"] }}
                  }},
                  "projects": {{
                    "{}": {{ "mcpServers": {{ "book": {{ "command": "book-mcp" }} }} }}
                  }}
                }}"#,
                project.to_string_lossy().replace('\\', "\\\\")
            ),
        );

        let found = discover(&project, Some(&home));
        let names: Vec<_> = found
            .iter()
            .map(|server| (server.name.as_str(), server.scope.as_str()))
            .collect();
        assert_eq!(names, vec![("book", "project"), ("context7", "user")]);
        assert_eq!(found[1].transport, "stdio");
        assert_eq!(found[1].args, vec!["-y", "@upstash/context7-mcp"]);
    }

    /// The per-project key is an absolute path written by another program, so
    /// a trailing separator must not hide the entry.
    #[test]
    fn matches_the_project_key_despite_a_trailing_separator() {
        let root = temp_dir("trailing");
        let home = root.join("home");
        let project = root.join("code/app");
        std::fs::create_dir_all(&project).unwrap();
        write(
            &home.join(".claude.json"),
            &format!(
                r#"{{ "projects": {{ "{}/": {{ "mcpServers": {{ "book": {{ "command": "book-mcp" }} }} }} }} }}"#,
                project.to_string_lossy().replace('\\', "\\\\")
            ),
        );

        let found = discover(&project, Some(&home));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "book");
    }

    #[test]
    fn reads_codex_toml_including_its_off_switch_and_http_form() {
        let root = temp_dir("codex");
        let home = root.join("home");
        let project = root.join("code/app");
        std::fs::create_dir_all(&project).unwrap();
        write(
            &home.join(".codex/config.toml"),
            r#"
[mcp_servers.computer-use]
command = "./client"
args = [ "mcp" ]
enabled = false

[mcp_servers.better-auth]
type = "http"
url = "https://mcp.better-auth.com/mcp"

[mcp_servers.shadcn]
command = "npx"
args = [ "-y", "shadcn@latest", "mcp" ]

  [mcp_servers.shadcn.env]
  SHADCN_TOKEN = "secret-value"
"#,
        );

        let found = discover(&project, Some(&home));
        let by_name = |name: &str| {
            found
                .iter()
                .find(|server| server.name == name)
                .unwrap_or_else(|| panic!("{name} missing"))
        };
        assert!(!by_name("computer-use").enabled_in_cli);
        assert_eq!(by_name("better-auth").transport, "http");
        assert_eq!(
            by_name("better-auth").url.as_deref(),
            Some("https://mcp.better-auth.com/mcp")
        );
        assert_eq!(by_name("shadcn").transport, "stdio");
        assert_eq!(by_name("shadcn").env_keys, vec!["SHADCN_TOKEN"]);
    }

    /// The whole point of the boundary: a settings page may say a key is
    /// needed, and may never learn what it is.
    #[test]
    fn never_returns_a_secret_value() {
        let root = temp_dir("secrets");
        let home = root.join("home");
        let project = root.join("code/app");
        std::fs::create_dir_all(&project).unwrap();
        write(
            &home.join(".claude.json"),
            r#"{ "mcpServers": { "paid": {
                 "url": "https://example.test/mcp",
                 "headers": { "Authorization": "Bearer super-secret" },
                 "env": { "API_KEY": "also-secret" } } } }"#,
        );

        let found = discover(&project, Some(&home));
        let json = serde_json::to_string(&found).unwrap();
        assert!(!json.contains("super-secret"), "{json}");
        assert!(!json.contains("also-secret"), "{json}");
        assert!(json.contains("Authorization"));
        assert!(json.contains("API_KEY"));
    }

    #[test]
    fn reads_the_checked_in_project_file() {
        let root = temp_dir("project-file");
        let project = root.join("code/app");
        std::fs::create_dir_all(&project).unwrap();
        write(
            &project.join(".mcp.json"),
            r#"{ "mcpServers": { "repo": { "command": "repo-mcp", "disabled": true } } }"#,
        );
        write(
            &project.join(".cursor/mcp.json"),
            r#"{ "mcpServers": { "cursorish": { "command": "cursor-mcp" } } }"#,
        );

        let found = discover(&project, None);
        assert_eq!(found.len(), 2);
        let repo = found.iter().find(|s| s.name == "repo").unwrap();
        assert_eq!(repo.source, "claude");
        assert_eq!(repo.scope, "project");
        assert!(!repo.enabled_in_cli);
        assert_eq!(
            found.iter().find(|s| s.name == "cursorish").unwrap().source,
            "cursor"
        );
    }

    #[test]
    fn survives_a_broken_or_missing_config() {
        let root = temp_dir("broken");
        let home = root.join("home");
        let project = root.join("code/app");
        std::fs::create_dir_all(&project).unwrap();
        write(&home.join(".claude.json"), "{ not json");
        write(&home.join(".codex/config.toml"), "[[[");
        assert!(discover(&project, Some(&home)).is_empty());
    }

    #[test]
    fn infers_transport_from_the_shape_when_none_is_declared() {
        assert_eq!(transport_of(None, None), "stdio");
        assert_eq!(transport_of(None, Some("https://example.test")), "http");
        assert_eq!(
            transport_of(Some("sse"), Some("https://example.test")),
            "sse"
        );
        assert_eq!(transport_of(Some("streamable-http"), None), "http");
        assert_eq!(transport_of(Some(" "), None), "stdio");
    }

    #[test]
    fn builds_acp_entries_only_for_transports_the_agent_supports() {
        let root = temp_dir("acp");
        let home = root.join("home");
        let project = root.join("code/app");
        std::fs::create_dir_all(&project).unwrap();
        write(
            &home.join(".claude.json"),
            r#"{ "mcpServers": {
                 "local": { "command": "npx", "args": ["-y", "thing"], "env": { "K": "v" } },
                 "remote": { "url": "https://example.test/mcp" },
                 "off": { "command": "nope", "disabled": true } } }"#,
        );
        let found = definitions(&project, Some(&home));
        let by_name = |name: &str| found.iter().find(|d| d.server.name == name).unwrap();

        assert_eq!(
            acp_entry(by_name("local"), false),
            Some(serde_json::json!({
                "name": "local",
                "command": "npx",
                "args": ["-y", "thing"],
                "env": [{ "name": "K", "value": "v" }],
            }))
        );
        // No advertised HTTP support: the entry is dropped rather than sent and
        // refused, because a refused `session/new` is a session that never starts.
        assert_eq!(acp_entry(by_name("remote"), false), None);
        assert_eq!(
            acp_entry(by_name("remote"), true).and_then(|entry| entry
                .get("url")
                .and_then(|url| url.as_str())
                .map(str::to_string)),
            Some("https://example.test/mcp".to_string())
        );
    }

    /// The same name is commonly stdio in one CLI and http in another. An agent
    /// without HTTP support must still get the stdio definition, whichever of
    /// the two sorts first.
    #[test]
    fn falls_through_to_a_definition_the_agent_can_actually_take() {
        let root = temp_dir("mixed");
        let home = root.join("home");
        let project = root.join("code/app");
        std::fs::create_dir_all(&project).unwrap();
        // `claude` sorts before `codex`, so the http definition is seen first.
        write(
            &home.join(".claude.json"),
            r#"{ "mcpServers": { "both": { "url": "https://example.test/mcp" } } }"#,
        );
        write(
            &home.join(".codex/config.toml"),
            "[mcp_servers.both]\ncommand = \"both-mcp\"\n",
        );

        let found = definitions(&project, Some(&home));
        let entries = acp_entries(&found, &["both".to_string()], false);
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].get("command").and_then(|value| value.as_str()),
            Some("both-mcp")
        );

        // With HTTP support the http definition is usable, and the server is
        // still handed over exactly once.
        assert_eq!(acp_entries(&found, &["both".to_string()], true).len(), 1);
    }

    #[test]
    fn a_server_the_cli_switched_off_is_never_handed_to_an_agent() {
        let root = temp_dir("acp-off");
        let home = root.join("home");
        let project = root.join("code/app");
        std::fs::create_dir_all(&project).unwrap();
        write(
            &home.join(".claude.json"),
            r#"{ "mcpServers": {
                 "off": { "command": "nope", "disabled": true },
                 "on": { "command": "yes" } } }"#,
        );

        let found = definitions(&project, Some(&home));
        let names = vec!["off".to_string(), "missing".to_string(), "on".to_string()];
        let entries = acp_entries(&found, &names, true);
        assert_eq!(
            entries
                .iter()
                .filter_map(|entry| entry.get("name").and_then(|value| value.as_str()))
                .collect::<Vec<_>>(),
            vec!["on"]
        );
    }

    #[test]
    fn reads_a_tool_list_and_ignores_the_chatter_before_it() {
        assert_eq!(
            tools_from_response(r#"{"jsonrpc":"2.0","method":"log"}"#, 2),
            Ok(None)
        );
        assert_eq!(tools_from_response(r#"{"id":1,"result":{}}"#, 2), Ok(None));
        assert_eq!(
            tools_from_response(
                r#"{"id":2,"result":{"tools":[{"name":"search","description":"Find things"}]}}"#,
                2
            ),
            Ok(Some(vec![McpTool {
                name: "search".to_string(),
                description: "Find things".to_string(),
            }]))
        );
        assert_eq!(
            tools_from_response(r#"{"id":2,"error":{"message":"nope"}}"#, 2),
            Err("nope".to_string())
        );
    }

    #[test]
    fn takes_the_json_out_of_an_sse_answer() {
        assert_eq!(
            json_payloads(r#"{"id":2}"#),
            vec![r#"{"id":2}"#.to_string()]
        );
        assert_eq!(
            json_payloads("event: message\ndata: {\"id\":2}\n\n"),
            vec!["{\"id\":2}".to_string()]
        );
    }
}
