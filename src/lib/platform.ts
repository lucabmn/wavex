/**
 * Two different machines answer "what platform is this?", and conflating them
 * is the bug wavex Link makes possible.
 *
 * The window, its chrome, its keyboard, and its native blur belong to the
 * machine drawing them — this client, whatever host a project lives on. A
 * user on a Mac presses ⌘ against a Linux host, so the shortcut labels stay
 * client-derived.
 *
 * Paths and the file manager belong to the host: it is the machine that owns
 * the checkout and the only one that can open a folder in it. Those read from
 * the connection instead.
 */
import { connectionSnapshot, getDefaultHostId, type HostPlatform } from "./transport";
import { isRemoteHostId, type HostId } from "./host";

// `navigator.platform` is deprecated but is the only synchronous read, and the
// window chrome has to pick its layout before the first paint.
const PLATFORM = typeof navigator === "undefined" ? "" : navigator.platform;
const USER_AGENT = typeof navigator === "undefined" ? "" : navigator.userAgent;

export const IS_MAC = /Mac|iPhone|iPad/.test(PLATFORM);
// WebView2 reports `Win32`; WebKitGTK reports `Linux x86_64`. The user agent is
// the fallback for a runtime that leaves `platform` empty.
export const IS_WINDOWS = !IS_MAC && /Win/.test(`${PLATFORM} ${USER_AGENT}`);
export const IS_LINUX = !IS_MAC && !IS_WINDOWS && /Linux|X11/.test(`${PLATFORM} ${USER_AGENT}`);

/**
 * The window is drawn on top of a native blur: macOS vibrancy or Windows
 * acrylic. Linux has no portable equivalent, so it keeps an opaque page — and
 * the CSS that makes `html` transparent must follow this, not `IS_MAC`.
 */
export const HAS_NATIVE_GLASS = IS_MAC || IS_WINDOWS;

export const MOD = IS_MAC ? "⌘" : "Ctrl+";
export const ALT = IS_MAC ? "⌥" : "Alt+";
export const SHIFT = IS_MAC ? "⇧" : "Shift+";

/**
 * The platform of the machine that owns a project's files. `unknown` — a host
 * that has not finished its handshake — falls back to this client so a label
 * reads as something rather than as nothing.
 */
export function hostPlatform(hostId: HostId = getDefaultHostId()): HostPlatform {
  const platform = connectionSnapshot(hostId).platform;
  if (platform !== "unknown") return platform;
  return IS_MAC ? "macos" : IS_WINDOWS ? "windows" : IS_LINUX ? "linux" : "unknown";
}

/** Menu label for handing a path to the OS file manager. */
export function revealLabel(hostId: HostId = getDefaultHostId()): string {
  switch (hostPlatform(hostId)) {
    case "macos":
      return "Reveal in Finder";
    case "windows":
      return "Reveal in File Explorer";
    default:
      return "Open Containing Folder";
  }
}

/**
 * The separator the host writes in its own paths. Everything above the Tauri
 * boundary keeps one slash direction (`slash`, `normalizeProjectPath`); this
 * is for text meant to read like a path on that machine.
 */
export function hostPathSeparator(hostId: HostId = getDefaultHostId()): string {
  return hostPlatform(hostId) === "windows" ? "\\" : "/";
}

/**
 * Whether handing a path to a file manager means anything for this project.
 *
 * A file manager opens on the machine that has a desktop in front of the user.
 * On a remote host it would open nowhere the user can see — and `reveal_path`
 * is deliberately not reachable over a connection — so the action is left out
 * rather than offered and then failing.
 */
export function canRevealPath(hostId: HostId = getDefaultHostId()): boolean {
  return !isRemoteHostId(hostId);
}

/**
 * Whether handing this project to another installed application means
 * anything.
 *
 * The same reasoning as `canRevealPath`: an editor or a terminal launches on
 * the machine that runs it, a remote host has nobody sitting in front of it,
 * and `list_open_with_apps` and `open_path_with` are deliberately not
 * reachable over a connection. The button is left out rather than offered.
 */
export function canOpenProjectIn(hostId: HostId = getDefaultHostId()): boolean {
  return !isRemoteHostId(hostId);
}
