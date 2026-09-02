//! Git worktrees: one checkout per branch, so several agents can work in the
//! same repository at once without overwriting each other's files.
//!
//! Everything here is plain `git worktree` plumbing. wavex adds no state of its
//! own — the repository stays the single source of truth, and a worktree made
//! in a terminal shows up here exactly like one made from the sidebar.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::fs::{expand_home, git_default_branch, git_is_work_tree, git_ref_exists, git_run};

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    /// Short branch name, or `None` when the checkout is detached or bare.
    pub branch: Option<String>,
    pub head: Option<String>,
    /// The repository's own working tree — it can never be removed.
    pub main: bool,
    pub detached: bool,
    pub bare: bool,
    pub locked: bool,
    pub lock_reason: Option<String>,
    /// Git considers the registration stale (`git worktree prune` would drop it).
    pub prunable: bool,
    /// The folder is gone from disk but the registration survives.
    pub missing: bool,
}

/// Every worktree of the repository `cwd` belongs to, main one first.
#[tauri::command]
pub async fn git_worktree_list(cwd: String) -> Result<Vec<Worktree>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(worktree_list(&expand_home(&cwd))))
        .await
        .map_err(|e| e.to_string())?
}

/// Add a worktree at `path`, checking out `branch` — created from `base` when
/// it does not exist yet.
#[tauri::command]
pub async fn git_worktree_create(
    cwd: String,
    path: String,
    branch: String,
    base: Option<String>,
) -> Result<Worktree, String> {
    tauri::async_runtime::spawn_blocking(move || {
        worktree_create(
            &expand_home(&cwd),
            &expand_home(&path),
            branch.trim(),
            base.as_deref().map(str::trim).filter(|b| !b.is_empty()),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Remove a worktree's folder and its registration. `force` is needed once the
/// checkout has uncommitted work; `delete_branch` also drops the branch itself.
#[tauri::command]
pub async fn git_worktree_remove(
    cwd: String,
    path: String,
    force: bool,
    delete_branch: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        worktree_remove(
            &expand_home(&cwd),
            &expand_home(&path),
            force,
            delete_branch,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Drop registrations whose folder is gone.
#[tauri::command]
pub async fn git_worktree_prune(cwd: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_exec(&expand_home(&cwd), &["worktree", "prune"]).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn worktree_list(root: &Path) -> Vec<Worktree> {
    if !git_is_work_tree(root) {
        return Vec::new();
    }
    let Some(text) = git_run(root, &["worktree", "list", "--porcelain"]) else {
        return Vec::new();
    };
    let mut worktrees = parse_worktree_list(&text);
    for worktree in &mut worktrees {
        worktree.missing = !Path::new(&worktree.path).is_dir();
    }
    worktrees
}

fn worktree_create(
    root: &Path,
    path: &Path,
    branch: &str,
    base: Option<&str>,
) -> Result<Worktree, String> {
    if !git_is_work_tree(root) {
        return Err("This folder is not a git repository.".into());
    }
    validate_branch_name(root, branch)?;
    let path = validate_target_path(root, path)?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            format!(
                "Could not create {}: {err}",
                parent.to_string_lossy().trim()
            )
        })?;
    }

    let target = path.to_string_lossy().into_owned();
    if git_ref_exists(root, &format!("refs/heads/{branch}")) {
        git_exec(root, &["worktree", "add", &target, branch])?;
    } else {
        // No base ref at all still works: `git worktree add -b` branches from
        // HEAD, which is what a plain "new branch here" means.
        let start = base
            .map(str::to_string)
            .or_else(|| git_default_branch(root, None))
            .unwrap_or_else(|| "HEAD".into());
        git_exec(root, &["worktree", "add", "-b", branch, &target, &start])?;
    }

    worktree_list(root)
        .into_iter()
        .find(|worktree| same_path(&worktree.path, &target))
        .ok_or_else(|| "Git reported no worktree at the new folder.".to_string())
}

fn worktree_remove(
    root: &Path,
    path: &Path,
    force: bool,
    delete_branch: bool,
) -> Result<(), String> {
    let target = path.to_string_lossy().into_owned();
    let branch = worktree_list(root)
        .into_iter()
        .find(|worktree| same_path(&worktree.path, &target))
        .and_then(|worktree| {
            if worktree.main {
                // The repository's own checkout is not ours to delete, and git
                // would refuse anyway — say so in the app's own words.
                None
            } else {
                worktree.branch
            }
        });

    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&target);
    git_exec(root, &args)?;

    if delete_branch {
        if let Some(branch) = branch.as_deref() {
            // `-D`, not `-d`: the caller ticked a box that says the branch goes
            // with the worktree, and `-d` would refuse on unmerged work — which
            // is exactly the branch someone abandons this way.
            git_exec(root, &["branch", "-D", branch])?;
        }
    }
    Ok(())
}

/// Records are blank-line separated; the first one is always the main worktree.
fn parse_worktree_list(text: &str) -> Vec<Worktree> {
    let mut out: Vec<Worktree> = Vec::new();
    let mut current: Option<Worktree> = None;

    for line in text.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            if let Some(worktree) = current.take() {
                out.push(worktree);
            }
            continue;
        }
        let (key, value) = match line.split_once(' ') {
            Some((key, value)) => (key, value.trim()),
            None => (line, ""),
        };
        match key {
            "worktree" => {
                if let Some(worktree) = current.take() {
                    out.push(worktree);
                }
                current = Some(Worktree {
                    path: value.to_string(),
                    main: out.is_empty(),
                    ..Worktree::default()
                });
            }
            "HEAD" => {
                if let Some(worktree) = current.as_mut() {
                    worktree.head = Some(value.to_string());
                }
            }
            "branch" => {
                if let Some(worktree) = current.as_mut() {
                    worktree.branch = Some(short_branch(value));
                }
            }
            "detached" => {
                if let Some(worktree) = current.as_mut() {
                    worktree.detached = true;
                }
            }
            "bare" => {
                if let Some(worktree) = current.as_mut() {
                    worktree.bare = true;
                }
            }
            "locked" => {
                if let Some(worktree) = current.as_mut() {
                    worktree.locked = true;
                    worktree.lock_reason = (!value.is_empty()).then(|| value.to_string());
                }
            }
            "prunable" => {
                if let Some(worktree) = current.as_mut() {
                    worktree.prunable = true;
                }
            }
            _ => {}
        }
    }
    if let Some(worktree) = current.take() {
        out.push(worktree);
    }
    out
}

fn short_branch(refname: &str) -> String {
    refname
        .strip_prefix("refs/heads/")
        .unwrap_or(refname)
        .to_string()
}

fn validate_branch_name(root: &Path, branch: &str) -> Result<(), String> {
    if branch.is_empty() {
        return Err("Enter a branch name.".into());
    }
    // Let git own the rule set instead of half-reimplementing check-ref-format.
    let ok = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["check-ref-format", "--branch", branch])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err(format!("“{branch}” is not a valid branch name."))
    }
}

/// The folder has to be absolute, free, and outside the repository — anything
/// inside it would be indexed and watched as part of the project itself.
fn validate_target_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Choose an absolute path for the worktree folder.".into());
    }
    if path.exists() {
        let empty = std::fs::read_dir(path)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);
        if !empty {
            return Err(format!(
                "{} already exists and is not empty.",
                path.to_string_lossy()
            ));
        }
    }
    if let Some(repo_root) = main_worktree_path(root) {
        if path.starts_with(&repo_root) {
            return Err(format!(
                "Choose a folder outside {} — a worktree inside the repository would be indexed as part of it.",
                repo_root.to_string_lossy()
            ));
        }
    }
    Ok(path.to_path_buf())
}

fn main_worktree_path(root: &Path) -> Option<PathBuf> {
    worktree_list(root)
        .into_iter()
        .find(|worktree| worktree.main)
        .map(|worktree| PathBuf::from(worktree.path))
}

fn same_path(a: &str, b: &str) -> bool {
    let trim = |value: &str| value.trim_end_matches('/').to_string();
    trim(a) == trim(b)
}

/// Runs git and keeps stderr, which is the whole value here: "is already
/// checked out at …" is the message the UI turns into a jump action.
fn git_exec(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("--no-pager")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|err| format!("Could not run git: {err}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("git {} failed.", args.join(" "))
    } else {
        stderr
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_main_and_linked_worktrees() {
        let text = "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /trees/feature\nHEAD def456\nbranch refs/heads/feature/login\n";
        let worktrees = parse_worktree_list(text);
        assert_eq!(worktrees.len(), 2);
        assert!(worktrees[0].main);
        assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
        assert!(!worktrees[1].main);
        assert_eq!(worktrees[1].path, "/trees/feature");
        assert_eq!(worktrees[1].branch.as_deref(), Some("feature/login"));
        assert_eq!(worktrees[1].head.as_deref(), Some("def456"));
    }

    #[test]
    fn parses_detached_bare_locked_and_prunable_records() {
        let text = "worktree /repo\nbare\n\nworktree /trees/detached\nHEAD abc123\ndetached\n\nworktree /trees/locked\nHEAD def456\nbranch refs/heads/wip\nlocked on an external drive\nprunable gitdir file points to non-existent location\n";
        let worktrees = parse_worktree_list(text);
        assert_eq!(worktrees.len(), 3);
        assert!(worktrees[0].bare);
        assert!(worktrees[1].detached);
        assert!(worktrees[1].branch.is_none());
        assert!(worktrees[2].locked);
        assert_eq!(
            worktrees[2].lock_reason.as_deref(),
            Some("on an external drive")
        );
        assert!(worktrees[2].prunable);
    }

    #[test]
    fn keeps_paths_containing_spaces() {
        let text = "worktree /Users/me/My Repo\nHEAD abc123\nbranch refs/heads/main\n";
        let worktrees = parse_worktree_list(text);
        assert_eq!(worktrees[0].path, "/Users/me/My Repo");
    }

    #[test]
    fn tolerates_a_trailing_record_without_a_blank_line() {
        let text = "worktree /repo\nHEAD abc123\nbranch refs/heads/main";
        assert_eq!(parse_worktree_list(text).len(), 1);
    }

    #[test]
    fn compares_paths_without_trailing_slashes() {
        assert!(same_path("/trees/feature/", "/trees/feature"));
        assert!(!same_path("/trees/feature", "/trees/other"));
    }
}
