//! Where the two secrets live.
//!
//! A host token grants filesystem access, process execution, and Git write
//! access as the user running wavex. Neither end of it belongs in browser
//! storage, so both the token a host serves and the tokens a client saved for
//! other hosts are written by Rust, owner-readable only.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::connect::secret::{random_token, sanitize_name};

const HOST_FILE: &str = "connect-host.json";
const CLIENT_FILE: &str = "connect-hosts.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostIdentity {
    pub host_id: String,
    pub name: String,
    pub token: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub enabled: bool,
}

/// A host this client has paired with. The token is the whole grant, so the
/// list never leaves Rust except as the redacted form the UI renders.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedHost {
    pub host_id: String,
    pub name: String,
    pub endpoint: String,
    pub token: String,
}

/// What the UI is allowed to see about a saved host.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedHostSummary {
    pub host_id: String,
    pub name: String,
    pub endpoint: String,
}

impl From<&SavedHost> for SavedHostSummary {
    fn from(host: &SavedHost) -> Self {
        Self {
            host_id: host.host_id.clone(),
            name: host.name.clone(),
            endpoint: host.endpoint.clone(),
        }
    }
}

pub fn read_host_identity(app_data: &Path) -> HostIdentity {
    let path = app_data.join(HOST_FILE);
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(identity) = serde_json::from_str::<HostIdentity>(&raw) {
            if !identity.host_id.is_empty() && !identity.token.is_empty() {
                return identity;
            }
        }
    }
    HostIdentity {
        host_id: format!("host-{}", random_token(9)),
        name: default_host_name(),
        token: random_token(32),
        port: 0,
        enabled: false,
    }
}

pub fn write_host_identity(app_data: &Path, identity: &HostIdentity) -> Result<(), String> {
    write_private(&app_data.join(HOST_FILE), identity)
}

pub fn read_saved_hosts(profile_dir: &Path) -> Vec<SavedHost> {
    std::fs::read_to_string(profile_dir.join(CLIENT_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<SavedHost>>(&raw).ok())
        .unwrap_or_default()
}

pub fn write_saved_hosts(profile_dir: &Path, hosts: &[SavedHost]) -> Result<(), String> {
    write_private(&profile_dir.join(CLIENT_FILE), hosts)
}

/// Writes through a temporary file in the same directory and renames it into
/// place. A host that dies mid-write would otherwise leave a truncated
/// identity behind, and an identity without a token is read as no identity at
/// all — the host mints a new one and every client that paired with it is
/// locked out with no way to tell why.
fn write_private<T: Serialize + ?Sized>(path: &PathBuf, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let body = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    let staged = path.with_extension("tmp");
    std::fs::write(&staged, body).map_err(|error| error.to_string())?;
    restrict(&staged);
    std::fs::rename(&staged, path).map_err(|error| {
        let _ = std::fs::remove_file(&staged);
        error.to_string()
    })?;
    restrict(path);
    Ok(())
}

/// Windows has no mode bits; the per-user profile directory is the boundary
/// there, which is also where wavex keeps the session database.
#[cfg(unix)]
fn restrict(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict(_path: &Path) {}

fn default_host_name() -> String {
    let raw = std::env::var("WAVEX_HOST_NAME")
        .ok()
        .or_else(hostname)
        .unwrap_or_default();
    let name = sanitize_name(&raw);
    if name.is_empty() {
        "wavex host".into()
    } else {
        name
    }
}

#[cfg(unix)]
fn hostname() -> Option<String> {
    let mut buffer = [0i8; 256];
    // SAFETY: the buffer outlives the call and the length matches it.
    let ok = unsafe { libc::gethostname(buffer.as_mut_ptr(), buffer.len() - 1) } == 0;
    if !ok {
        return std::env::var("HOSTNAME").ok();
    }
    let bytes: Vec<u8> = buffer
        .iter()
        .take_while(|byte| **byte != 0)
        .map(|byte| *byte as u8)
        .collect();
    String::from_utf8(bytes)
        .ok()
        .map(|value| value.trim_end_matches(".local").to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(not(unix))]
fn hostname() -> Option<String> {
    std::env::var("COMPUTERNAME").ok()
}
