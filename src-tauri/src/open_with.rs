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

use crate::fs::expand_home;

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AppKind {
    /// The desktop's own file manager, which every platform has.
    Files,
    Editor,
    Terminal,
}

#[derive(Serialize)]
pub struct OpenWithApp {
    pub id: String,
    pub name: String,
    pub kind: AppKind,
}

/// One application wavex knows how to hand a folder to.
struct Spec {
    id: &'static str,
    name: &'static str,
    kind: AppKind,
    /// Bundle names probed under the macOS application directories. Empty for
    /// a program that has no macOS build, or whose build cannot take a folder
    /// as a document.
    bundles: &'static [&'static str],
    /// Program names looked up on `PATH`. Empty for a macOS-only application.
    binaries: &'static [&'static str],
    /// Arguments that precede the project path when a program is run directly.
    args: &'static [&'static str],
    /// When set, the path is glued to this prefix instead of standing alone —
    /// `--working-directory=/repo` rather than `--working-directory /repo`.
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

fn find_program(names: &[&str]) -> Option<PathBuf> {
    names
        .iter()
        .find_map(|name| crate::harness::resolve_gui_binary(name))
}

fn resolve(spec: &Spec) -> Option<Target> {
    #[cfg(target_os = "macos")]
    if let Some(bundle) = find_bundle(spec.bundles) {
        return Some(Target::Bundle(bundle));
    }
    find_program(spec.binaries).map(Target::Program)
}

#[tauri::command]
pub async fn list_open_with_apps() -> Result<Vec<OpenWithApp>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut apps = vec![OpenWithApp {
            id: FILES_ID.to_string(),
            name: files_name().to_string(),
            kind: AppKind::Files,
        }];
        apps.extend(
            SPECS
                .iter()
                .filter(|spec| resolve(spec).is_some())
                .map(|spec| OpenWithApp {
                    id: spec.id.to_string(),
                    name: spec.name.to_string(),
                    kind: spec.kind,
                }),
        );
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
    let target = resolve(spec).ok_or_else(|| format!("{} is not installed.", spec.name))?;
    match target {
        #[cfg(target_os = "macos")]
        Target::Bundle(bundle) => launch_bundle(&bundle, &path, spec.name),
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
    fn an_unknown_application_is_refused_before_anything_is_spawned() {
        let err = open_path_with_sync("rm -rf /", ".").unwrap_err();
        assert!(err.contains("Unknown application"), "{err}");
    }
}
