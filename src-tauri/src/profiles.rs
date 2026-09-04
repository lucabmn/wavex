use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::checkpoint::CheckpointStore;
use crate::session_store::{validate_id, SessionStore};

/// The profile every install starts on. It keeps the top-level app data
/// directory and the unprefixed browser keys, so upgrading from a build
/// without profiles is a no-op rather than a migration.
pub const DEFAULT_PROFILE_ID: &str = "default";

const PROFILES_DIR: &str = "profiles";
const ACTIVE_FILE: &str = "active-profile";
const MAX_ID_LEN: usize = 64;

/// Sent to every window before the store swaps. A window answers with
/// `profile_switch_ready` once its workspace is safely on disk.
pub const PREPARE_EVENT: &str = "wavex://profile-switch-prepare";
/// Sent once the swap is done. Windows reload onto the new profile.
pub const CHANGED_EVENT: &str = "wavex://profile-changed";

/// A window that never answers must not strand the switch. Its workspace is
/// already persisted on a short debounce, so the worst case is a lost second.
const PREPARE_TIMEOUT: Duration = Duration::from_millis(2_000);
const PREPARE_POLL: Duration = Duration::from_millis(25);

/// Where the active profile keeps its own copy of wavex's state.
pub struct ProfilePaths {
    app_data: PathBuf,
    active: Mutex<String>,
}

impl ProfilePaths {
    /// A poisoned lock still holds the profile the stores are open on. Naming
    /// the default one instead would file a running workspace under a profile
    /// whose database is not the one being written.
    pub fn active(&self) -> String {
        self.active
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .clone()
    }

    /// Data directory of the active profile, created if it is missing.
    pub fn data_dir(&self) -> Result<PathBuf, String> {
        let dir = profile_data_dir(&self.app_data, &self.active());
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir)
    }
}

/// Window labels that have persisted their workspace for the pending switch.
#[derive(Default)]
pub struct ProfileSwitch {
    ready: Mutex<HashSet<String>>,
}

/// Every profile but the default gets a subdirectory of its own. The default
/// profile stays at the top level so an existing install finds its sessions,
/// checkpoints, and logos exactly where it left them.
pub fn profile_data_dir(app_data: &Path, profile_id: &str) -> PathBuf {
    if profile_id == DEFAULT_PROFILE_ID {
        app_data.to_path_buf()
    } else {
        app_data.join(PROFILES_DIR).join(profile_id)
    }
}

pub fn validate_profile_id(profile_id: &str) -> Result<(), String> {
    if profile_id.len() > MAX_ID_LEN {
        return Err("Invalid profile id".into());
    }
    validate_id(profile_id, "profile")
}

/// Reads the profile the app was last on. Anything unreadable or malformed
/// falls back to the default profile rather than stranding the user's data.
fn read_active(app_data: &Path) -> String {
    let raw = match std::fs::read_to_string(app_data.join(ACTIVE_FILE)) {
        Ok(raw) => raw,
        Err(_) => return DEFAULT_PROFILE_ID.into(),
    };
    let id = raw.trim();
    if validate_profile_id(id).is_ok() {
        id.to_string()
    } else {
        DEFAULT_PROFILE_ID.into()
    }
}

fn write_active(app_data: &Path, profile_id: &str) -> Result<(), String> {
    std::fs::create_dir_all(app_data).map_err(|e| e.to_string())?;
    std::fs::write(app_data.join(ACTIVE_FILE), profile_id).map_err(|e| e.to_string())
}

/// Must run before the stores that live inside a profile directory.
pub fn init(app: &AppHandle) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let active = read_active(&app_data);
    let paths = ProfilePaths {
        app_data,
        active: Mutex::new(active),
    };
    paths.data_dir()?;
    app.manage(paths);
    app.manage(ProfileSwitch::default());
    Ok(())
}

/// Points every profile-scoped store at `profile_id`. Cheap and idempotent, so
/// the frontend can call it on boot to reconcile with its own stored choice.
fn bind(app: &AppHandle, profile_id: &str) -> Result<(), String> {
    let paths = app.state::<ProfilePaths>();
    if paths.active() == profile_id {
        return Ok(());
    }
    let dir = profile_data_dir(&paths.app_data, profile_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.state::<SessionStore>().reopen(dir.join("wavex.db"))?;
    app.state::<CheckpointStore>()
        .set_root(dir.join("checkpoints"));
    // The live id follows the stores in the same breath. The change event
    // carries it, so a gap here would leave a webview holding one profile's
    // browser keys against another profile's database.
    *paths.active.lock().unwrap_or_else(|err| err.into_inner()) = profile_id.to_string();
    // Only the next launch reads the file. Losing that write costs a fallback
    // to the default profile, which the frontend repairs with `profile_bind`.
    let _ = write_active(&paths.app_data, profile_id);
    Ok(())
}

#[tauri::command]
pub fn profile_bind(app: AppHandle, profile_id: String) -> Result<(), String> {
    validate_profile_id(&profile_id)?;
    bind(&app, &profile_id)
}

#[tauri::command]
pub fn profile_switch_ready(window: WebviewWindow, state: State<'_, ProfileSwitch>) {
    if let Ok(mut ready) = state.ready.lock() {
        ready.insert(window.label().to_string());
    }
}

/// Swaps the whole app onto another profile.
///
/// Windows persist first, then every agent process, terminal, and language
/// server of the profile being left is stopped. Their chats are already marked interrupted, so
/// switching back offers Continue exactly as relaunching wavex does. Leaving
/// them running would strand processes editing a checkout with no UI to stop
/// them.
#[tauri::command]
pub async fn profile_switch(app: AppHandle, profile_id: String) -> Result<(), String> {
    validate_profile_id(&profile_id)?;
    if app.state::<ProfilePaths>().active() == profile_id {
        return Ok(());
    }
    let handle = app.clone();
    let target = profile_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        await_windows_persisted(&handle, &target);
        let _ = crate::harness::harness_kill_all(handle.state());
        let _ = crate::pty::pty_kill_all(handle.state());
        // Language servers are long-lived children of the profile being left.
        // Left running they would index another profile's checkouts with no UI
        // able to stop them.
        let _ = crate::lsp::lsp_stop_all(handle.state());
        // Windows reload on this event whether or not the swap landed. A failed
        // bind with no event would leave them alive with their agents stopped
        // and no way back short of relaunching.
        let bound = bind(&handle, &target);
        let _ = handle.emit(CHANGED_EVENT, handle.state::<ProfilePaths>().active());
        bound
    })
    .await
    .map_err(|e| e.to_string())?
}

fn await_windows_persisted(app: &AppHandle, profile_id: &str) {
    let labels: HashSet<String> = app
        .webview_windows()
        .values()
        .map(|window| window.label().to_string())
        .filter(|label| crate::window::is_app_window(label))
        .collect();
    let state = app.state::<ProfileSwitch>();
    if let Ok(mut ready) = state.ready.lock() {
        ready.clear();
    }
    let _ = app.emit(PREPARE_EVENT, profile_id);
    let deadline = Instant::now() + PREPARE_TIMEOUT;
    while Instant::now() < deadline {
        let done = state
            .ready
            .lock()
            .map(|ready| labels.iter().all(|label| ready.contains(label)))
            .unwrap_or(true);
        if done {
            return;
        }
        std::thread::sleep(PREPARE_POLL);
    }
}

/// Drops a profile's own directory. Only wavex's copy of its state goes: git
/// checkouts and worktrees live outside the app data directory and are never
/// touched here.
#[tauri::command]
pub fn profile_delete_data(
    paths: State<'_, ProfilePaths>,
    profile_id: String,
) -> Result<(), String> {
    validate_profile_id(&profile_id)?;
    if profile_id == DEFAULT_PROFILE_ID {
        return Err("The default profile cannot be deleted".into());
    }
    if paths.active() == profile_id {
        return Err("Switch to another profile before deleting this one".into());
    }
    // Built from the profiles directory rather than `profile_data_dir`, which
    // resolves to the whole app data directory for the default profile. This is
    // a recursive delete: it must not be able to name that path at all.
    let dir = paths.app_data.join(PROFILES_DIR).join(&profile_id);
    if !dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_profile_keeps_the_top_level_directory() {
        let root = Path::new("/data/wavex");
        assert_eq!(profile_data_dir(root, DEFAULT_PROFILE_ID), root);
    }

    #[test]
    fn other_profiles_get_their_own_directory() {
        let root = Path::new("/data/wavex");
        assert_eq!(
            profile_data_dir(root, "work"),
            root.join("profiles").join("work")
        );
    }

    #[test]
    fn profile_ids_stay_inside_the_profiles_directory() {
        assert!(validate_profile_id("..").is_err());
        assert!(validate_profile_id("a/b").is_err());
        assert!(validate_profile_id("").is_err());
        assert!(validate_profile_id(&"a".repeat(MAX_ID_LEN + 1)).is_err());
        assert!(validate_profile_id("p-1_A").is_ok());
    }

    #[test]
    fn unreadable_active_file_falls_back_to_default() {
        let dir = std::env::temp_dir().join(format!("wavex-profiles-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(read_active(&dir), DEFAULT_PROFILE_ID);
        std::fs::write(dir.join(ACTIVE_FILE), "../escape").unwrap();
        assert_eq!(read_active(&dir), DEFAULT_PROFILE_ID);
        std::fs::write(dir.join(ACTIVE_FILE), " work \n").unwrap();
        assert_eq!(read_active(&dir), "work");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
