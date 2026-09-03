use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub const WINDOW_LABEL: &str = "menu-bar";
const TRAY_ID: &str = "wavex-menu-bar";
const AGENTS_CHANGED: &str = "menu_bar_agents_changed";
const FOCUS_SESSION: &str = "focus_session_from_menu_bar";
/// Asks the app to switch profiles, rather than switching under it: the app
/// owns the confirmation about agents running in the profile being left.
const SWITCH_PROFILE: &str = "switch_profile_from_menu_bar";
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const POPOVER_WIDTH: f64 = 380.0;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const POPOVER_HEIGHT: f64 = 500.0;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const SCREEN_MARGIN: f64 = 8.0;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const ANCHOR_GAP: f64 = 4.0;
/// Must match the popover card's `rounded-[14px]`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const POPOVER_RADIUS: f64 = 14.0;

#[derive(Clone, Copy, Debug)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
struct MonitorGeometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale: f64,
}

#[derive(Clone, Copy, Debug)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
struct PhysicalGeometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn monitor_containing(monitors: &[MonitorGeometry], point: (f64, f64)) -> Option<MonitorGeometry> {
    monitors.iter().copied().find(|monitor| {
        point.0 >= monitor.x
            && point.0 < monitor.x + monitor.width
            && point.1 >= monitor.y
            && point.1 < monitor.y + monitor.height
    })
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn popup_position_for(
    monitors: &[MonitorGeometry],
    anchor: PhysicalGeometry,
    click: (f64, f64),
) -> Option<(f64, f64)> {
    let monitor = monitor_containing(monitors, click)?;
    let scale = monitor.scale.max(1.0);
    let monitor_x = monitor.x / scale;
    let monitor_y = monitor.y / scale;
    let monitor_width = monitor.width / scale;
    let monitor_height = monitor.height / scale;
    let anchor_x = anchor.x / scale;
    let anchor_y = anchor.y / scale;
    let anchor_width = anchor.width / scale;
    let anchor_height = anchor.height / scale;
    let min_x = monitor_x + SCREEN_MARGIN;
    let max_x = monitor_x + monitor_width - POPOVER_WIDTH - SCREEN_MARGIN;
    let min_y = monitor_y + SCREEN_MARGIN;
    let max_y = monitor_y + monitor_height - POPOVER_HEIGHT - SCREEN_MARGIN;
    let x = (anchor_x + anchor_width / 2.0 - POPOVER_WIDTH / 2.0).clamp(min_x, max_x);
    let y = (anchor_y + anchor_height + ANCHOR_GAP).clamp(min_y, max_y);
    Some((x, y))
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuBarAgent {
    id: String,
    cwd: String,
    title: String,
    harness: String,
    activity: String,
    started_at: Option<u64>,
    duration_ms: Option<u64>,
    needs_approval: bool,
    done: bool,
    /// Set only on an agent left running under a profile that is not the one
    /// on screen. The popover shows the profile, and clicking the row has to
    /// switch back rather than look the session up in the current profile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    profile_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    profile_name: Option<String>,
}

/// The key detached rows are filed under. Every other source is a window
/// label, and every window of the profile being left reloads and wipes its own
/// rows, so agents that outlive a switch need an owner that is not a window.
/// Windows are labelled `main` or `window-N`, so this key cannot collide.
const DETACHED_KEY: &str = "profile-detached";

type AgentSources = HashMap<String, Vec<MenuBarAgent>>;

fn sources() -> &'static Mutex<AgentSources> {
    static SOURCES: OnceLock<Mutex<AgentSources>> = OnceLock::new();
    SOURCES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn aggregate_agents(sources: &AgentSources) -> Vec<MenuBarAgent> {
    let mut by_id = HashMap::<String, MenuBarAgent>::new();
    // Detached rows go in first so a window that has already republished the
    // same session wins. Both exist for the moment between a switch back and
    // the returning window's first publish.
    if let Some(agents) = sources.get(DETACHED_KEY) {
        for agent in agents {
            by_id.insert(agent.id.clone(), agent.clone());
        }
    }
    for (label, agents) in sources {
        if label == DETACHED_KEY {
            continue;
        }
        for agent in agents {
            by_id.insert(agent.id.clone(), agent.clone());
        }
    }
    let mut agents: Vec<MenuBarAgent> = by_id.into_values().collect();
    agents.sort_by(|a, b| {
        b.needs_approval
            .cmp(&a.needs_approval)
            .then_with(|| a.done.cmp(&b.done))
            .then_with(|| {
                a.started_at
                    .unwrap_or(u64::MAX)
                    .cmp(&b.started_at.unwrap_or(u64::MAX))
            })
            .then_with(|| a.id.cmp(&b.id))
    });
    agents
}

fn current_agents() -> Vec<MenuBarAgent> {
    let guard = sources().lock().unwrap_or_else(|error| error.into_inner());
    aggregate_agents(&guard)
}

#[tauri::command]
pub fn menu_bar_agents() -> Vec<MenuBarAgent> {
    current_agents()
}

/// Files the agents a profile switch is leaving behind. Every window of the
/// profile being left calls this with its own rows, so they merge rather than
/// replace: a second window must not wipe the first one's agents.
#[tauri::command]
pub fn menu_bar_detach_agents(window: WebviewWindow, agents: Vec<MenuBarAgent>) {
    if !crate::window::is_app_window(window.label()) || agents.is_empty() {
        return;
    }
    {
        let mut guard = sources().lock().unwrap_or_else(|error| error.into_inner());
        let rows = guard.entry(DETACHED_KEY.to_string()).or_default();
        for agent in agents {
            match rows.iter_mut().find(|row| row.id == agent.id) {
                Some(existing) => *existing = agent,
                None => rows.push(agent),
            }
        }
        rows.truncate(100);
    }
    publish(window.app_handle());
}

/// Drops the detached rows of one profile. Runs when that profile comes back
/// on screen, so its own windows own the rows again.
pub fn clear_detached_profile(app: &AppHandle, profile_id: &str) {
    if retain_detached(|agent| agent.profile_id.as_deref() != Some(profile_id)) {
        publish(app);
    }
}

/// The profile a detached row belongs to, if this session is one.
pub fn detached_profile_of(session_id: &str) -> Option<String> {
    let guard = sources().lock().unwrap_or_else(|error| error.into_inner());
    guard
        .get(DETACHED_KEY)?
        .iter()
        .find(|agent| agent.id == session_id)?
        .profile_id
        .clone()
}

/// A detached agent whose child exited stops being news. Without this its row
/// would sit in the popover claiming to work until the next profile switch.
pub fn remove_detached_agent(app: &AppHandle, session_id: &str) {
    if retain_detached(|agent| agent.id != session_id) {
        publish(app);
    }
}

/// Drops the detached rows that fail `keep`. Returns whether anything went, so
/// a miss costs no tray repaint.
fn retain_detached(keep: impl Fn(&MenuBarAgent) -> bool) -> bool {
    let mut guard = sources().lock().unwrap_or_else(|error| error.into_inner());
    let Some(rows) = guard.get_mut(DETACHED_KEY) else {
        return false;
    };
    let before = rows.len();
    rows.retain(keep);
    let removed = rows.len() < before;
    if rows.is_empty() {
        guard.remove(DETACHED_KEY);
    }
    removed
}

#[tauri::command]
pub fn menu_bar_update_agents(window: WebviewWindow, mut agents: Vec<MenuBarAgent>) {
    if !crate::window::is_app_window(window.label()) {
        return;
    }
    // A corrupt renderer must not turn a tiny status surface into an unbounded
    // native cache. Real app windows never approach this limit.
    agents.truncate(100);
    {
        let mut guard = sources().lock().unwrap_or_else(|error| error.into_inner());
        if agents.is_empty() {
            guard.remove(window.label());
        } else {
            guard.insert(window.label().to_string(), agents);
        }
    }
    publish(window.app_handle());
}

pub fn remove_source(app: &AppHandle, label: &str) {
    let removed = {
        let mut guard = sources().lock().unwrap_or_else(|error| error.into_inner());
        guard.remove(label).is_some()
    };
    if removed {
        publish(app);
    }
}

fn publish(app: &AppHandle) {
    let agents = current_agents();
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.emit(AGENTS_CHANGED, &agents);
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let working = agents.iter().filter(|agent| !agent.done).count();
        // tray-icon's macOS `None` path does not clear a previous title, but
        // assigning an empty title does.
        let title = if working > 0 {
            working.min(99).to_string()
        } else {
            String::new()
        };
        let tooltip = match working {
            0 => "wavex — no agents working".to_string(),
            1 => "wavex — 1 agent working".to_string(),
            count => format!("wavex — {count} agents working"),
        };
        let _ = tray.set_title(Some(title));
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

#[tauri::command]
pub fn menu_bar_open_app(app: AppHandle) -> Result<(), String> {
    hide(&app);
    crate::window::show_hidden_or_open_new(&app)
}

#[tauri::command]
pub fn menu_bar_focus_agent(app: AppHandle, session_id: String) -> Result<(), String> {
    // An agent left running under another profile has no window here to focus:
    // this profile's webviews have never heard of its session. Hand the app the
    // profile to go back to and let it run its own switch flow, so a switch
    // started from the menu bar still asks about the agents running here.
    if let Some(profile_id) = detached_profile_of(&session_id) {
        hide(&app);
        crate::window::show_hidden_or_open_new(&app)?;
        return app
            .emit(SWITCH_PROFILE, profile_id)
            .map_err(|error| error.to_string());
    }
    let owner = {
        let guard = sources().lock().unwrap_or_else(|error| error.into_inner());
        guard.iter().find_map(|(label, agents)| {
            agents
                .iter()
                .any(|agent| agent.id == session_id)
                .then(|| label.clone())
        })
    };

    hide(&app);
    let Some(label) = owner else {
        return crate::window::show_hidden_or_open_new(&app);
    };
    let Some(window) = app.get_webview_window(&label) else {
        remove_source(&app, &label);
        return crate::window::show_hidden_or_open_new(&app);
    };
    crate::window::show_app_window(&window)?;
    window
        .emit(FOCUS_SESSION, session_id)
        .map_err(|error| error.to_string())
}

fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.hide();
    }
}

#[cfg(target_os = "macos")]
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    use tauri::image::Image;
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let icon = Image::from_bytes(include_bytes!("../icons/menu-bar-template.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("wavex — no agents working")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            let TrayIconEvent::Click {
                rect,
                position,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            else {
                return;
            };
            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                if window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
                    return;
                }
                position_popup(app, &window, rect, position.x, position.y);
                let _ = window.show();
                let _ = window.set_focus();
                return;
            }
            let Ok(window) = create_popup(app) else {
                return;
            };
            position_popup(app, &window, rect, position.x, position.y);
            let _ = window.show();
            let _ = window.set_focus();
        })
        .build(app)?;

    publish(app);
    Ok(())
}

#[cfg(target_os = "macos")]
fn create_popup(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    use tauri::window::Color;
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let popup = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
        .title("wavex menu bar")
        .inner_size(POPOVER_WIDTH, POPOVER_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .decorations(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .shadow(true)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .accept_first_mouse(true)
        .focused(false)
        .visible(false)
        .build()?;

    crate::macos::enable_popover_glass(&popup, POPOVER_RADIUS);
    let blur_window = popup.clone();
    popup.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(true) = event {
            crate::macos::enable_popover_glass(&blur_window, POPOVER_RADIUS);
        }
    });
    Ok(popup)
}

#[cfg(target_os = "macos")]
fn position_popup(
    app: &AppHandle,
    window: &WebviewWindow,
    rect: tauri::Rect,
    click_x: f64,
    click_y: f64,
) {
    use tauri::{LogicalPosition, Position, Size};

    let monitors: Vec<MonitorGeometry> = app
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            MonitorGeometry {
                x: position.x as f64,
                y: position.y as f64,
                width: size.width as f64,
                height: size.height as f64,
                scale: monitor.scale_factor(),
            }
        })
        .collect();
    let Some(monitor) = monitor_containing(&monitors, (click_x, click_y)) else {
        return;
    };
    let scale = monitor.scale.max(1.0);
    let anchor_position = match rect.position {
        Position::Physical(position) => (position.x as f64, position.y as f64),
        Position::Logical(position) => (position.x * scale, position.y * scale),
    };
    let anchor_size = match rect.size {
        Size::Physical(size) => (size.width as f64, size.height as f64),
        Size::Logical(size) => (size.width * scale, size.height * scale),
    };
    let Some((x, y)) = popup_position_for(
        &[monitor],
        PhysicalGeometry {
            x: anchor_position.0,
            y: anchor_position.1,
            width: anchor_size.0,
            height: anchor_size.1,
        },
        (click_x, click_y),
    ) else {
        return;
    };
    // Logical coordinates avoid converting through the popup's old monitor
    // scale before the window has moved to the clicked display.
    let _ = window.set_position(LogicalPosition::new(x, y));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(id: &str, started_at: u64, needs_approval: bool) -> MenuBarAgent {
        MenuBarAgent {
            id: id.into(),
            cwd: "/tmp/project".into(),
            title: id.into(),
            harness: "claude".into(),
            activity: "Working".into(),
            started_at: Some(started_at),
            duration_ms: None,
            needs_approval,
            done: false,
            profile_id: None,
            profile_name: None,
        }
    }

    fn detached(id: &str, profile_id: &str) -> MenuBarAgent {
        MenuBarAgent {
            profile_id: Some(profile_id.into()),
            profile_name: Some("Work".into()),
            activity: "Running in Work".into(),
            ..agent(id, 1, false)
        }
    }

    #[test]
    fn a_window_row_wins_over_the_detached_copy_of_the_same_session() {
        let mut sources = AgentSources::new();
        sources.insert(DETACHED_KEY.into(), vec![detached("a", "work")]);
        sources.insert("main".into(), vec![agent("a", 1, false)]);
        let rows = aggregate_agents(&sources);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].profile_id, None);
    }

    #[test]
    fn detached_rows_survive_alongside_the_windows_own() {
        let mut sources = AgentSources::new();
        sources.insert(DETACHED_KEY.into(), vec![detached("a", "work")]);
        sources.insert("main".into(), vec![agent("b", 2, false)]);
        let rows = aggregate_agents(&sources);
        let ids: Vec<&str> = rows.iter().map(|row| row.id.as_str()).collect();
        assert_eq!(ids, ["a", "b"]);
    }

    #[test]
    fn positions_below_the_tray_icon_on_a_scaled_secondary_display() {
        let monitors = [
            MonitorGeometry {
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
                scale: 1.0,
            },
            // macOS/Tao scale the display origin as well as its size.
            MonitorGeometry {
                x: 3840.0,
                y: 0.0,
                width: 5120.0,
                height: 2880.0,
                scale: 2.0,
            },
        ];
        let position = popup_position_for(
            &monitors,
            PhysicalGeometry {
                x: 4400.0,
                y: 0.0,
                width: 44.0,
                height: 48.0,
            },
            (4422.0, 20.0),
        );
        assert_eq!(position, Some((2021.0, 28.0)));
    }

    #[test]
    fn aggregates_windows_deduplicates_and_prioritizes_attention() {
        let mut sources = AgentSources::new();
        sources.insert(
            "main".into(),
            vec![agent("older", 1, false), agent("attention", 9, true)],
        );
        sources.insert(
            "window-2".into(),
            vec![agent("newer", 5, false), agent("older", 1, false)],
        );
        let ids: Vec<String> = aggregate_agents(&sources)
            .into_iter()
            .map(|agent| agent.id)
            .collect();
        assert_eq!(ids, ["attention", "older", "newer"]);
    }
}
