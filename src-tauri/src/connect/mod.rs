//! wavex Link on the host side.
//!
//! What a connected client is granted is exactly what wavex itself does on
//! this machine: it reads and writes the checkout, runs the agent CLIs, and
//! opens terminals, as the user running wavex. That is why the host binds
//! loopback, refuses every unauthenticated connection including the first,
//! and drops live sockets the moment its token is replaced.

mod dispatch;
mod frame;
mod http;
#[cfg(test)]
mod protocol_tests;
mod secret;
mod server;
mod store;

use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::host_events::HostEventJournal;
use crate::profiles::ProfilePaths;
pub(crate) use secret::sanitize_name;
use secret::{encode_pairing, PairingPayload};
pub use server::ConnectHost;
use server::{HostAsset, HostServices};
use store::{SavedHost, SavedHostSummary};

/// The live machine behind a connection: this app's event journal and this
/// app's allowlisted command surface.
struct AppServices {
    app: AppHandle,
}

impl HostServices for AppServices {
    fn journal(&self) -> &HostEventJournal {
        self.app.state::<HostEventJournal>().inner()
    }

    fn dispatch(&self, command: &str, args: Value) -> Result<Value, String> {
        dispatch::dispatch(&self.app, command, args)
    }

    fn asset(&self, path: &str) -> Option<HostAsset> {
        let asset = self.app.asset_resolver().get(path.to_string())?;
        let html = asset.mime_type.starts_with("text/html");
        Some(HostAsset {
            bytes: asset.bytes,
            mime_type: asset.mime_type,
            // The policy in `tauri.conf.json` describes the WebView's origin
            // and its custom schemes, which mean nothing over HTTP. A browser
            // gets one written for where it actually is: this host, same
            // origin, and no third party in the page.
            csp: html.then(|| BROWSER_CSP.to_string()),
        })
    }
}

/// Deliberately narrower than the WebView's: a page served over loopback has
/// no `ipc:` or `asset:` scheme to allow, and the only socket it opens is the
/// one back to the host that served it.
const BROWSER_CSP: &str = "default-src 'self';      script-src 'self';      style-src 'self' 'unsafe-inline';      img-src 'self' data: blob: https://avatars.githubusercontent.com https://lh3.googleusercontent.com;      font-src 'self' data:;      connect-src 'self' ws://127.0.0.1:* ws://localhost:*;      media-src 'self' blob:;      object-src 'none';      base-uri 'self';      frame-ancestors 'none';      frame-src 'none'";

/// What the settings surface renders. The token is deliberately absent: it is
/// shown once, on request, as a pairing code the user copies.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStatus {
    pub host_id: String,
    pub name: String,
    pub platform: &'static str,
    pub running: bool,
    pub port: Option<u16>,
    pub clients: usize,
}

/// A connection this client saved, with the token it needs to open it. The
/// token stays in Rust until a connection is actually being made.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    pub host_id: String,
    pub name: String,
    pub endpoint: String,
    pub token: String,
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let app_data = app.state::<ProfilePaths>().app_data().to_path_buf();
    let identity = store::read_host_identity(&app_data);
    let enabled = identity.enabled;
    let port = identity.port;
    app.manage(ConnectHost::new(identity));
    if enabled {
        // A host that was serving before the app closed keeps serving. A port
        // that is now taken is reported at the surface, not thrown here: the
        // app must still open.
        let _ = start(app, Some(port));
    }
    Ok(())
}

fn start(app: &AppHandle, port: Option<u16>) -> Result<u16, String> {
    let host = app.state::<ConnectHost>();
    let services = Arc::new(AppServices { app: app.clone() });
    let bound = host.start(services, port.unwrap_or(0))?;
    let mut identity = host.identity();
    identity.port = bound;
    identity.enabled = true;
    host.set_identity(identity.clone());
    store::write_host_identity(app.state::<ProfilePaths>().app_data(), &identity)?;
    Ok(bound)
}

fn status(host: &ConnectHost) -> HostStatus {
    let identity = host.identity();
    let port = host.port();
    HostStatus {
        host_id: identity.host_id,
        name: identity.name,
        platform: server::host_platform(),
        running: port.is_some(),
        port,
        clients: host.connection_count(),
    }
}

#[tauri::command]
pub fn connect_host_status(host: State<'_, ConnectHost>) -> HostStatus {
    status(&host)
}

#[tauri::command]
pub fn connect_host_start(app: AppHandle, port: Option<u16>) -> Result<HostStatus, String> {
    start(&app, port)?;
    Ok(status(&app.state::<ConnectHost>()))
}

#[tauri::command]
pub fn connect_host_stop(app: AppHandle) -> Result<HostStatus, String> {
    let host = app.state::<ConnectHost>();
    host.stop();
    let mut identity = host.identity();
    identity.enabled = false;
    host.set_identity(identity.clone());
    store::write_host_identity(app.state::<ProfilePaths>().app_data(), &identity)?;
    Ok(status(&host))
}

#[tauri::command]
pub fn connect_host_set_name(app: AppHandle, name: String) -> Result<HostStatus, String> {
    set_host_name(&app, &name)?;
    Ok(status(&app.state::<ConnectHost>()))
}

/// Renaming the stored identity, for the command above and for a host that
/// never had a window to rename it from. `WAVEX_HOST_NAME` only names an
/// identity as it is created; afterwards the saved one wins, so a headless
/// host has no other way to be called something.
pub fn set_host_name(app: &AppHandle, name: &str) -> Result<(), String> {
    let cleaned = sanitize_name(name);
    if cleaned.is_empty() {
        return Err("Give this host a name".into());
    }
    let host = app.state::<ConnectHost>();
    let mut identity = host.identity();
    identity.name = cleaned;
    host.set_identity(identity.clone());
    store::write_host_identity(app.state::<ProfilePaths>().app_data(), &identity)
}

/// The one place the host token is handed out, as the code the user pastes
/// into the other client. The surface that shows it says what it grants.
#[tauri::command]
pub fn connect_host_pairing_code(host: State<'_, ConnectHost>) -> Result<String, String> {
    encode_host_pairing(&host)
}

/// Serving is the whole reason a headless host is running, so it starts
/// listening before anything asks it to, on the port the operator named.
pub fn start_for_headless(app: &AppHandle, port: Option<u16>) -> Result<HostStatus, String> {
    start(app, port)?;
    Ok(status(&app.state::<ConnectHost>()))
}

/// The same code the settings surface shows. Who is allowed to see it is the
/// caller's decision: a window shows it to the person sitting at it, and a
/// headless host refuses unless stdout is a terminal.
pub fn pairing_code(app: &AppHandle) -> Result<String, String> {
    encode_host_pairing(&app.state::<ConnectHost>())
}

fn encode_host_pairing(host: &ConnectHost) -> Result<String, String> {
    let identity = host.identity();
    let port = host
        .port()
        .ok_or("Start this host before sharing a connection code")?;
    encode_pairing(&PairingPayload {
        version: 1,
        host_id: identity.host_id,
        name: identity.name,
        endpoint: format!("ws://127.0.0.1:{port}/api/v1/connect"),
        token: identity.token,
    })
}

/// Replacing the token revokes every code already handed out, so the live
/// sockets that were opened with the old one go with it.
#[tauri::command]
pub fn connect_host_rotate_token(app: AppHandle) -> Result<HostStatus, String> {
    let host = app.state::<ConnectHost>();
    let mut identity = host.identity();
    identity.token = secret::random_token(32);
    host.set_identity(identity.clone());
    store::write_host_identity(app.state::<ProfilePaths>().app_data(), &identity)?;
    host.refuse_live_connections();
    Ok(status(&host))
}

#[tauri::command]
pub fn connect_client_list(app: AppHandle) -> Result<Vec<SavedHostSummary>, String> {
    let dir = app.state::<ProfilePaths>().data_dir()?;
    Ok(store::read_saved_hosts(&dir)
        .iter()
        .map(SavedHostSummary::from)
        .collect())
}

#[tauri::command]
pub fn connect_client_add(app: AppHandle, code: String) -> Result<SavedHostSummary, String> {
    let payload = secret::decode_pairing(&code)?;
    let dir = app.state::<ProfilePaths>().data_dir()?;
    let host = app.state::<ConnectHost>();
    if payload.host_id == host.identity().host_id {
        return Err("That connection code belongs to this device".into());
    }

    let saved = SavedHost {
        host_id: payload.host_id,
        name: sanitize_name(&payload.name),
        endpoint: payload.endpoint,
        token: payload.token,
    };
    let mut hosts = store::read_saved_hosts(&dir);
    hosts.retain(|existing| existing.host_id != saved.host_id);
    hosts.push(saved.clone());
    store::write_saved_hosts(&dir, &hosts)?;
    Ok(SavedHostSummary::from(&saved))
}

#[tauri::command]
pub fn connect_client_remove(app: AppHandle, host_id: String) -> Result<(), String> {
    let dir = app.state::<ProfilePaths>().data_dir()?;
    let mut hosts = store::read_saved_hosts(&dir);
    hosts.retain(|existing| existing.host_id != host_id);
    store::write_saved_hosts(&dir, &hosts)
}

/// Read at the moment a connection opens rather than held in the WebView, so
/// a token is in the client's memory only while it is being used.
#[tauri::command]
pub fn connect_client_connection(
    app: AppHandle,
    host_id: String,
) -> Result<SavedConnection, String> {
    let dir = app.state::<ProfilePaths>().data_dir()?;
    store::read_saved_hosts(&dir)
        .into_iter()
        .find(|host| host.host_id == host_id)
        .map(|host| SavedConnection {
            host_id: host.host_id,
            name: host.name,
            endpoint: host.endpoint,
            token: host.token,
        })
        .ok_or_else(|| "That host is not paired with this profile".into())
}
