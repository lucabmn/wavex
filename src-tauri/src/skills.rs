use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::dirs_home;
use crate::fs::expand_home;

const MAX_SKILLS: usize = 300;
const MAX_FRONTMATTER_BYTES: usize = 16 * 1024;
const MAX_SKILL_FILES: usize = 4096;
const MAX_SKILL_TOOLS: usize = 32;
/// Appended to `SKILL.md` to take a skill out of circulation.
const DISABLED_SUFFIX: &str = ".off";

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSkill {
    pub name: String,
    pub description: String,
    pub path: String,
    pub scope: String,
    pub source: String,
}

/// One folder a skill was found in, and the agent whose directory holds it.
///
/// The `skills` CLI writes a skill once under `.agents/skills` and links it
/// into each agent's own folder, so the same name in several roots is one skill
/// installed in several places rather than several skills.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstall {
    pub source: String,
    pub scope: String,
    pub dir: String,
    pub path: String,
    pub link: bool,
    pub enabled: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillDetail {
    pub name: String,
    pub description: String,
    pub enabled: bool,
    /// Installed and updated by an agent CLI's own plugin manager, so wavex
    /// reads it and nothing more.
    pub managed: bool,
    pub bytes: u64,
    pub updated_ms: u64,
    pub tools: Vec<String>,
    pub installs: Vec<SkillInstall>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallResult {
    pub ok: bool,
    pub output: String,
}

/// Skills visible for the open project: `.agents/skills` first, then native
/// harness folders. Same name: earlier roots win.
#[tauri::command(async)]
pub fn list_skills(cwd: String) -> Result<Vec<DiscoveredSkill>, String> {
    let project = expand_home(&cwd);
    let home = dirs_home().map(PathBuf::from);
    Ok(list_skills_from(&project, home.as_deref()))
}

pub(crate) fn list_skills_from(project: &Path, home: Option<&Path>) -> Vec<DiscoveredSkill> {
    let mut by_name: HashMap<String, DiscoveredSkill> = HashMap::new();

    for root in unique_roots(skill_roots(project, home)) {
        if by_name.len() >= MAX_SKILLS {
            break;
        }
        for skill in scan_root(&root.path, false) {
            if by_name.len() >= MAX_SKILLS {
                break;
            }
            let name = root.qualify(&skill.name);
            by_name.entry(name.clone()).or_insert(DiscoveredSkill {
                name,
                description: skill.description,
                path: crate::fs::path_to_js(&skill.skill_md),
                scope: root.scope.to_string(),
                source: root.source.to_string(),
            });
        }
    }

    let mut out: Vec<DiscoveredSkill> = by_name.into_values().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Everything the skills settings page shows, which `list_skills` deliberately
/// does not carry: the folder in every agent directory the skill was found in,
/// its size, when it last changed, and whether it is switched on.
///
/// It is a second command rather than a wider `list_skills` because that one
/// feeds the composer picker on every keystroke and must not stat a few hundred
/// skill trees to answer.
#[tauri::command(async)]
pub fn list_skill_details(cwd: String) -> Result<Vec<SkillDetail>, String> {
    let project = expand_home(&cwd);
    let home = dirs_home().map(PathBuf::from);
    Ok(skill_details_from(&project, home.as_deref()))
}

pub(crate) fn skill_details_from(project: &Path, home: Option<&Path>) -> Vec<SkillDetail> {
    let mut by_name: HashMap<String, SkillDetail> = HashMap::new();

    for root in unique_roots(skill_roots(project, home)) {
        for skill in scan_root(&root.path, true) {
            let name = root.qualify(&skill.name);
            let install = SkillInstall {
                source: root.source.to_string(),
                scope: root.scope.to_string(),
                dir: crate::fs::path_to_js(&skill.dir),
                path: crate::fs::path_to_js(&skill.skill_md),
                link: is_symlink(&skill.dir),
                enabled: skill.enabled,
            };
            if let Some(detail) = by_name.get_mut(&name) {
                // A skill the `skills` CLI installed is one real folder plus a
                // link per agent, so the same name in a second root is another
                // place it is installed rather than a second skill.
                detail.enabled = detail.enabled || skill.enabled;
                detail.installs.push(install);
                continue;
            }
            if by_name.len() >= MAX_SKILLS {
                break;
            }
            by_name.insert(
                name.clone(),
                SkillDetail {
                    name,
                    description: skill.description,
                    enabled: skill.enabled,
                    managed: root.namespace.is_some(),
                    bytes: dir_bytes(&skill.dir),
                    updated_ms: modified_ms(&skill.skill_md),
                    tools: skill.tools,
                    installs: vec![install],
                },
            );
        }
    }

    let mut out: Vec<SkillDetail> = by_name.into_values().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// One directory skills are read from, and the agent it belongs to.
struct SkillRoot {
    path: PathBuf,
    scope: &'static str,
    source: &'static str,
    /// Claude plugin skills answer to `plugin:name`, so they cannot collide
    /// with a skill of the same name the user wrote themselves.
    namespace: Option<String>,
}

impl SkillRoot {
    fn qualify(&self, name: &str) -> String {
        match &self.namespace {
            Some(namespace) => format!("{namespace}:{name}"),
            None => name.to_string(),
        }
    }
}

fn root(path: PathBuf, scope: &'static str, source: &'static str) -> SkillRoot {
    SkillRoot {
        path,
        scope,
        source,
        namespace: None,
    }
}

/// Highest priority first, so a later root can never replace a name.
fn skill_roots(project: &Path, home: Option<&Path>) -> Vec<SkillRoot> {
    let mut roots = vec![root(project.join(".agents/skills"), "project", "agents")];
    if let Some(home) = home {
        roots.push(root(home.join(".agents/skills"), "user", "agents"));
    }

    for (dir, source) in [
        (".claude/skills", "claude"),
        (".cursor/skills", "cursor"),
        (".codex/skills", "codex"),
        (".opencode/skills", "opencode"),
        (".pi/skills", "pi"),
        (".omp/skills", "omp"),
        (".fx/skills", "fx"),
        (".grok/skills", "grok"),
    ] {
        roots.push(root(project.join(dir), "project", source));
        if let Some(home) = home {
            roots.push(root(home.join(dir), "user", source));
        }
    }
    if let Some(home) = home {
        roots.push(root(home.join(".pi/agent/skills"), "user", "pi"));
        roots.push(root(home.join(".omp/agent/skills"), "user", "omp"));
        for (path, scope, namespace) in claude_plugin_skill_roots(home, project) {
            roots.push(SkillRoot {
                path,
                scope,
                source: "claude",
                namespace: Some(namespace),
            });
        }
    }
    roots
}

/// Drop roots that resolve to a directory an earlier root already covered.
fn unique_roots(roots: Vec<SkillRoot>) -> Vec<SkillRoot> {
    let mut seen: HashSet<PathBuf> = HashSet::new();
    roots
        .into_iter()
        .filter(|root| {
            let key = std::fs::canonicalize(&root.path).unwrap_or_else(|_| root.path.clone());
            seen.insert(key)
        })
        .collect()
}

/// Switch a skill on or off by renaming its `SKILL.md` aside.
///
/// The rename is what actually takes a skill out of circulation: every agent
/// CLI discovers a skill by that one file, so a flag wavex kept to itself would
/// hide the skill from the picker while Claude Code went on loading it.
/// Renaming the folder instead would dangle the link each agent directory holds.
#[tauri::command(async)]
pub fn set_skill_enabled(cwd: String, dirs: Vec<String>, enabled: bool) -> Result<(), String> {
    let project = expand_home(&cwd);
    let home = dirs_home().map(PathBuf::from);
    set_skill_enabled_in(&project, home.as_deref(), dirs, enabled)
}

pub(crate) fn set_skill_enabled_in(
    project: &Path,
    home: Option<&Path>,
    dirs: Vec<String>,
    enabled: bool,
) -> Result<(), String> {
    for dir in unique_targets(skill_dirs(project, home, dirs)?) {
        let Some((path, current)) = skill_md_path(&dir) else {
            continue;
        };
        if current == enabled {
            continue;
        }
        let target = if enabled {
            path.with_extension("")
        } else {
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("SKILL.md");
            path.with_file_name(format!("{name}{DISABLED_SUFFIX}"))
        };
        std::fs::rename(&path, &target)
            .map_err(|error| format!("Could not rename {}: {error}", path.display()))?;
    }
    Ok(())
}

/// Delete every folder a skill is installed in.
#[tauri::command(async)]
pub fn delete_skills(cwd: String, dirs: Vec<String>) -> Result<(), String> {
    let project = expand_home(&cwd);
    let home = dirs_home().map(PathBuf::from);
    delete_skills_in(&project, home.as_deref(), dirs)
}

pub(crate) fn delete_skills_in(
    project: &Path,
    home: Option<&Path>,
    dirs: Vec<String>,
) -> Result<(), String> {
    // Validate the whole set before removing anything, then take the links
    // first: dropping the real folder ahead of them would leave each agent
    // directory pointing at nothing. Every distinct folder has to go, so this
    // one keeps a link and the folder it resolves to rather than collapsing
    // them the way a rename has to.
    let mut targets = skill_dirs(project, home, dirs)?;
    targets.sort_by_key(|dir| !is_symlink(dir));

    for dir in targets {
        if is_symlink(&dir) {
            remove_link(&dir)?;
            continue;
        }
        std::fs::remove_dir_all(&dir)
            .map_err(|error| format!("Could not delete {}: {error}", dir.display()))?;
    }
    Ok(())
}

/// A directory symlink is a file on Unix and a directory on Windows.
fn remove_link(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let removed = std::fs::remove_dir(path).or_else(|_| std::fs::remove_file(path));
    #[cfg(not(windows))]
    let removed = std::fs::remove_file(path);
    removed.map_err(|error| format!("Could not delete {}: {error}", path.display()))
}

/// Resolve the folders a mutation was asked for, refusing anything that is not
/// a skill wavex may touch.
fn skill_dirs(
    project: &Path,
    home: Option<&Path>,
    dirs: Vec<String>,
) -> Result<Vec<PathBuf>, String> {
    let managed = managed_skill_roots(project, home);
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut out = Vec::new();
    for raw in dirs {
        let dir = expand_home(&raw);
        if !is_skill_dir(&dir) {
            return Err(format!("{raw} is not a skill folder"));
        }
        if is_within_roots(&dir, &managed) {
            return Err(format!(
                "{raw} belongs to an installed plugin, which owns the file on disk."
            ));
        }
        if seen.insert(dir.clone()) {
            out.push(dir);
        }
    }
    Ok(out)
}

/// Collapse folders that reach the same one through a link. A rename needs
/// this: the second one would look for a file the first already moved.
fn unique_targets(dirs: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen: HashSet<PathBuf> = HashSet::new();
    dirs.into_iter()
        .filter(|dir| seen.insert(std::fs::canonicalize(dir).unwrap_or_else(|_| dir.clone())))
        .collect()
}

/// The skill folders an agent CLI's plugin manager owns. wavex lists what is in
/// them and stops there: the installer wrote those files, does not know wavex
/// moved one, and puts it back on the next update.
fn managed_skill_roots(project: &Path, home: Option<&Path>) -> Vec<PathBuf> {
    skill_roots(project, home)
        .into_iter()
        .filter(|root| root.namespace.is_some())
        .map(|root| std::fs::canonicalize(&root.path).unwrap_or(root.path))
        .collect()
}

fn is_within_roots(dir: &Path, roots: &[PathBuf]) -> bool {
    let Some(parent) = dir.parent() else {
        return false;
    };
    let parent = std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    roots.iter().any(|root| root == &parent)
}

/// A skill folder sits inside a `skills` directory and holds a `SKILL.md`, so a
/// path the WebView sends can only ever name something wavex itself listed.
fn is_skill_dir(dir: &Path) -> bool {
    let inside_skills = dir
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("skills"));
    inside_skills && skill_md_path(dir).is_some()
}

/// Add a skill package with the `skills` CLI.
///
/// wavex never downloads a skill itself. This runs the command the user would
/// have typed, with the agents and the scope they picked, and hands back what
/// it printed. An installed `skills` is preferred over `npx` so a machine that
/// already has the CLI does not go to the registry for it.
#[tauri::command(async)]
pub fn install_skills(
    cwd: String,
    package: String,
    agents: Vec<String>,
    skills: Vec<String>,
    global: bool,
) -> Result<SkillInstallResult, String> {
    let package = package.trim().to_string();
    if package.is_empty() || package.starts_with('-') {
        return Err("Enter a package such as owner/repo.".into());
    }
    for agent in &agents {
        if !is_cli_token(agent) {
            return Err(format!("{agent} is not an agent name."));
        }
    }
    for skill in &skills {
        if skill != "*" && !is_valid_skill_name(skill) {
            return Err(format!("{skill} is not a skill name."));
        }
    }

    let (program, mut args) = match crate::harness::resolve_gui_binary("skills") {
        Some(path) => (path, Vec::new()),
        None => {
            let npx = crate::harness::resolve_gui_binary("npx")
                .ok_or("Node is not installed, so the skills CLI cannot be run.")?;
            (npx, vec!["-y".to_string(), "skills@latest".to_string()])
        }
    };
    args.push("add".into());
    args.push(package);
    for agent in agents {
        args.push("--agent".into());
        args.push(agent);
    }
    for skill in skills {
        args.push("--skill".into());
        args.push(skill);
    }
    if global {
        args.push("--global".into());
    }
    args.push("--yes".into());

    let mut cmd = crate::process::command(&program);
    cmd.args(&args);
    let project = expand_home(&cwd);
    if project.is_dir() {
        cmd.current_dir(&project);
    }
    crate::harness::apply_gui_env(&mut cmd);
    // No terminal is attached, so a prompt the CLI still decides to ask has to
    // fail rather than wait for an answer that can never arrive.
    cmd.stdin(std::process::Stdio::null());

    let output = cmd
        .output()
        .map_err(|error| format!("Could not run {}: {error}", program.display()))?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok(SkillInstallResult {
        ok: output.status.success(),
        output: strip_ansi(&text).trim().to_string(),
    })
}

/// The shape of every agent id and flag value the CLI accepts.
fn is_cli_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

/// The CLI draws spinners and colour even without a terminal, and the page
/// shows what it printed as plain text.
fn strip_ansi(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            out.push(ch);
            continue;
        }
        if chars.peek() == Some(&'[') {
            chars.next();
            for ch in chars.by_ref() {
                if ch.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            chars.next();
        }
    }
    out
}

fn claude_plugin_skill_roots(home: &Path, project: &Path) -> Vec<(PathBuf, &'static str, String)> {
    let registry = home.join(".claude/plugins/installed_plugins.json");
    let Ok(raw) = std::fs::read_to_string(registry) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let Some(plugins) = value.get("plugins").and_then(|value| value.as_object()) else {
        return Vec::new();
    };

    let mut roots = Vec::new();
    for (plugin_id, installed) in plugins {
        if !claude_plugin_enabled(home, project, plugin_id) {
            continue;
        }
        let namespace = plugin_id
            .rsplit_once('@')
            .map(|(name, _)| name)
            .unwrap_or(plugin_id);
        if !is_valid_skill_name(namespace) {
            continue;
        }
        let entries: Vec<&serde_json::Value> = match installed.as_array() {
            Some(entries) => entries.iter().collect(),
            None if installed.is_object() => vec![installed],
            None => continue,
        };
        for entry in entries {
            let Some(install_path) = entry.get("installPath").and_then(|value| value.as_str())
            else {
                continue;
            };
            let scope = match entry.get("scope").and_then(|value| value.as_str()) {
                Some("project" | "local") => {
                    let Some(project_path) =
                        entry.get("projectPath").and_then(|value| value.as_str())
                    else {
                        continue;
                    };
                    if !path_is_within(project, &resolve_home_path(project_path, home)) {
                        continue;
                    }
                    "project"
                }
                Some("user") | None => "user",
                Some(_) => continue,
            };
            roots.push((
                resolve_home_path(install_path, home).join("skills"),
                scope,
                namespace.to_string(),
            ));
        }
    }
    roots.sort_by_key(|(_, scope, _)| if *scope == "project" { 0 } else { 1 });
    roots
}

fn resolve_home_path(raw: &str, home: &Path) -> PathBuf {
    if raw == "~" {
        return home.to_path_buf();
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        return home.join(rest);
    }
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        path
    } else {
        home.join(path)
    }
}

fn claude_plugin_enabled(home: &Path, project: &Path, plugin_id: &str) -> bool {
    if let Some(enabled) = managed_plugin_setting(plugin_id) {
        return enabled;
    }
    let project_root = claude_settings_project_root(project);
    for settings in [
        project_root.join(".claude/settings.local.json"),
        project_root.join(".claude/settings.json"),
        home.join(".claude/settings.json"),
    ] {
        if let Some(enabled) = plugin_setting(&settings, plugin_id) {
            return enabled;
        }
    }
    true
}

fn claude_settings_project_root(project: &Path) -> PathBuf {
    for candidate in project.ancestors() {
        let claude = candidate.join(".claude");
        if claude.join("settings.local.json").is_file() || claude.join("settings.json").is_file() {
            return candidate.to_path_buf();
        }
    }
    project.to_path_buf()
}

fn plugin_setting(path: &Path, plugin_id: &str) -> Option<bool> {
    let raw = std::fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    value.get("enabledPlugins")?.get(plugin_id)?.as_bool()
}

fn managed_plugin_setting(plugin_id: &str) -> Option<bool> {
    let root = managed_settings_root()?;
    managed_plugin_setting_from_root(&root, plugin_id)
}

fn managed_plugin_setting_from_root(root: &Path, plugin_id: &str) -> Option<bool> {
    let mut value = plugin_setting(&root.join("managed-settings.json"), plugin_id);
    let dir = root.join("managed-settings.d");
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().and_then(|ext| ext.to_str()) == Some("json")
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| !name.starts_with('.'))
        })
        .collect();
    files.sort();
    for file in files {
        if let Some(enabled) = plugin_setting(&file, plugin_id) {
            value = Some(enabled);
        }
    }
    value
}

fn managed_settings_root() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        return Some(PathBuf::from("/Library/Application Support/ClaudeCode"));
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        return Some(PathBuf::from("/etc/claude-code"));
    }
    #[cfg(target_os = "windows")]
    {
        return Some(PathBuf::from(r"C:\Program Files\ClaudeCode"));
    }
    #[allow(unreachable_code)]
    None
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    let Ok(path) = std::fs::canonicalize(path) else {
        return false;
    };
    let Ok(root) = std::fs::canonicalize(root) else {
        return false;
    };
    path == root || path.starts_with(root)
}

/// A skill folder as it sits on disk, before it is attributed to an agent.
struct ScannedSkill {
    name: String,
    description: String,
    tools: Vec<String>,
    dir: PathBuf,
    skill_md: PathBuf,
    enabled: bool,
}

fn scan_root(root: &Path, include_disabled: bool) -> Vec<ScannedSkill> {
    let Ok(reader) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for ent in reader.flatten() {
        let dir = ent.path();
        if !dir.is_dir() {
            continue;
        }
        let Some(folder) = dir.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if folder.starts_with('.') || folder == "skills-cursor" {
            continue;
        }
        let Some((skill_md, enabled)) = skill_md_path(&dir) else {
            continue;
        };
        if !enabled && !include_disabled {
            continue;
        }
        let Ok(bytes) = read_prefix(&skill_md, MAX_FRONTMATTER_BYTES) else {
            continue;
        };
        let Ok(text) = String::from_utf8(bytes) else {
            continue;
        };
        let fallback = slug_name(folder);
        if fallback.is_empty() {
            continue;
        }
        let front = parse_frontmatter(&text, &fallback);
        if front.name.is_empty() {
            continue;
        }
        out.push(ScannedSkill {
            name: front.name,
            description: front.description,
            tools: front.tools,
            dir,
            skill_md,
            enabled,
        });
    }
    out
}

/// The `SKILL.md` in a skill folder, and whether it is switched on.
///
/// A skill wavex switched off keeps its folder and every link pointing at it,
/// with the one file every agent looks for renamed aside.
fn skill_md_path(dir: &Path) -> Option<(PathBuf, bool)> {
    for name in ["SKILL.md", "skill.md"] {
        let path = dir.join(name);
        if path.is_file() {
            return Some((path, true));
        }
    }
    for name in ["SKILL.md", "skill.md"] {
        let path = dir.join(format!("{name}{DISABLED_SUFFIX}"));
        if path.is_file() {
            return Some((path, false));
        }
    }
    None
}

fn is_symlink(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink())
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_millis() as u64)
        .unwrap_or(0)
}

/// Bytes a skill folder holds, so the page can say what a skill costs an agent
/// that loads it. Bounded rather than exact: a skill that ships a corpus should
/// read as large, and a link cycle must not walk forever.
fn dir_bytes(dir: &Path) -> u64 {
    let mut total = 0u64;
    let mut visited = 0usize;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(next) = stack.pop() {
        let Ok(reader) = std::fs::read_dir(&next) else {
            continue;
        };
        for ent in reader.flatten() {
            if visited >= MAX_SKILL_FILES {
                return total;
            }
            visited += 1;
            let Ok(meta) = ent.metadata() else { continue };
            if meta.is_dir() {
                stack.push(ent.path());
            } else {
                total += meta.len();
            }
        }
    }
    total
}

fn read_prefix(path: &Path, max: usize) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let file = std::fs::File::open(path)?;
    let mut buf = Vec::with_capacity(max.min(4096));
    file.take(max as u64).read_to_end(&mut buf)?;
    Ok(buf)
}

/// The `SKILL.md` header fields wavex reads.
struct Frontmatter {
    name: String,
    description: String,
    tools: Vec<String>,
}

fn parse_frontmatter(text: &str, fallback: &str) -> Frontmatter {
    let blank = || Frontmatter {
        name: fallback.to_string(),
        description: String::new(),
        tools: Vec::new(),
    };
    let trimmed = text.trim_start_matches('\u{feff}');
    let Some(rest) = trimmed.strip_prefix("---") else {
        return blank();
    };
    let rest = rest.strip_prefix('\r').unwrap_or(rest);
    let rest = rest.strip_prefix('\n').unwrap_or(rest);
    let end = rest
        .find("\n---")
        .or_else(|| rest.find("\r\n---"))
        .unwrap_or(rest.len());
    let yaml = &rest[..end];

    let mut name: Option<String> = None;
    let mut description = String::new();
    let mut tools: Vec<String> = Vec::new();
    let mut in_desc = false;
    let mut fold_desc = false;
    let mut in_tools = false;

    for raw in yaml.lines() {
        if in_desc {
            if is_yaml_indent(raw) {
                let piece = raw.trim();
                if piece.is_empty() {
                    continue;
                }
                if !description.is_empty() {
                    description.push(if fold_desc { ' ' } else { '\n' });
                }
                description.push_str(piece);
                continue;
            }
            in_desc = false;
        }
        if in_tools {
            if is_yaml_indent(raw) {
                if let Some(item) = raw.trim().strip_prefix('-') {
                    push_tool(&mut tools, item);
                }
                continue;
            }
            in_tools = false;
        }

        let line = raw.trim_end();
        if let Some(value) = yaml_value(line, "name") {
            name = Some(unquote(&value));
        } else if let Some(value) = yaml_value(line, "description") {
            let value = value.trim();
            if is_folded_scalar(value) {
                in_desc = true;
                fold_desc = value.starts_with('>');
                description.clear();
            } else {
                description = unquote(value);
            }
        } else if let Some(value) = tool_list_value(line) {
            let value = value.trim();
            tools.clear();
            if value.is_empty() {
                in_tools = true;
            } else {
                for piece in value
                    .trim_start_matches('[')
                    .trim_end_matches(']')
                    .split(',')
                {
                    push_tool(&mut tools, piece);
                }
            }
        }
    }

    let name = name
        .filter(|n| is_valid_skill_name(n))
        .unwrap_or_else(|| fallback.to_string());
    Frontmatter {
        name,
        description: description.trim().to_string(),
        tools,
    }
}

/// `allowed-tools` is Claude's spelling, `tools` the one other CLIs use.
fn tool_list_value(line: &str) -> Option<String> {
    yaml_value(line, "allowed-tools").or_else(|| yaml_value(line, "tools"))
}

fn push_tool(tools: &mut Vec<String>, raw: &str) {
    let tool = unquote(raw.trim());
    if tool.is_empty() || tools.len() >= MAX_SKILL_TOOLS || tools.contains(&tool) {
        return;
    }
    tools.push(tool);
}

fn yaml_value(line: &str, key: &str) -> Option<String> {
    let line = line.trim_start();
    let prefix = format!("{key}:");
    line.strip_prefix(&prefix)
        .map(|rest| rest.trim().to_string())
}

fn is_folded_scalar(value: &str) -> bool {
    value.starts_with('>') || value.starts_with('|')
}

fn is_yaml_indent(line: &str) -> bool {
    line.starts_with(' ') || line.starts_with('\t')
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    let bytes = value.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return value[1..value.len() - 1].to_string();
        }
    }
    value.to_string()
}

fn is_valid_skill_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 {
        return false;
    }
    let mut prev_dash = true;
    for (i, ch) in name.chars().enumerate() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            prev_dash = false;
            continue;
        }
        if ch == '-' && i > 0 && !prev_dash {
            prev_dash = true;
            continue;
        }
        return false;
    }
    !prev_dash
}

fn slug_name(raw: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.len() > 64 {
        out.truncate(64);
        while out.ends_with('-') {
            out.pop();
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::ErrorKind;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn tmp(label: &str) -> Tmp {
        loop {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "wavex-skills-{label}-{}-{stamp}-{seq}",
                std::process::id()
            ));
            match std::fs::create_dir(&dir) {
                Ok(()) => return Tmp(dir),
                Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("{}", error),
            }
        }
    }

    fn write_skill(root: &Path, folder: &str, body: &str) {
        let dir = root.join(folder);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), body).unwrap();
    }

    fn write_plugin_setting(root: &Path, file: &str, plugin_id: &str, enabled: bool) {
        let dir = root.join(".claude");
        std::fs::create_dir_all(&dir).unwrap();
        let settings = serde_json::json!({
            "enabledPlugins": { plugin_id: enabled }
        });
        std::fs::write(dir.join(file), serde_json::to_vec(&settings).unwrap()).unwrap();
    }

    #[test]
    fn parse_frontmatter_reads_name_and_folded_description() {
        let front = parse_frontmatter(
            "---\nname: review-pr\ndescription: >\n  Review pull requests.\n  Use when asked to review.\nallowed-tools: Read, Write, Edit\n---\n\n# hi\n",
            "fallback",
        );
        assert_eq!(front.name, "review-pr");
        assert_eq!(
            front.description,
            "Review pull requests. Use when asked to review."
        );
        assert_eq!(front.tools, ["Read", "Write", "Edit"]);
    }

    #[test]
    fn parse_frontmatter_falls_back_to_folder_name() {
        let front = parse_frontmatter("# no yaml\n", "create-skill");
        assert_eq!(front.name, "create-skill");
        assert_eq!(front.description, "");
        assert!(front.tools.is_empty());
    }

    #[test]
    fn agents_skills_win_over_provider_dirs() {
        let project = tmp("proj");
        let home = tmp("home");
        write_skill(
            &project.0.join(".agents/skills"),
            "ship",
            "---\nname: ship\ndescription: wavex ship\n---\n",
        );
        write_skill(
            &project.0.join(".claude/skills"),
            "ship",
            "---\nname: ship\ndescription: Claude ship\n---\n",
        );
        write_skill(
            &home.0.join(".agents/skills"),
            "greet",
            "---\nname: greet\ndescription: Hello\n---\n",
        );
        write_skill(
            &project.0.join(".cursor/skills"),
            "cursor-only",
            "---\nname: cursor-only\ndescription: Cursor native\n---\n",
        );

        let skills = list_skills_from(&project.0, Some(&home.0));
        let ship = skills.iter().find(|s| s.name == "ship").unwrap();
        assert_eq!(ship.description, "wavex ship");
        assert_eq!(ship.source, "agents");
        assert_eq!(ship.scope, "project");

        let greet = skills.iter().find(|s| s.name == "greet").unwrap();
        assert_eq!(greet.scope, "user");
        assert_eq!(greet.source, "agents");

        let native = skills.iter().find(|s| s.name == "cursor-only").unwrap();
        assert_eq!(native.source, "cursor");
        assert_eq!(native.scope, "project");
    }

    #[test]
    fn discovers_pi_project_and_user_skills() {
        let project = tmp("proj-pi");
        let home = tmp("home-pi");
        write_skill(
            &project.0.join(".pi/skills"),
            "pi-review",
            "---\nname: pi-review\ndescription: Pi project skill\n---\n",
        );
        write_skill(
            &home.0.join(".pi/agent/skills"),
            "pi-global",
            "---\nname: pi-global\ndescription: Pi user skill\n---\n",
        );

        let skills = list_skills_from(&project.0, Some(&home.0));
        let project_skill = skills.iter().find(|s| s.name == "pi-review").unwrap();
        assert_eq!(project_skill.source, "pi");
        assert_eq!(project_skill.scope, "project");
        let user_skill = skills.iter().find(|s| s.name == "pi-global").unwrap();
        assert_eq!(user_skill.source, "pi");
        assert_eq!(user_skill.scope, "user");
    }

    #[test]
    fn discovers_fx_project_and_user_skills() {
        let project = tmp("proj-fx");
        let home = tmp("home-fx");
        write_skill(
            &project.0.join(".fx/skills"),
            "fx-review",
            "---\nname: fx-review\ndescription: fx project skill\n---\n",
        );
        write_skill(
            &home.0.join(".fx/skills"),
            "fx-global",
            "---\nname: fx-global\ndescription: fx user skill\n---\n",
        );

        let skills = list_skills_from(&project.0, Some(&home.0));
        let project_skill = skills.iter().find(|s| s.name == "fx-review").unwrap();
        assert_eq!(project_skill.source, "fx");
        assert_eq!(project_skill.scope, "project");
        let user_skill = skills.iter().find(|s| s.name == "fx-global").unwrap();
        assert_eq!(user_skill.source, "fx");
        assert_eq!(user_skill.scope, "user");
    }

    #[test]
    fn discovers_grok_project_and_user_skills() {
        let project = tmp("proj-grok");
        let home = tmp("home-grok");
        write_skill(
            &project.0.join(".grok/skills"),
            "grok-review",
            "---\nname: grok-review\ndescription: grok project skill\n---\n",
        );
        write_skill(
            &home.0.join(".grok/skills"),
            "grok-global",
            "---\nname: grok-global\ndescription: grok user skill\n---\n",
        );

        let skills = list_skills_from(&project.0, Some(&home.0));
        let project_skill = skills.iter().find(|s| s.name == "grok-review").unwrap();
        assert_eq!(project_skill.source, "grok");
        assert_eq!(project_skill.scope, "project");
        let user_skill = skills.iter().find(|s| s.name == "grok-global").unwrap();
        assert_eq!(user_skill.source, "grok");
        assert_eq!(user_skill.scope, "user");
    }

    #[test]
    fn discovers_installed_claude_plugin_skills() {
        let project = tmp("proj-claude-plugin");
        let home = tmp("home-claude-plugin");
        let plugin = home
            .0
            .join(".claude/plugins/cache/community/workflow-kit/1.2.3");
        write_skill(
            &plugin.join("skills"),
            "quick-plan",
            "---\nname: quick-plan\ndescription: Plan from plugin\n---\n",
        );
        write_skill(
            &home.0.join(".claude/skills"),
            "quick-plan",
            "---\nname: quick-plan\ndescription: Personal plan\n---\n",
        );
        std::fs::create_dir_all(home.0.join(".claude/plugins")).unwrap();
        std::fs::write(
            home.0.join(".claude/plugins/installed_plugins.json"),
            r#"{"version":2,"plugins":{"workflow-kit@community":[{"scope":"user","installPath":"~/.claude/plugins/cache/community/workflow-kit/1.2.3","version":"1.2.3"}]}}"#,
        )
        .unwrap();

        let skills = list_skills_from(&project.0, Some(&home.0));
        let skill = skills
            .iter()
            .find(|skill| skill.name == "workflow-kit:quick-plan")
            .unwrap();
        assert_eq!(skill.description, "Plan from plugin");
        assert_eq!(skill.source, "claude");
        assert_eq!(skill.scope, "user");
        assert!(skill
            .path
            .ends_with("workflow-kit/1.2.3/skills/quick-plan/SKILL.md"));
        assert!(skills.iter().any(|skill| skill.name == "quick-plan"));
    }

    #[test]
    fn claude_project_plugins_only_apply_to_their_project() {
        let project = tmp("proj-claude-scoped");
        let other = tmp("other-claude-scoped");
        let home = tmp("home-claude-scoped");
        let plugin = home
            .0
            .join(".claude/plugins/cache/community/workflow-kit/2.0.0");
        write_skill(
            &plugin.join("skills"),
            "feature-delivery",
            "---\nname: feature-delivery\ndescription: Deliver feature\n---\n",
        );
        std::fs::create_dir_all(home.0.join(".claude/plugins")).unwrap();
        let registry = serde_json::json!({
            "version": 2,
            "plugins": {
                "workflow-kit@community": [{
                    "scope": "project",
                    "projectPath": project.0.to_string_lossy(),
                    "installPath": plugin.to_string_lossy(),
                    "version": "2.0.0"
                }]
            }
        });
        std::fs::write(
            home.0.join(".claude/plugins/installed_plugins.json"),
            serde_json::to_vec(&registry).unwrap(),
        )
        .unwrap();

        let nested = project.0.join("src");
        std::fs::create_dir_all(&nested).unwrap();
        let matching = list_skills_from(&nested, Some(&home.0));
        let skill = matching
            .iter()
            .find(|skill| skill.name == "workflow-kit:feature-delivery")
            .unwrap();
        assert_eq!(skill.scope, "project");

        let unrelated = list_skills_from(&other.0, Some(&home.0));
        assert!(!unrelated
            .iter()
            .any(|skill| skill.name == "workflow-kit:feature-delivery"));
    }

    #[test]
    fn disabled_claude_plugin_skills_are_hidden() {
        let project = tmp("proj-claude-disabled");
        let home = tmp("home-claude-disabled");
        let plugin = home
            .0
            .join(".claude/plugins/cache/community/workflow-kit/1.2.3");
        write_skill(
            &plugin.join("skills"),
            "quick-plan",
            "---\nname: quick-plan\ndescription: Plan from plugin\n---\n",
        );
        std::fs::create_dir_all(home.0.join(".claude/plugins")).unwrap();
        std::fs::write(
            home.0.join(".claude/plugins/installed_plugins.json"),
            r#"{"version":2,"plugins":{"workflow-kit@community":[{"scope":"user","installPath":"~/.claude/plugins/cache/community/workflow-kit/1.2.3","version":"1.2.3"}]}}"#,
        )
        .unwrap();
        write_plugin_setting(&home.0, "settings.json", "workflow-kit@community", false);

        let skills = list_skills_from(&project.0, Some(&home.0));
        assert!(!skills
            .iter()
            .any(|skill| skill.name == "workflow-kit:quick-plan"));
    }

    #[test]
    fn claude_plugin_enablement_uses_local_project_user_precedence() {
        let project = tmp("proj-claude-precedence");
        let nested = project.0.join("src");
        let home = tmp("home-claude-precedence");
        std::fs::create_dir_all(&nested).unwrap();
        write_plugin_setting(&home.0, "settings.json", "workflow-kit@community", false);
        write_plugin_setting(&project.0, "settings.json", "workflow-kit@community", true);
        assert!(claude_plugin_enabled(
            &home.0,
            &nested,
            "workflow-kit@community"
        ));
        write_plugin_setting(
            &project.0,
            "settings.local.json",
            "workflow-kit@community",
            false,
        );
        assert!(!claude_plugin_enabled(
            &home.0,
            &nested,
            "workflow-kit@community"
        ));
    }

    #[test]
    fn managed_plugin_settings_apply_dropins_in_order() {
        let root = tmp("managed-settings");
        let plugin_id = "workflow-kit@community";
        let base = serde_json::json!({ "enabledPlugins": { plugin_id: true } });
        std::fs::write(
            root.0.join("managed-settings.json"),
            serde_json::to_vec(&base).unwrap(),
        )
        .unwrap();
        let dropins = root.0.join("managed-settings.d");
        std::fs::create_dir_all(&dropins).unwrap();
        let earlier = serde_json::json!({ "enabledPlugins": { plugin_id: true } });
        let later = serde_json::json!({ "enabledPlugins": { plugin_id: false } });
        std::fs::write(
            dropins.join("10-enable.json"),
            serde_json::to_vec(&earlier).unwrap(),
        )
        .unwrap();
        std::fs::write(
            dropins.join("20-disable.json"),
            serde_json::to_vec(&later).unwrap(),
        )
        .unwrap();

        assert_eq!(
            managed_plugin_setting_from_root(&root.0, plugin_id),
            Some(false)
        );
    }

    #[test]
    fn path_is_within_fails_closed_when_either_path_is_missing() {
        let root = tmp("path-root");
        let nested = root.0.join("src");
        std::fs::create_dir_all(&nested).unwrap();
        assert!(path_is_within(&nested, &root.0));
        assert!(!path_is_within(&root.0.join("missing"), &root.0));
        assert!(!path_is_within(&nested, &root.0.join("missing")));
    }

    #[test]
    fn ignores_unregistered_claude_plugin_cache_versions() {
        let project = tmp("proj-claude-stale");
        let home = tmp("home-claude-stale");
        let stale = home
            .0
            .join(".claude/plugins/cache/community/workflow-kit/0.9.0");
        write_skill(
            &stale.join("skills"),
            "stale-skill",
            "---\nname: stale-skill\ndescription: Old cached skill\n---\n",
        );
        std::fs::create_dir_all(home.0.join(".claude/plugins")).unwrap();
        std::fs::write(
            home.0.join(".claude/plugins/installed_plugins.json"),
            r#"{"version":2,"plugins":{}}"#,
        )
        .unwrap();

        let skills = list_skills_from(&project.0, Some(&home.0));
        assert!(!skills.iter().any(|skill| skill.name == "stale-skill"));
    }

    #[test]
    fn details_group_one_skill_across_every_agent_it_is_installed_in() {
        let project = tmp("proj-details");
        let home = tmp("home-details");
        write_skill(
            &home.0.join(".agents/skills"),
            "ship",
            "---\nname: ship\ndescription: Ship it\nallowed-tools:\n  - Read\n  - Write\n---\nbody\n",
        );
        write_skill(
            &home.0.join(".claude/skills"),
            "ship",
            "---\nname: ship\ndescription: Ship it\n---\nbody\n",
        );

        let details = skill_details_from(&project.0, Some(&home.0));
        let ship = details.iter().find(|d| d.name == "ship").unwrap();
        assert!(ship.enabled);
        assert_eq!(ship.tools, ["Read", "Write"]);
        assert!(ship.bytes > 0);
        let sources: Vec<&str> = ship
            .installs
            .iter()
            .map(|install| install.source.as_str())
            .collect();
        assert_eq!(sources, ["agents", "claude"]);
    }

    #[test]
    fn disabling_hides_a_skill_from_every_agent_and_enabling_brings_it_back() {
        let project = tmp("proj-toggle");
        let home = tmp("home-toggle");
        let dir = home.0.join(".agents/skills/ship");
        write_skill(
            &home.0.join(".agents/skills"),
            "ship",
            "---\nname: ship\ndescription: Ship it\n---\n",
        );

        let path = crate::fs::path_to_js(&dir);
        set_skill_enabled_in(&project.0, Some(&home.0), vec![path.clone()], false).unwrap();
        assert!(dir.join("SKILL.md.off").is_file());
        assert!(!dir.join("SKILL.md").exists());
        assert!(!list_skills_from(&project.0, Some(&home.0))
            .iter()
            .any(|skill| skill.name == "ship"));

        let details = skill_details_from(&project.0, Some(&home.0));
        let ship = details.iter().find(|d| d.name == "ship").unwrap();
        assert!(!ship.enabled);

        set_skill_enabled_in(&project.0, Some(&home.0), vec![path], true).unwrap();
        assert!(dir.join("SKILL.md").is_file());
        assert!(list_skills_from(&project.0, Some(&home.0))
            .iter()
            .any(|skill| skill.name == "ship"));
    }

    #[test]
    fn a_path_outside_a_skills_folder_is_refused() {
        let home = tmp("home-guard");
        let dir = home.0.join("notes/ship");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), "---\nname: ship\n---\n").unwrap();
        let target = vec![crate::fs::path_to_js(&dir)];
        assert!(set_skill_enabled_in(&home.0, Some(&home.0), target.clone(), false).is_err());
        assert!(delete_skills_in(&home.0, Some(&home.0), target).is_err());
        assert!(dir.join("SKILL.md").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn deleting_takes_the_agent_links_before_the_folder_they_point_at() {
        let home = tmp("home-delete");
        let real = home.0.join(".agents/skills/ship");
        write_skill(
            &home.0.join(".agents/skills"),
            "ship",
            "---\nname: ship\ndescription: Ship it\n---\n",
        );
        let links = home.0.join(".claude/skills");
        std::fs::create_dir_all(&links).unwrap();
        let link = links.join("ship");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        // The link ahead of the folder is the order the detail pane sends,
        // because `.agents` is not always the first root a skill is found in.
        delete_skills_in(
            &home.0,
            Some(&home.0),
            vec![crate::fs::path_to_js(&link), crate::fs::path_to_js(&real)],
        )
        .unwrap();
        assert!(!real.exists());
        assert!(std::fs::symlink_metadata(&link).is_err());
    }

    #[test]
    fn a_plugin_owned_skill_cannot_be_switched_off_or_deleted() {
        let project = tmp("proj-managed");
        let home = tmp("home-managed");
        let plugin = home
            .0
            .join(".claude/plugins/cache/community/workflow-kit/1.2.3");
        write_skill(
            &plugin.join("skills"),
            "quick-plan",
            "---\nname: quick-plan\ndescription: Plan from plugin\n---\n",
        );
        std::fs::create_dir_all(home.0.join(".claude/plugins")).unwrap();
        std::fs::write(
            home.0.join(".claude/plugins/installed_plugins.json"),
            r#"{"version":2,"plugins":{"workflow-kit@community":[{"scope":"user","installPath":"~/.claude/plugins/cache/community/workflow-kit/1.2.3","version":"1.2.3"}]}}"#,
        )
        .unwrap();

        let details = skill_details_from(&project.0, Some(&home.0));
        let skill = details
            .iter()
            .find(|detail| detail.name == "workflow-kit:quick-plan")
            .unwrap();
        assert!(skill.managed);

        let dir = plugin.join("skills/quick-plan");
        let target = vec![crate::fs::path_to_js(&dir)];
        assert!(set_skill_enabled_in(&project.0, Some(&home.0), target.clone(), false).is_err());
        assert!(delete_skills_in(&project.0, Some(&home.0), target).is_err());
        assert!(dir.join("SKILL.md").is_file());
    }

    #[test]
    fn strip_ansi_drops_colour_and_spinner_escapes() {
        assert_eq!(
            strip_ansi("\u{1b}[33mInvalid agents: bogus\u{1b}[0m\u{1b}[1G\u{1b}[Jdone"),
            "Invalid agents: bogusdone"
        );
    }

    #[test]
    fn skips_dirs_without_skill_md() {
        let project = tmp("empty");
        std::fs::create_dir_all(project.0.join(".agents/skills/nope")).unwrap();
        let skills = list_skills_from(&project.0, None);
        assert!(skills.is_empty());
    }
}
