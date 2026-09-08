//! A real browser view for pages that will not be framed.
//!
//! Most addresses the panel is pointed at render in an ordinary `<iframe>`,
//! which is what keeps every popover, menu, and dialog the app draws above the
//! page. A site sending `X-Frame-Options` or `frame-ancestors` refuses that
//! outright, and no frame anywhere will ever show it — so those, and only
//! those, get a child webview instead: a top-level browsing context with no
//! framing ancestor for the header to object to.
//!
//! The cost is paid where it is unavoidable. A child webview is an
//! operating-system view composited over the whole window, so nothing the
//! document draws can appear above it; the panel hides it while a menu or a
//! dialog is open, and whenever the browser is not the surface on screen.
//!
//! The page is a stranger. It reaches no command: capabilities carry no
//! `remote` entry, and Tauri denies a remote origin every command that has not
//! named it, so this webview's `invoke` bridge resolves to nothing at all.
//!
//! Absent from `connect/dispatch.rs` on purpose — a webview belongs to the
//! machine drawing it, like every other window command.
use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::webview::WebviewBuilder;
use tauri::{LogicalPosition, LogicalSize, Manager, State, WebviewUrl, Window};

/// The address each window's browser view is currently on, so an unchanged one
/// is not navigated again — a re-navigation would throw the page away and
/// reload it on every resize.
#[derive(Default)]
pub struct FrameViewHost(Mutex<HashMap<String, String>>);

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl FrameBounds {
    fn position(&self) -> LogicalPosition<f64> {
        LogicalPosition::new(self.x, self.y)
    }

    /// A webview of no size is not a legal one, and a panel mid-collapse asks
    /// for exactly that.
    fn size(&self) -> LogicalSize<f64> {
        LogicalSize::new(self.width.max(1.0), self.height.max(1.0))
    }
}

fn view_label(window: &Window) -> String {
    format!("browser-{}", window.label())
}

fn parse_url(url: &str) -> Result<tauri::Url, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only http and https addresses open in the browser view".into());
    }
    url.parse::<tauri::Url>().map_err(|error| error.to_string())
}

/// Put the window's browser view on this address, at these bounds, and show it.
/// Creating a webview from a synchronous command deadlocks on Windows, which is
/// why every command here is `async`.
#[tauri::command]
pub async fn frame_view_show(
    window: Window,
    host: State<'_, FrameViewHost>,
    url: String,
    bounds: FrameBounds,
) -> Result<(), String> {
    let target = parse_url(&url)?;
    let label = view_label(&window);

    if let Some(view) = window.app_handle().get_webview(&label) {
        let changed = {
            let mut urls = host
                .0
                .lock()
                .map_err(|_| "Browser view state is poisoned")?;
            let changed = urls.get(&label).map(String::as_str) != Some(url.as_str());
            urls.insert(label.clone(), url.clone());
            changed
        };
        if changed {
            view.navigate(target).map_err(|error| error.to_string())?;
        }
        view.set_position(bounds.position())
            .map_err(|error| error.to_string())?;
        view.set_size(bounds.size())
            .map_err(|error| error.to_string())?;
        view.show().map_err(|error| error.to_string())?;
        return Ok(());
    }

    window
        .add_child(
            WebviewBuilder::new(&label, WebviewUrl::External(target)),
            bounds.position(),
            bounds.size(),
        )
        .map_err(|error| error.to_string())?;
    host.0
        .lock()
        .map_err(|_| "Browser view state is poisoned")?
        .insert(label, url);
    Ok(())
}

/// Follow the panel as it is resized or the window is. Separate from `show` so
/// a drag moves the view without touching the page it is holding.
#[tauri::command]
pub async fn frame_view_bounds(window: Window, bounds: FrameBounds) -> Result<(), String> {
    let Some(view) = window.app_handle().get_webview(&view_label(&window)) else {
        return Ok(());
    };
    view.set_position(bounds.position())
        .map_err(|error| error.to_string())?;
    view.set_size(bounds.size())
        .map_err(|error| error.to_string())
}

/// Take the view off screen without losing the page, for a menu, a dialog, or
/// a switch to another surface.
#[tauri::command]
pub async fn frame_view_hide(window: Window) -> Result<(), String> {
    let Some(view) = window.app_handle().get_webview(&view_label(&window)) else {
        return Ok(());
    };
    view.hide().map_err(|error| error.to_string())
}

/// Throw the page away. Also called once at startup: a reload replaces the
/// document but not the window, so a view from before it would otherwise be
/// left floating over an app that has forgotten it.
#[tauri::command]
pub async fn frame_view_close(
    window: Window,
    host: State<'_, FrameViewHost>,
) -> Result<(), String> {
    let label = view_label(&window);
    if let Ok(mut urls) = host.0.lock() {
        urls.remove(&label);
    }
    let Some(view) = window.app_handle().get_webview(&label) else {
        return Ok(());
    };
    view.close().map_err(|error| error.to_string())
}

/// Load the current address again, from the network rather than the back stack.
#[tauri::command]
pub async fn frame_view_reload(
    window: Window,
    host: State<'_, FrameViewHost>,
) -> Result<(), String> {
    let label = view_label(&window);
    let url = {
        host.0
            .lock()
            .ok()
            .and_then(|urls| urls.get(&label).cloned())
    };
    let Some(url) = url else { return Ok(()) };
    let Some(view) = window.app_handle().get_webview(&label) else {
        return Ok(());
    };
    view.navigate(parse_url(&url)?)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_addresses_are_accepted() {
        assert!(parse_url("https://example.com/").is_ok());
        assert!(parse_url("http://localhost:3000/").is_ok());
        assert!(parse_url("file:///etc/passwd").is_err());
        assert!(parse_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn a_collapsing_panel_never_asks_for_a_webview_of_no_size() {
        let bounds = FrameBounds {
            x: 4.0,
            y: 8.0,
            width: 0.0,
            height: -3.0,
        };
        assert_eq!(bounds.size().width, 1.0);
        assert_eq!(bounds.size().height, 1.0);
        assert_eq!(bounds.position().x, 4.0);
    }
}
