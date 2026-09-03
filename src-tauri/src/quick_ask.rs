use tauri::{AppHandle, Emitter, EventTarget, Manager};

/// Frontend event: bring Work forward with an empty chat ready to type in.
pub const QUICK_ASK: &str = "quick_ask";

/// The one global shortcut wavex claims.
///
/// Deliberately not `Alt+Space`: Windows gives that to the window system menu
/// and several Linux desktops bind it too, so registration there would either
/// fail or steal a key the desktop already owns.
const SHORTCUT: &str = "CmdOrCtrl+Shift+Space";

/// Registration is best effort. Another app may already hold the combination,
/// and a desktop session with no global-shortcut support (a bare Wayland
/// compositor) has none to give — neither is a reason to fail startup.
pub fn install(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    let Ok(shortcut) = SHORTCUT.parse::<Shortcut>() else {
        return;
    };
    let handle = app.clone();
    let _ = app
        .global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let _ = open(&handle);
        });
}

/// One window answers, never all of them: a quick ask is a single chat, and
/// every open window would otherwise create its own.
fn open(app: &AppHandle) -> Result<(), String> {
    let mut windows: Vec<(String, tauri::WebviewWindow)> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| crate::window::is_app_window(label))
        .collect();
    windows.sort_by(|a, b| a.0.cmp(&b.0));

    let target = windows
        .iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .or_else(|| windows.first());

    let Some((label, window)) = target else {
        // Nothing to ask in yet. Opening the app is the whole answer here; the
        // window boots after this event would have been delivered.
        return crate::window::show_hidden_or_open_new(app);
    };

    crate::window::show_app_window(window)?;
    app.emit_to(EventTarget::webview_window(label), QUICK_ASK, ())
        .map_err(|error| error.to_string())
}
