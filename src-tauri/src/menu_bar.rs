use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewWindow};

pub const WINDOW_LABEL: &str = "menu-bar";
const TRAY_ID: &str = "wavex-menu-bar";
const AGENTS_CHANGED: &str = "menu_bar_agents_changed";
const FOCUS_SESSION: &str = "focus_session_from_menu_bar";
const ANSWER_APPROVAL: &str = "answer_approval_from_menu_bar";
/// A summary long enough to decide on, short enough that a runaway renderer
/// cannot grow the native cache without bound.
const MAX_APPROVAL_LABEL: usize = 400;
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

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalDecision {
    Allow,
    Deny,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuBarApproval {
    request_id: i64,
    kind: String,
    label: String,
    answerable: bool,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    approvals: Vec<MenuBarApproval>,
    done: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalAnswer {
    session_id: String,
    request_id: i64,
    decision: ApprovalDecision,
}

/// Trim on a character boundary so a multi-byte summary cannot panic the host.
fn clamp_label(label: &str) -> String {
    if label.len() <= MAX_APPROVAL_LABEL {
        return label.to_string();
    }
    let end = (0..=MAX_APPROVAL_LABEL)
        .rev()
        .find(|index| label.is_char_boundary(*index))
        .unwrap_or(0);
    format!("{}…", &label[..end])
}

type AgentSources = HashMap<String, Vec<MenuBarAgent>>;

fn sources() -> &'static Mutex<AgentSources> {
    static SOURCES: OnceLock<Mutex<AgentSources>> = OnceLock::new();
    SOURCES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn aggregate_agents(sources: &AgentSources) -> Vec<MenuBarAgent> {
    let mut by_id = HashMap::<String, MenuBarAgent>::new();
    for agents in sources.values() {
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

#[tauri::command]
pub fn menu_bar_update_agents(window: WebviewWindow, mut agents: Vec<MenuBarAgent>) {
    if !crate::window::is_app_window(window.label()) {
        return;
    }
    // A corrupt renderer must not turn a tiny status surface into an unbounded
    // native cache. Real app windows never approach this limit.
    agents.truncate(100);
    for agent in &mut agents {
        agent.approvals.truncate(20);
        for approval in &mut agent.approvals {
            approval.label = clamp_label(&approval.label);
        }
    }
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
        let waiting: usize = agents.iter().map(|agent| agent.approvals.len()).sum();
        // tray-icon's macOS `None` path does not clear a previous title, but
        // assigning an empty title does.
        let (title, tooltip) = tray_status(waiting, working);
        let _ = tray.set_title(Some(title));
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

/// A blocked turn outranks a busy one: it is the only state the user can clear.
/// "Requests", not "approvals": a clarifying question parks a turn just as hard.
fn tray_status(waiting: usize, working: usize) -> (String, String) {
    if waiting > 0 {
        let title = format!("!{}", waiting.min(99));
        let tooltip = if waiting == 1 {
            "wavex — 1 request waiting for you".to_string()
        } else {
            format!("wavex — {waiting} requests waiting for you")
        };
        return (title, tooltip);
    }
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
    (title, tooltip)
}

#[tauri::command]
pub fn menu_bar_open_app(app: AppHandle) -> Result<(), String> {
    hide(&app);
    crate::window::show_hidden_or_open_new(&app)
}

fn owner_of(session_id: &str) -> Option<String> {
    let guard = sources().lock().unwrap_or_else(|error| error.into_inner());
    guard.iter().find_map(|(label, agents)| {
        agents
            .iter()
            .any(|agent| agent.id == session_id)
            .then(|| label.clone())
    })
}

/// Answer without showing any window. The decision goes to the one window that
/// holds the session, never to every window: two of them mid-transfer would
/// otherwise both answer the same request.
#[tauri::command]
pub fn menu_bar_answer_approval(
    app: AppHandle,
    session_id: String,
    request_id: i64,
    decision: ApprovalDecision,
) -> Result<(), String> {
    let label = owner_of(&session_id).ok_or("no window owns this session")?;
    if app.get_webview_window(&label).is_none() {
        return Err("the window that owns this session is gone".into());
    }
    app.emit_to(
        EventTarget::webview_window(&label),
        ANSWER_APPROVAL,
        ApprovalAnswer {
            session_id,
            request_id,
            decision,
        },
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn menu_bar_focus_agent(app: AppHandle, session_id: String) -> Result<(), String> {
    let owner = owner_of(&session_id);

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
            approvals: if needs_approval {
                vec![MenuBarApproval {
                    request_id: 1,
                    kind: "approval".into(),
                    label: "Edit src/main.rs".into(),
                    answerable: true,
                }]
            } else {
                Vec::new()
            },
            done: false,
        }
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

    #[test]
    fn a_waiting_approval_outranks_working_agents_in_the_status_item() {
        assert_eq!(
            tray_status(2, 5),
            ("!2".into(), "wavex — 2 requests waiting for you".into())
        );
        assert_eq!(
            tray_status(0, 1),
            ("1".into(), "wavex — 1 agent working".into())
        );
        assert_eq!(
            tray_status(0, 0),
            (String::new(), "wavex — no agents working".into())
        );
    }

    #[test]
    fn clamps_a_long_summary_without_splitting_a_character() {
        let label = "é".repeat(MAX_APPROVAL_LABEL);
        let clamped = clamp_label(&label);
        assert!(clamped.len() <= MAX_APPROVAL_LABEL + "…".len());
        assert!(clamped.ends_with('…'));
        assert_eq!(clamp_label("short"), "short");
    }
}
