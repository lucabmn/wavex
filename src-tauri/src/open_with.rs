//! Handing the open project to another application on this machine.
//!
//! The menu is what is installed, not what wavex would like to exist: a
//! program that is not there is left out rather than offered and then failing.
//! Detection is a bundle probe on macOS, where a GUI app does not have to put
//! a CLI on `PATH`, and a `PATH` lookup on Linux and Windows.
//!
//! Like `fs::reveal_path`, these commands are deliberately absent from
//! `connect/dispatch.rs`. An application launches on the machine that runs it,
//! and a host reached over a connection has no desktop the user is sitting in
//! front of, so the client leaves the control out instead.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::fs::{expand_home, path_to_js};

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AppKind {
    /// The desktop's own file manager, which every platform has.
    Files,
    Editor,
    Terminal,
}

#[derive(Clone, Serialize)]
pub struct OpenWithApp {
    pub id: String,
    pub name: String,
    pub kind: AppKind,
    /// A PNG or SVG the WebView can load, or `None` where the platform keeps
    /// its icons somewhere wavex cannot read. The menu draws a glyph for the
    /// kind instead, so a missing icon costs a row nothing.
    pub icon: Option<String>,
}

/// One application wavex knows how to hand a folder to.
struct Spec {
    id: &'static str,
    name: &'static str,
    kind: AppKind,
    /// Bundle names probed under the macOS application directories. Empty for
    /// a program that has no macOS build, or whose build cannot take a folder
    /// as a document.
    ///
    /// This describes the macOS arm, which Linux and Windows never read. It
    /// stays in the table so one row still says everything about an
    /// application, and so it stays under test on any host.
    #[allow(dead_code)]
    bundles: &'static [&'static str],
    /// Program names looked up on `PATH`. Empty for a macOS-only application.
    ///
    /// This and the two below describe the Linux and Windows arm, which macOS
    /// never reads. They stay in the table so one row still says everything
    /// about an application, and so they stay under test on any host.
    #[allow(dead_code)]
    binaries: &'static [&'static str],
    /// Arguments that precede the project path when a program is run directly.
    #[allow(dead_code)]
    args: &'static [&'static str],
    /// When set, the path is glued to this prefix instead of standing alone —
    /// `--working-directory=/repo` rather than `--working-directory /repo`.
    #[allow(dead_code)]
    inline: Option<&'static str>,
}

const fn editor(
    id: &'static str,
    name: &'static str,
    bundles: &'static [&'static str],
    binaries: &'static [&'static str],
) -> Spec {
    Spec {
        id,
        name,
        kind: AppKind::Editor,
        bundles,
        binaries,
        args: &[],
        inline: None,
    }
}

const fn terminal(
    id: &'static str,
    name: &'static str,
    bundles: &'static [&'static str],
    binaries: &'static [&'static str],
    args: &'static [&'static str],
    inline: Option<&'static str>,
) -> Spec {
    Spec {
        id,
        name,
        kind: AppKind::Terminal,
        bundles,
        binaries,
        args,
        inline,
    }
}

/// The file manager is not in the table: it is always present, and each
/// platform reaches it through the same launcher that opens any document.
const FILES_ID: &str = "files";

const SPECS: &[Spec] = &[
    editor(
        "vscode",
        "Visual Studio Code",
        &["Visual Studio Code"],
        &["code"],
    ),
    editor(
        "vscode-insiders",
        "VS Code Insiders",
        &["Visual Studio Code - Insiders"],
        &["code-insiders"],
    ),
    editor("vscodium", "VSCodium", &["VSCodium"], &["codium"]),
    editor("cursor", "Cursor", &["Cursor"], &["cursor"]),
    editor("windsurf", "Windsurf", &["Windsurf"], &["windsurf"]),
    editor("zed", "Zed", &["Zed"], &["zed"]),
    editor("sublime", "Sublime Text", &["Sublime Text"], &["subl"]),
    editor("nova", "Nova", &["Nova"], &[]),
    editor("xcode", "Xcode", &["Xcode"], &[]),
    editor(
        "intellij",
        "IntelliJ IDEA",
        &[
            "IntelliJ IDEA",
            "IntelliJ IDEA Ultimate",
            "IntelliJ IDEA Community Edition",
        ],
        &["idea"],
    ),
    editor("webstorm", "WebStorm", &["WebStorm"], &["webstorm"]),
    editor(
        "pycharm",
        "PyCharm",
        &["PyCharm", "PyCharm Community Edition"],
        &["pycharm"],
    ),
    editor("goland", "GoLand", &["GoLand"], &["goland"]),
    editor("rustrover", "RustRover", &["RustRover"], &["rustrover"]),
    editor(
        "android-studio",
        "Android Studio",
        &["Android Studio"],
        &["studio"],
    ),
    terminal("terminal", "Terminal", &["Terminal"], &[], &[], None),
    terminal("iterm", "iTerm", &["iTerm"], &[], &[], None),
    terminal("warp", "Warp", &["Warp"], &[], &[], None),
    terminal(
        "ghostty",
        "Ghostty",
        &["Ghostty"],
        &["ghostty"],
        &[],
        Some("--working-directory="),
    ),
    terminal(
        "wezterm",
        "WezTerm",
        &["WezTerm"],
        &["wezterm"],
        &["start", "--cwd"],
        None,
    ),
    // Alacritty and kitty have macOS builds, but neither opens a shell when
    // Launch Services hands its bundle a folder, so they stay off that arm.
    terminal(
        "alacritty",
        "Alacritty",
        &[],
        &["alacritty"],
        &["--working-directory"],
        None,
    ),
    terminal("kitty", "kitty", &[], &["kitty"], &["--directory"], None),
    terminal(
        "gnome-terminal",
        "GNOME Terminal",
        &[],
        &["gnome-terminal"],
        &[],
        Some("--working-directory="),
    ),
    terminal(
        "konsole",
        "Konsole",
        &[],
        &["konsole"],
        &["--workdir"],
        None,
    ),
    terminal(
        "xfce4-terminal",
        "Xfce Terminal",
        &[],
        &["xfce4-terminal"],
        &[],
        Some("--working-directory="),
    ),
    terminal("tilix", "Tilix", &[], &["tilix"], &["-w"], None),
    terminal(
        "windows-terminal",
        "Windows Terminal",
        &[],
        &["wt"],
        &["-d"],
        None,
    ),
];

/// What a resolved application is launched through.
enum Target {
    /// A macOS bundle, opened by Launch Services with the folder as document.
    #[cfg(target_os = "macos")]
    Bundle(PathBuf),
    /// A program run directly with the project path in its arguments.
    #[cfg(not(target_os = "macos"))]
    Program(PathBuf),
}

/// The name of this platform's file manager, for the one entry that is always
/// there. `fs::reveal_path` writes the same three words in menu form.
fn files_name() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Finder"
    }
    #[cfg(target_os = "windows")]
    {
        "File Explorer"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "File Manager"
    }
}

#[cfg(target_os = "macos")]
fn bundle_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/Applications/Utilities"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join("Applications"));
    }
    dirs
}

#[cfg(target_os = "macos")]
fn find_bundle(names: &[&str]) -> Option<PathBuf> {
    let dirs = bundle_dirs();
    names.iter().find_map(|name| {
        dirs.iter().find_map(|dir| {
            let bundle = dir.join(format!("{name}.app"));
            bundle.is_dir().then_some(bundle)
        })
    })
}

#[cfg(not(target_os = "macos"))]
fn find_program(names: &[&str], search_path: &str) -> Option<PathBuf> {
    names
        .iter()
        .find_map(|name| crate::harness::which_in_path(search_path, name))
}

/// The `PATH` a lookup walks, built once for a whole probe.
///
/// Reading it costs an interactive login shell, so macOS answers with nothing:
/// there, an application *is* a bundle, and a name on `PATH` is only its CLI
/// shim — `code`, `subl` — which is not the thing being launched.
fn search_path() -> String {
    #[cfg(target_os = "macos")]
    {
        String::new()
    }
    #[cfg(not(target_os = "macos"))]
    {
        crate::harness::gui_search_path()
    }
}

#[allow(unused_variables)]
fn resolve(spec: &Spec, search_path: &str) -> Option<Target> {
    #[cfg(target_os = "macos")]
    {
        find_bundle(spec.bundles).map(Target::Bundle)
    }
    #[cfg(not(target_os = "macos"))]
    {
        find_program(spec.binaries, search_path).map(Target::Program)
    }
}

/// Where converted application icons are kept. macOS ships `.icns`, which no
/// WebView can draw, so a bundle's icon is converted once and reused.
const ICON_CACHE_DIR: &str = "open-with-icons";

#[allow(unused_variables)]
fn icon_for(spec: &Spec, target: &Target, cache: Option<&Path>) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let Target::Bundle(bundle) = target;
        bundle_icon(bundle, spec.id, cache?)
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        desktop_icon(spec.binaries)
    }

    // Windows keeps an application's icon inside the executable, which takes
    // the shell APIs to read. The menu draws its kind glyph instead.
    #[cfg(not(unix))]
    {
        None
    }
}

/// The bundle's icon as a PNG in the cache, converting it on first sight.
#[cfg(target_os = "macos")]
fn bundle_icon(bundle: &Path, id: &str, cache: &Path) -> Option<PathBuf> {
    let png = cache.join(format!("{id}.png"));
    if png.is_file() {
        return Some(png);
    }
    let icns = bundle_icns(bundle)?;
    std::fs::create_dir_all(cache).ok()?;
    // `-Z 128` fits the icon in 128px, which is well past what a menu row
    // draws and small enough that the cache stays a few kilobytes per app.
    let output = crate::process::command("sips")
        .args(["-s", "format", "png", "-Z", "128"])
        .arg(&icns)
        .arg("--out")
        .arg(&png)
        .output()
        .ok()?;
    (output.status.success() && png.is_file()).then_some(png)
}

#[cfg(target_os = "macos")]
fn bundle_icns(bundle: &Path) -> Option<PathBuf> {
    let resources = bundle.join("Contents/Resources");
    if let Some(name) = plist_icon_file(&bundle.join("Contents/Info.plist")) {
        // `CFBundleIconFile` is written both with and without the extension.
        for candidate in [
            resources.join(&name),
            resources.join(format!("{name}.icns")),
        ] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    // An app that names no icon is usually named after it. Taking whatever
    // `.icns` the directory happens to yield instead would pick a document
    // badge — VS Code alone ships `bat`, `bower`, `c`, `css` — and `read_dir`
    // answers in filesystem order, so it would not even pick the same one
    // twice. Nothing is the honest answer; the menu draws its glyph.
    let named = resources.join(format!("{}.icns", bundle.file_stem()?.to_str()?));
    named.is_file().then_some(named)
}

/// `CFBundleIconFile`, read through `plutil` because a bundle's `Info.plist`
/// is as often the binary format as the XML one.
#[cfg(target_os = "macos")]
fn plist_icon_file(plist: &Path) -> Option<String> {
    let output = crate::process::command("plutil")
        .args(["-extract", "CFBundleIconFile", "raw", "-o", "-"])
        .arg(plist)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let name = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (!name.is_empty()).then_some(name)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn desktop_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/usr/local/share/applications"),
        PathBuf::from("/var/lib/flatpak/exports/share/applications"),
        PathBuf::from("/var/lib/snapd/desktop/applications"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        dirs.push(home.join(".local/share/applications"));
        dirs.push(home.join(".local/share/flatpak/exports/share/applications"));
    }
    dirs
}

/// The icon of the first desktop entry naming one of these programs.
#[cfg(all(unix, not(target_os = "macos")))]
fn desktop_icon(binaries: &[&str]) -> Option<PathBuf> {
    for dir in desktop_dirs() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("desktop") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            if !binaries.iter().any(|name| desktop_entry_names(stem, name)) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Some(icon) = desktop_entry_icon(&text) else {
                continue;
            };
            if let Some(path) = resolve_icon_name(&icon) {
                return Some(path);
            }
        }
    }
    None
}

/// Whether a desktop file's stem belongs to `binary`. A reverse-DNS id is the
/// norm now — `com.mitchellh.ghostty.desktop` — so a stem that ends in the
/// program's name counts as much as one that is it.
///
/// Compiled on every platform so the rule stays under test where CI is not
/// running Linux; only the Linux arm calls it.
#[allow(dead_code)]
fn desktop_entry_names(stem: &str, binary: &str) -> bool {
    stem == binary || stem.rsplit('.').next() == Some(binary)
}

/// The `Icon=` of a desktop file's own section. An entry also carries actions
/// in `[Desktop Action …]` sections with icons of their own, which are not the
/// application's.
///
/// Compiled on every platform for the same reason as `desktop_entry_names`.
#[allow(dead_code)]
fn desktop_entry_icon(text: &str) -> Option<String> {
    let mut inside = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            inside = line == "[Desktop Entry]";
            continue;
        }
        if !inside {
            continue;
        }
        if let Some(value) = line.strip_prefix("Icon=") {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// An `Icon=` is either a path or a theme name to look up.
#[cfg(all(unix, not(target_os = "macos")))]
fn resolve_icon_name(name: &str) -> Option<PathBuf> {
    let direct = Path::new(name);
    if direct.is_absolute() {
        return direct.is_file().then(|| direct.to_path_buf());
    }
    // Largest first: a menu row draws small, and a downscaled 256px icon reads
    // better than an upscaled 22px one.
    const SIZES: [&str; 6] = [
        "scalable", "512x512", "256x256", "128x128", "64x64", "48x48",
    ];
    let mut roots = vec![
        PathBuf::from("/usr/share/icons/hicolor"),
        PathBuf::from("/usr/local/share/icons/hicolor"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join(".local/share/icons/hicolor"));
    }
    for root in &roots {
        for size in SIZES {
            for ext in ["png", "svg"] {
                let candidate = root.join(size).join("apps").join(format!("{name}.{ext}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    for ext in ["png", "svg", "xpm"] {
        let candidate = PathBuf::from("/usr/share/pixmaps").join(format!("{name}.{ext}"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// What was installed the last time anyone looked.
///
/// Every window asks as its title bar mounts, and they all read the same disk.
/// Applications are installed rarely enough that a short life beats walking
/// `PATH` and the application directories once per title bar, and short enough
/// that installing one shows up without restarting wavex.
static PROBED: Mutex<Option<(Instant, Vec<OpenWithApp>)>> = Mutex::new(None);
const PROBE_LIFE: Duration = Duration::from_secs(60);

fn probed() -> Option<Vec<OpenWithApp>> {
    let guard = PROBED.lock().ok()?;
    let (at, apps) = guard.as_ref()?;
    (at.elapsed() < PROBE_LIFE).then(|| apps.clone())
}

fn remember(apps: &[OpenWithApp]) {
    if let Ok(mut guard) = PROBED.lock() {
        *guard = Some((Instant::now(), apps.to_vec()));
    }
}

/// Walk the disk for what is installed, then read the icons of what was found.
///
/// The icons go wide because each one is a `sips` or a directory walk that
/// waits on the disk rather than on this thread, and doing ten in a row is ten
/// times the wait for no reason.
fn probe(cache: Option<&Path>) -> Vec<OpenWithApp> {
    let search_path = search_path();
    let found: Vec<(&Spec, Target)> = SPECS
        .iter()
        .filter_map(|spec| Some((spec, resolve(spec, &search_path)?)))
        .collect();
    let icons: Vec<Option<String>> = std::thread::scope(|scope| {
        let running: Vec<_> = found
            .iter()
            .map(|(spec, target)| {
                scope.spawn(move || icon_for(spec, target, cache).map(|path| path_to_js(&path)))
            })
            .collect();
        running
            .into_iter()
            .map(|handle| handle.join().unwrap_or(None))
            .collect()
    });

    let mut apps = vec![OpenWithApp {
        id: FILES_ID.to_string(),
        name: files_name().to_string(),
        kind: AppKind::Files,
        icon: None,
    }];
    apps.extend(
        found
            .into_iter()
            .zip(icons)
            .map(|((spec, _), icon)| OpenWithApp {
                id: spec.id.to_string(),
                name: spec.name.to_string(),
                kind: spec.kind,
                icon,
            }),
    );
    apps
}

#[tauri::command]
pub async fn list_open_with_apps(app: AppHandle) -> Result<Vec<OpenWithApp>, String> {
    if let Some(apps) = probed() {
        return Ok(apps);
    }
    // Under the app data directory rather than the cache one because that is
    // what `assetProtocol`'s scope covers — a converted icon the WebView
    // cannot load is not worth writing. A missing directory only costs the
    // icons, so the list still answers.
    let cache = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(ICON_CACHE_DIR));
    tauri::async_runtime::spawn_blocking(move || {
        let apps = probe(cache.as_deref());
        remember(&apps);
        apps
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_path_with(app: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || open_path_with_sync(&app, &path))
        .await
        .map_err(|e| e.to_string())?
}

fn open_path_with_sync(app: &str, path: &str) -> Result<(), String> {
    let path = expand_home(path);
    if !path.exists() {
        return Err(format!("{}: No such file or directory", path.display()));
    }
    if app == FILES_ID {
        return open_in_files(&path);
    }
    // `app` only ever names a row of the table, so nothing the user types can
    // become the program that runs.
    let spec = SPECS
        .iter()
        .find(|spec| spec.id == app)
        .ok_or_else(|| format!("Unknown application: {app}"))?;
    let target =
        resolve(spec, &search_path()).ok_or_else(|| format!("{} is not installed.", spec.name))?;
    match target {
        #[cfg(target_os = "macos")]
        Target::Bundle(bundle) => launch_bundle(&bundle, &path, spec.name),
        #[cfg(not(target_os = "macos"))]
        Target::Program(program) => launch_program(&program, spec, &path),
    }
}

/// Open the folder itself in the desktop's file manager. `fs::reveal_path`
/// selects a path inside its parent; this shows what is in the folder.
fn open_in_files(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = crate::process::command("open")
            .arg(path)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Could not open in Finder.".into());
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        // explorer.exe exits 1 even when it opened the folder, so its status
        // says nothing, and it wants the native separator back.
        let native = path.to_string_lossy().replace('/', "\\");
        crate::process::command("explorer")
            .arg(native)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let status = crate::process::command("xdg-open")
            .arg(path)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Could not open the folder.".into());
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn launch_bundle(bundle: &Path, path: &Path, name: &str) -> Result<(), String> {
    let status = crate::process::command("open")
        .arg("-a")
        .arg(bundle)
        .arg(path)
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("Could not open the project in {name}."));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn launch_program(program: &Path, spec: &Spec, path: &Path) -> Result<(), String> {
    let mut cmd = crate::process::command(program);
    // A CLI shim like `code` re-execs a runtime it expects on PATH, and a
    // Finder-launched app inherits launchd's, which has neither Homebrew nor
    // npm on it.
    crate::harness::apply_gui_env(&mut cmd);
    cmd.args(spec.args);
    cmd.arg(path_argument(spec, path));
    // Not waited on: these outlive the click by design, and a terminal that
    // stays in the foreground would otherwise hold the blocking task forever.
    crate::process::spawn(&mut cmd)
        .map(|_| ())
        .map_err(|e| format!("Could not open the project in {}: {e}", spec.name))
}

/// The single argument carrying the project path, glued to a prefix when the
/// program takes its working directory that way.
///
/// Compiled on every platform so the rule stays under test where CI is not
/// running Linux; only the non-macOS arm calls it.
#[allow(dead_code)]
fn path_argument(spec: &Spec, path: &Path) -> std::ffi::OsString {
    match spec.inline {
        Some(prefix) => {
            let mut arg = std::ffi::OsString::from(prefix);
            arg.push(path);
            arg
        }
        None => path.as_os_str().to_os_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_never_shadow_the_file_manager() {
        let mut ids: Vec<&str> = SPECS.iter().map(|spec| spec.id).collect();
        ids.push(FILES_ID);
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count);
    }

    #[test]
    fn every_spec_is_reachable_on_some_platform() {
        for spec in SPECS {
            assert!(
                !spec.bundles.is_empty() || !spec.binaries.is_empty(),
                "{} can never be found",
                spec.id
            );
        }
    }

    #[test]
    fn an_inline_flag_carries_the_path_without_a_separator() {
        let spec = SPECS
            .iter()
            .find(|spec| spec.id == "gnome-terminal")
            .expect("gnome-terminal");
        assert_eq!(
            path_argument(spec, Path::new("/home/luca/wavex")),
            std::ffi::OsString::from("--working-directory=/home/luca/wavex")
        );
    }

    #[test]
    fn a_plain_program_takes_the_path_on_its_own() {
        let spec = SPECS.iter().find(|spec| spec.id == "zed").expect("zed");
        assert!(spec.args.is_empty());
        assert_eq!(
            path_argument(spec, Path::new("/home/luca/wavex")),
            std::ffi::OsString::from("/home/luca/wavex")
        );
    }

    #[test]
    fn a_reverse_dns_desktop_id_still_belongs_to_its_program() {
        assert!(desktop_entry_names("ghostty", "ghostty"));
        assert!(desktop_entry_names("com.mitchellh.ghostty", "ghostty"));
        assert!(!desktop_entry_names("ghostty-tui", "ghostty"));
        assert!(!desktop_entry_names("code", "codium"));
    }

    #[test]
    fn reads_the_icon_of_the_entry_and_not_of_an_action() {
        let text = "[Desktop Entry]\nName=Zed\nIcon=zed\n\n[Desktop Action new]\nIcon=zed-new\n";
        assert_eq!(desktop_entry_icon(text).as_deref(), Some("zed"));
    }

    #[test]
    fn an_entry_without_an_icon_answers_with_nothing() {
        assert_eq!(desktop_entry_icon("[Desktop Entry]\nName=Zed\n"), None);
        assert_eq!(desktop_entry_icon("[Desktop Action new]\nIcon=zed\n"), None);
    }

    #[test]
    fn an_unknown_application_is_refused_before_anything_is_spawned() {
        let err = open_path_with_sync("rm -rf /", ".").unwrap_err();
        assert!(err.contains("Unknown application"), "{err}");
    }
}
