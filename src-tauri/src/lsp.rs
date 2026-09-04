//! Language server host.
//!
//! Language servers are long-lived stdio children that speak JSON-RPC in
//! `Content-Length`-framed messages. This module supervises the processes and
//! moves whole frames across the Tauri boundary; it knows nothing about the
//! protocol above that. Capability negotiation, document sync, and every
//! request live in the TypeScript client under `src/lib/lsp/`.
//!
//! It deliberately does not reuse `harness.rs`. That host reads newline
//! delimited JSON and carries agent-session semantics — bind, cancel, idle
//! park — that a language server does not have. Binary discovery and the child
//! environment are shared with it rather than copied.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{ChildStdin, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::fs::expand_home;

const MESSAGE_EVENT: &str = "lsp-message";
const STDERR_EVENT: &str = "lsp-stderr";
const EXIT_EVENT: &str = "lsp-exit";

/// A server that answers with more than this is malfunctioning, and buffering
/// it would take the app down with it. rust-analyzer's largest real responses
/// (workspace symbols on a big crate graph) stay a few megabytes.
const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

/// Stderr is a diagnostic channel, not a data channel: forward the first lines
/// a failing server prints and drop the rest on the floor.
const MAX_STDERR_LINES: usize = 200;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LspMessage {
    server_id: String,
    message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LspExit {
    server_id: String,
    code: Option<i32>,
    pid: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspBinary {
    pub path: String,
    /// The candidate name that matched, so the client knows which server it got
    /// when one definition lists several executables.
    pub name: String,
}

struct LiveServer {
    stdin: Mutex<ChildStdin>,
    pid: u32,
}

pub struct LspHost {
    servers: Mutex<HashMap<String, Arc<LiveServer>>>,
    /// Bumped by `stop_all` so a start that was already forking cannot reinsert
    /// its child after a profile switch or quit has drained the map.
    stop_all_gen: AtomicU64,
}

impl LspHost {
    pub fn new() -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
            stop_all_gen: AtomicU64::new(0),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<LiveServer>>> {
        self.servers.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn get(&self, server_id: &str) -> Option<Arc<LiveServer>> {
        self.lock().get(server_id).cloned()
    }

    fn begin_start(&self, server_id: &str) -> (u64, Option<Arc<LiveServer>>) {
        let mut servers = self.lock();
        let generation = self.stop_all_gen.load(Ordering::SeqCst);
        (generation, servers.remove(server_id))
    }

    /// Keep the child only if nothing stopped this start while it was forking.
    fn install(
        &self,
        server_id: String,
        generation: u64,
        live: Arc<LiveServer>,
    ) -> Option<Arc<LiveServer>> {
        let mut servers = self.lock();
        if self.stop_all_gen.load(Ordering::SeqCst) != generation {
            return Some(live);
        }
        if let Some(previous) = servers.insert(server_id, live) {
            crate::harness::terminate_all(&[previous.pid]);
        }
        None
    }

    fn remove(&self, server_id: &str) -> Option<Arc<LiveServer>> {
        self.lock().remove(server_id)
    }

    fn remove_if_pid(&self, server_id: &str, pid: u32) -> Option<Arc<LiveServer>> {
        let mut servers = self.lock();
        if servers.get(server_id).map(|live| live.pid) != Some(pid) {
            return None;
        }
        servers.remove(server_id)
    }

    pub(crate) fn stop_all(&self) {
        let servers: Vec<Arc<LiveServer>> = {
            let mut servers = self.lock();
            self.stop_all_gen.fetch_add(1, Ordering::SeqCst);
            servers.drain().map(|(_, live)| live).collect()
        };
        let pids: Vec<u32> = servers.iter().map(|live| live.pid).collect();
        // Drop stdin first: a server blocked on a read exits on its own once the
        // pipe closes, which is cleaner than the signal that follows.
        drop(servers);
        crate::harness::terminate_all(&pids);
    }
}

impl Drop for LspHost {
    fn drop(&mut self) {
        self.stop_all();
    }
}

/// Find the first installed candidate for a server definition.
///
/// Resolution goes through the harness binary search, so a language server
/// installed by npm, Homebrew, rustup, mise, or a version manager is found the
/// same way an agent CLI is — including the `.cmd` shim npm writes on Windows.
#[tauri::command(async)]
pub fn lsp_resolve(names: Vec<String>) -> Option<LspBinary> {
    names.into_iter().find_map(|name| {
        let path = crate::harness::resolve_gui_binary(&name)?;
        // `binary_name_eq`, not a string compare on the file name: the resolved
        // path is `typescript-language-server.cmd` on Windows, and Windows file
        // names do not carry case.
        if !crate::harness::binary_name_eq(&path, &name) {
            return None;
        }
        Some(LspBinary {
            path: crate::fs::path_to_js(&path),
            name,
        })
    })
}

/// Off the main thread: fork/exec, and the child environment can wait on the
/// first login-shell read.
#[tauri::command(async)]
pub fn lsp_start(
    app: AppHandle,
    host: State<'_, LspHost>,
    server_id: String,
    command: String,
    args: Vec<String>,
    cwd: String,
) -> Result<u32, String> {
    let (generation, previous) = host.begin_start(&server_id);
    if let Some(previous) = previous {
        crate::harness::terminate_all(&[previous.pid]);
    }

    let workdir = expand_home(&cwd);
    if !workdir.is_dir() {
        return Err(format!(
            "Project directory does not exist: {}",
            workdir.display()
        ));
    }

    let mut cmd = crate::process::command(&command);
    cmd.args(&args)
        .current_dir(&workdir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::harness::apply_gui_env(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start {command}: {e}"))?;
    let pid = child.id();

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open language server stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open language server stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open language server stderr".to_string())?;

    let live = Arc::new(LiveServer {
        stdin: Mutex::new(stdin),
        pid,
    });
    if let Some(rejected) = host.install(server_id.clone(), generation, live) {
        // A stop, or a newer start, won the race while this one was forking.
        crate::harness::terminate_all(&[rejected.pid]);
        thread::spawn(move || {
            let _ = child.wait();
        });
        return Err("Language server start was cancelled".into());
    }

    spawn_reader(app.clone(), server_id.clone(), stdout);
    spawn_stderr_reader(app.clone(), server_id.clone(), stderr);

    thread::spawn(move || {
        let code = child.wait().ok().and_then(|status| status.code());
        if let Some(host) = app.try_state::<LspHost>() {
            host.remove_if_pid(&server_id, pid);
        }
        let _ = app.emit(
            EXIT_EVENT,
            LspExit {
                server_id,
                code,
                pid,
            },
        );
    });

    Ok(pid)
}

/// Write one JSON-RPC message with its `Content-Length` header.
#[tauri::command]
pub fn lsp_send(
    host: State<'_, LspHost>,
    server_id: String,
    message: String,
) -> Result<(), String> {
    let live = host
        .get(&server_id)
        .ok_or_else(|| "Language server is not running".to_string())?;
    let mut stdin = live.stdin.lock().unwrap_or_else(|e| e.into_inner());
    let body = message.as_bytes();
    stdin
        .write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
        .and_then(|_| stdin.write_all(body))
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("Failed to write to the language server: {e}"))
}

#[tauri::command]
pub fn lsp_stop(host: State<'_, LspHost>, server_id: String) -> Result<(), String> {
    if let Some(live) = host.remove(&server_id) {
        crate::harness::terminate_all(&[live.pid]);
    }
    Ok(())
}

/// Off the main thread: it waits for the children to die before returning, and
/// a profile switch calls it while the app keeps running.
#[tauri::command(async)]
pub fn lsp_stop_all(host: State<'_, LspHost>) -> Result<(), String> {
    host.stop_all();
    Ok(())
}

fn spawn_reader(app: AppHandle, server_id: String, stdout: impl Read + Send + 'static) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_frame(&mut reader) {
                Ok(Some(frame)) => {
                    // Servers must send UTF-8. A frame that is not is dropped
                    // rather than lossily repaired, which would hand the client
                    // JSON it cannot trust.
                    let Ok(message) = String::from_utf8(frame) else {
                        continue;
                    };
                    let _ = app.emit(
                        MESSAGE_EVENT,
                        LspMessage {
                            server_id: server_id.clone(),
                            message,
                        },
                    );
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    });
}

fn spawn_stderr_reader(app: AppHandle, server_id: String, stderr: impl Read + Send + 'static) {
    thread::spawn(move || {
        // Read to end of stream even after the cap: rust-analyzer logs to stderr
        // for as long as it runs, and closing the pipe early would hand it a
        // broken fd rather than merely stop forwarding.
        for (index, line) in BufReader::new(stderr).lines().enumerate() {
            let Ok(line) = line else { break };
            if index >= MAX_STDERR_LINES {
                continue;
            }
            let _ = app.emit(
                STDERR_EVENT,
                LspMessage {
                    server_id: server_id.clone(),
                    message: line,
                },
            );
        }
    });
}

/// Read one `Content-Length`-framed message body, or `None` at end of stream.
///
/// The body is read by byte count, not by line: a JSON-RPC message may contain
/// newlines, and `Content-Length` counts bytes rather than characters.
fn read_frame(reader: &mut impl BufRead) -> std::io::Result<Option<Vec<u8>>> {
    let mut length: Option<usize> = None;
    let mut header = String::new();
    loop {
        header.clear();
        let read = reader.read_line(&mut header)?;
        if read == 0 {
            return Ok(None);
        }
        let line = header.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                length = value.trim().parse::<usize>().ok();
            }
        }
    }

    let Some(length) = length else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Language server sent a frame with no Content-Length",
        ));
    };
    if length > MAX_FRAME_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Language server sent an oversized frame",
        ));
    }

    let mut body = vec![0u8; length];
    reader.read_exact(&mut body)?;
    Ok(Some(body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn frames(input: &str) -> Vec<String> {
        let mut reader = Cursor::new(input.as_bytes().to_vec());
        let mut out = Vec::new();
        while let Ok(Some(frame)) = read_frame(&mut reader) {
            out.push(String::from_utf8(frame).unwrap());
        }
        out
    }

    #[test]
    fn reads_consecutive_frames() {
        let input = "Content-Length: 2\r\n\r\n{}Content-Length: 5\r\n\r\n[1,2]";
        assert_eq!(frames(input), vec!["{}".to_string(), "[1,2]".to_string()]);
    }

    #[test]
    fn reads_a_body_that_contains_newlines() {
        let body = "{\n\"a\": 1\n}";
        let input = format!("Content-Length: {}\r\n\r\n{body}", body.len());
        assert_eq!(frames(&input), vec![body.to_string()]);
    }

    #[test]
    fn counts_bytes_not_characters() {
        // A body of one multi-byte character is 3 bytes, not 1.
        let body = "\"\u{20ac}\"";
        let input = format!("Content-Length: {}\r\n\r\n{body}", body.len());
        assert_eq!(frames(&input), vec![body.to_string()]);
    }

    #[test]
    fn ignores_other_headers_and_header_case() {
        let input = "content-type: application/vscode-jsonrpc\r\nCONTENT-LENGTH: 2\r\n\r\n{}";
        assert_eq!(frames(input), vec!["{}".to_string()]);
    }

    #[test]
    fn end_of_stream_ends_the_loop() {
        let mut reader = Cursor::new(Vec::new());
        assert!(read_frame(&mut reader).unwrap().is_none());
    }

    #[test]
    fn a_frame_with_no_length_is_an_error() {
        let mut reader = Cursor::new(b"Content-Type: x\r\n\r\n{}".to_vec());
        assert!(read_frame(&mut reader).is_err());
    }

    #[test]
    fn an_oversized_frame_is_refused_before_allocating() {
        let input = format!("Content-Length: {}\r\n\r\n", MAX_FRAME_BYTES + 1);
        let mut reader = Cursor::new(input.into_bytes());
        assert!(read_frame(&mut reader).is_err());
    }
}
