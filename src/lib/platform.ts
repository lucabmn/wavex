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

/** Menu label for handing a path to the OS file manager. */
export const REVEAL_LABEL = IS_MAC
  ? "Reveal in Finder"
  : IS_WINDOWS
    ? "Reveal in File Explorer"
    : "Open Containing Folder";
