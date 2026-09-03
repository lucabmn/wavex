//! Reading a provider CLI's own transcript.
//!
//! An agent left running across a profile switch finishes its turn with no
//! webview attached, so wavex never sees the stream. The CLI keeps its own
//! record of that turn, and this is the only way back to what it produced.
//! Only the raw lines cross the boundary; deciding what they mean belongs to
//! the harness adapter in TypeScript.

use std::path::{Path, PathBuf};

/// A transcript far larger than this is not a lost turn, it is a whole
/// conversation history. Reading it in full would stall the boot that asks
/// for it.
const MAX_BYTES: u64 = 32 * 1024 * 1024;

/// Claude names a project directory after its working directory, with every
/// separator and dot flattened to a dash: `/Users/me/.config/app` becomes
/// `-Users-me--config-app`.
pub fn claude_project_slug(cwd: &str) -> String {
    cwd.chars()
        .map(|c| {
            if c == '/' || c == '\\' || c == '.' {
                '-'
            } else {
                c
            }
        })
        .collect()
}

/// Rejects anything that could name a file outside the session directory.
/// The id arrives from a stored session record and is used as a file name.
fn validate_session_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 {
        return Err("Invalid provider session id".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid provider session id".into());
    }
    Ok(())
}

fn read_lines(path: &Path) -> Result<Vec<String>, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_BYTES {
        return Err("Transcript is too large to read".into());
    }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(raw
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(str::to_string)
        .collect())
}

/// The transcript Claude wrote for one session.
///
/// The slug is derived from the working directory, but a session can outlive
/// the path it started in — a worktree moved, a project reopened from a
/// symlink — so a miss falls back to searching the project directories for the
/// file by name rather than reporting the turn as lost.
#[tauri::command(async)]
pub fn harness_claude_transcript(
    cwd: String,
    provider_session_id: String,
) -> Result<Vec<String>, String> {
    validate_session_id(&provider_session_id)?;
    let home = dirs_home()?;
    let projects = home.join(".claude").join("projects");
    let file = format!("{provider_session_id}.jsonl");

    let direct = projects.join(claude_project_slug(&cwd)).join(&file);
    if direct.is_file() {
        return read_lines(&direct);
    }

    let Ok(entries) = std::fs::read_dir(&projects) else {
        return Ok(Vec::new());
    };
    for entry in entries.flatten() {
        let candidate = entry.path().join(&file);
        if candidate.is_file() {
            return read_lines(&candidate);
        }
    }
    Ok(Vec::new())
}

fn dirs_home() -> Result<PathBuf, String> {
    #[allow(deprecated)]
    std::env::home_dir().ok_or_else(|| "No home directory".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_project_slug_flattens_separators_and_dots() {
        assert_eq!(
            claude_project_slug("/private/tmp/wavex"),
            "-private-tmp-wavex"
        );
        assert_eq!(
            claude_project_slug("/Users/me/.config/app"),
            "-Users-me--config-app"
        );
        assert_eq!(claude_project_slug("C:\\Users\\me\\app"), "C:-Users-me-app");
    }

    #[test]
    fn a_session_id_may_not_name_a_file_outside_its_directory() {
        assert!(validate_session_id("../../etc/passwd").is_err());
        assert!(validate_session_id("a/b").is_err());
        assert!(validate_session_id("").is_err());
        assert!(validate_session_id("62adeaab-c712-4f6b-9226-0d907497a950").is_ok());
    }
}
