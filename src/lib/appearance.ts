import { invokeLocal as invoke } from "./transport";
import { HAS_NATIVE_GLASS, IS_MAC } from "./platform";
import { profileStorage } from "./profiles/profileStorage";
import { applyUiScale, loadUiScale } from "./uiScale";

const THEME_HUE_KEY = "wavex.themeHue";
const THEME_SATURATION_KEY = "wavex.themeSaturation";
const OPACITY_KEY = "wavex.sidebarOpacity";
const BLUR_KEY = "wavex.sidebarBlur";
const PROJECT_RAIL_OPEN_KEY = "wavex.projectRailOpen";
const BODY_KEY = "wavex.bodyGlass";
const SCHEME_KEY = "wavex.colorScheme";
const SIDEBAR_TAB_ORDER_KEY = "wavex.sidebarTabOrder";
const PROJECT_RAIL_WIDTH_KEY = "wavex.projectRailWidth";
const TRANSCRIPT_LAYOUT_KEY = "wavex.transcriptLayout";
const TRANSCRIPT_ANCHOR_KEY = "wavex.transcriptAnchor";

export type ColorScheme = "dark" | "light";
export type ThemePreference = ColorScheme | "system";
export type TranscriptLayout = "full" | "chat";

export const THEME_PREFERENCE_DEFAULT: ThemePreference = "dark";

/** Fired on `window` whenever the color scheme flips (detail: ColorScheme). */
export const SCHEME_CHANGE_EVENT = "wavex:schemechange";

export const TRANSCRIPT_LAYOUT_DEFAULT: TranscriptLayout = "full";

export const TRANSCRIPT_ANCHOR_DEFAULT = true;

/** Fired on `window` whenever prompt-to-top anchoring flips (detail: boolean). */
export const TRANSCRIPT_ANCHOR_CHANGE_EVENT = "wavex:transcriptanchorchange";

/** Fired on `window` whenever the transcript layout flips (detail: TranscriptLayout). */
export const TRANSCRIPT_LAYOUT_CHANGE_EVENT = "wavex:transcriptlayoutchange";

export type SidebarTabId = "files" | "sessions" | "changes" | "inbox";

const DEFAULT_SIDEBAR_TAB_ORDER: SidebarTabId[] = ["sessions", "inbox", "files", "changes"];

export const THEME_HUE_MIN = 0;
export const THEME_HUE_MAX = 360;
export const THEME_HUE_DEFAULT = 220;

export const THEME_SATURATION_MIN = 0;
export const THEME_SATURATION_MAX = 100;
export const THEME_SATURATION_DEFAULT = 6;

export const SIDEBAR_OPACITY_MIN = 0.15;
export const SIDEBAR_OPACITY_MAX = 1;
export const SIDEBAR_OPACITY_DEFAULT = 0.8;

export const SIDEBAR_BLUR_MIN = 1;
export const SIDEBAR_BLUR_MAX = 64;
export const SIDEBAR_BLUR_DEFAULT = 24;

export const PROJECT_RAIL_WIDTH_MIN = 180;
export const PROJECT_RAIL_WIDTH_MAX = 360;
export const PROJECT_RAIL_WIDTH_DEFAULT = 200;

export const BODY_GLASS_DEFAULT = true;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readNumber(key: string): number | null {
  try {
    const raw = profileStorage.getItem(key);
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, value: number) {
  try {
    profileStorage.setItem(key, String(value));
  } catch {
    // private mode / quota
  }
}

function readFlag(key: string): boolean | null {
  try {
    const raw = profileStorage.getItem(key);
    if (raw == null) return null;
    return raw === "1" || raw === "true";
  } catch {
    return null;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    profileStorage.setItem(key, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
}

export function loadThemeHue(): number {
  return Math.round(
    clamp(readNumber(THEME_HUE_KEY) ?? THEME_HUE_DEFAULT, THEME_HUE_MIN, THEME_HUE_MAX),
  );
}

export function saveThemeHue(value: number) {
  writeNumber(THEME_HUE_KEY, Math.round(clamp(value, THEME_HUE_MIN, THEME_HUE_MAX)));
}

export function loadThemeSaturation(): number {
  return Math.round(
    clamp(
      readNumber(THEME_SATURATION_KEY) ?? THEME_SATURATION_DEFAULT,
      THEME_SATURATION_MIN,
      THEME_SATURATION_MAX,
    ),
  );
}

export function saveThemeSaturation(value: number) {
  writeNumber(
    THEME_SATURATION_KEY,
    Math.round(clamp(value, THEME_SATURATION_MIN, THEME_SATURATION_MAX)),
  );
}

export function applyThemeTint(hue: number, saturation: number) {
  const nextHue = Math.round(clamp(hue, THEME_HUE_MIN, THEME_HUE_MAX));
  const nextSaturation = Math.round(clamp(saturation, THEME_SATURATION_MIN, THEME_SATURATION_MAX));
  document.documentElement.style.setProperty("--theme-hue", String(nextHue));
  document.documentElement.style.setProperty("--theme-saturation", `${nextSaturation}%`);
  return { hue: nextHue, saturation: nextSaturation };
}

export function initAppearance() {
  document.documentElement.classList.toggle("is-mac", IS_MAC);
  document.documentElement.classList.toggle("has-native-glass", HAS_NATIVE_GLASS);
  applyThemeTint(loadThemeHue(), loadThemeSaturation());
  applyAccentHue(loadAccentHue());
  applyUiFont(loadUiFont());
  applyMonoFont(loadMonoFont());
  applyEditorFontSize(loadEditorFontSize());
  applyCornerRadius(loadCornerRadius());
  applySurfaceDepth(loadSurfaceDepth());
  applySeparators(loadSeparators());
  applyReduceMotion(loadReduceMotion());
  applyTranscriptWidth(loadTranscriptWidth());
  applyTranscriptFontSize(loadTranscriptFontSize());
  applyTranscriptSpacing(loadTranscriptSpacing());
  applyThemePreference(loadThemePreference());
  watchSystemColorScheme();
  applySidebarOpacity(loadSidebarOpacity());
  applySidebarBlur(loadSidebarBlur());
  applyBodyGlass(loadBodyGlass());
  void applyUiScale(loadUiScale());
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system";
}

export function loadThemePreference(): ThemePreference {
  try {
    const raw = profileStorage.getItem(SCHEME_KEY);
    return isThemePreference(raw) ? raw : THEME_PREFERENCE_DEFAULT;
  } catch {
    return THEME_PREFERENCE_DEFAULT;
  }
}

export function saveThemePreference(value: ThemePreference) {
  try {
    profileStorage.setItem(SCHEME_KEY, value);
  } catch {
    // private mode / quota
  }
}

function systemQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  return window.matchMedia("(prefers-color-scheme: light)");
}

function systemColorScheme(): ColorScheme {
  return systemQuery()?.matches ? "light" : "dark";
}

export function resolveColorScheme(value: ThemePreference): ColorScheme {
  return value === "system" ? systemColorScheme() : value;
}

export function isLightScheme(): boolean {
  return document.documentElement.classList.contains("theme-light");
}

export function applyThemePreference(value: ThemePreference): ColorScheme {
  const next = resolveColorScheme(value);
  document.documentElement.classList.toggle("theme-light", next === "light");
  // Background and text lightness are stored per scheme, so the flip has to
  // repoint them before anything repaints against the old pair.
  applySurfaceLightness(next);
  window.dispatchEvent(new CustomEvent<ColorScheme>(SCHEME_CHANGE_EVENT, { detail: next }));
  return next;
}

/** Keeps the "system" preference in sync when the OS flips appearance. */
export function watchSystemColorScheme() {
  const query = systemQuery();
  if (!query) return;
  query.addEventListener("change", () => {
    const preference = loadThemePreference();
    if (preference === "system") applyThemePreference(preference);
  });
}

export function loadSidebarOpacity(): number {
  return clamp(
    readNumber(OPACITY_KEY) ?? SIDEBAR_OPACITY_DEFAULT,
    SIDEBAR_OPACITY_MIN,
    SIDEBAR_OPACITY_MAX,
  );
}

export function saveSidebarOpacity(value: number) {
  writeNumber(OPACITY_KEY, clamp(value, SIDEBAR_OPACITY_MIN, SIDEBAR_OPACITY_MAX));
}

export function applySidebarOpacity(value: number) {
  const next = clamp(value, SIDEBAR_OPACITY_MIN, SIDEBAR_OPACITY_MAX);
  document.documentElement.style.setProperty("--sidebar-opacity", String(next));
  return next;
}

export function loadSidebarBlur(): number {
  return Math.round(
    clamp(readNumber(BLUR_KEY) ?? SIDEBAR_BLUR_DEFAULT, SIDEBAR_BLUR_MIN, SIDEBAR_BLUR_MAX),
  );
}

export function saveSidebarBlur(value: number) {
  writeNumber(BLUR_KEY, Math.round(clamp(value, SIDEBAR_BLUR_MIN, SIDEBAR_BLUR_MAX)));
}

export function applySidebarBlur(value: number) {
  const next = Math.round(clamp(value, SIDEBAR_BLUR_MIN, SIDEBAR_BLUR_MAX));
  // Native blur belongs to the machine drawing the window; a browser tab has
  // none, and asking for it is a no-op rather than a failure.
  void invoke("set_window_background_blur", { radius: next }).catch(() => undefined);
  return next;
}

export function loadBodyGlass(): boolean {
  return readFlag(BODY_KEY) ?? BODY_GLASS_DEFAULT;
}

export function saveBodyGlass(value: boolean) {
  writeFlag(BODY_KEY, value);
}

export function applyBodyGlass(value: boolean) {
  document.documentElement.classList.toggle("glass-body", value);
  return value;
}

function isSidebarTabId(value: unknown): value is SidebarTabId {
  return value === "files" || value === "sessions" || value === "changes" || value === "inbox";
}

export function loadProjectRailOpen(): boolean {
  return readFlag(PROJECT_RAIL_OPEN_KEY) ?? true;
}

export function saveProjectRailOpen(value: boolean) {
  writeFlag(PROJECT_RAIL_OPEN_KEY, value);
}

export function loadSidebarTabOrder(): SidebarTabId[] {
  try {
    const raw = profileStorage.getItem(SIDEBAR_TAB_ORDER_KEY);
    if (!raw) return [...DEFAULT_SIDEBAR_TAB_ORDER];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_SIDEBAR_TAB_ORDER];
    const next = parsed.filter(isSidebarTabId);
    for (const id of DEFAULT_SIDEBAR_TAB_ORDER) {
      if (!next.includes(id)) next.push(id);
    }
    return next.length === DEFAULT_SIDEBAR_TAB_ORDER.length ? next : [...DEFAULT_SIDEBAR_TAB_ORDER];
  } catch {
    return [...DEFAULT_SIDEBAR_TAB_ORDER];
  }
}

export function saveSidebarTabOrder(order: SidebarTabId[]) {
  try {
    profileStorage.setItem(SIDEBAR_TAB_ORDER_KEY, JSON.stringify(order));
  } catch {
    // private mode / quota
  }
}

export function loadProjectRailWidth(): number {
  return Math.round(
    clamp(
      readNumber(PROJECT_RAIL_WIDTH_KEY) ?? PROJECT_RAIL_WIDTH_DEFAULT,
      PROJECT_RAIL_WIDTH_MIN,
      PROJECT_RAIL_WIDTH_MAX,
    ),
  );
}

export function saveProjectRailWidth(value: number) {
  writeNumber(
    PROJECT_RAIL_WIDTH_KEY,
    Math.round(clamp(value, PROJECT_RAIL_WIDTH_MIN, PROJECT_RAIL_WIDTH_MAX)),
  );
}

function isTranscriptLayout(value: unknown): value is TranscriptLayout {
  return value === "full" || value === "chat";
}

export function loadTranscriptLayout(): TranscriptLayout {
  try {
    const raw = profileStorage.getItem(TRANSCRIPT_LAYOUT_KEY);
    return isTranscriptLayout(raw) ? raw : TRANSCRIPT_LAYOUT_DEFAULT;
  } catch {
    return TRANSCRIPT_LAYOUT_DEFAULT;
  }
}

export function saveTranscriptLayout(value: TranscriptLayout) {
  const next = isTranscriptLayout(value) ? value : TRANSCRIPT_LAYOUT_DEFAULT;
  try {
    profileStorage.setItem(TRANSCRIPT_LAYOUT_KEY, next);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TranscriptLayout>(TRANSCRIPT_LAYOUT_CHANGE_EVENT, {
      detail: next,
    }),
  );
}

export function loadTranscriptAnchor(): boolean {
  return readFlag(TRANSCRIPT_ANCHOR_KEY) ?? TRANSCRIPT_ANCHOR_DEFAULT;
}

export function saveTranscriptAnchor(value: boolean) {
  writeFlag(TRANSCRIPT_ANCHOR_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(TRANSCRIPT_ANCHOR_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

/* ------------------------------------------------------------------ *
 * Accent, typography, surface lightness, radius, motion.
 *
 * Everything below writes a CSS custom property (or a root class) that
 * `index.css` reads, so a control that exists here changes something on
 * screen. `initAppearance` re-applies all of it on boot; a setting missing
 * from there silently resets each launch.
 * ------------------------------------------------------------------ */

const ACCENT_HUE_KEY = "wavex.accentHue";
const UI_FONT_KEY = "wavex.uiFont";
const MONO_FONT_KEY = "wavex.monoFont";
const EDITOR_FONT_SIZE_KEY = "wavex.editorFontSize";
const TERMINAL_FONT_SIZE_KEY = "wavex.terminalFontSize";
const TERMINAL_CURSOR_KEY = "wavex.terminalCursor";
const TERMINAL_CURSOR_BLINK_KEY = "wavex.terminalCursorBlink";
const CORNER_RADIUS_KEY = "wavex.cornerRadius";
const SURFACE_DEPTH_KEY = "wavex.surfaceDepth";
const RULE_KEY = "wavex.separators";
const REDUCE_MOTION_KEY = "wavex.reduceMotion";
const BACKGROUND_LIGHTNESS_KEY = "wavex.backgroundLightness";
const CONTENT_LIGHTNESS_KEY = "wavex.contentLightness";

/**
 * Fired on `window` when a setting a live widget has already read applies —
 * the terminal reads its font and cursor once, at construction.
 */
export const APPEARANCE_CHANGE_EVENT = "wavex:appearancechange";

function announceAppearance() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(APPEARANCE_CHANGE_EVENT));
}

export function subscribeAppearance(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(APPEARANCE_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(APPEARANCE_CHANGE_EVENT, onStoreChange);
}

export const ACCENT_HUE_MIN = 0;
export const ACCENT_HUE_MAX = 360;
export const ACCENT_HUE_DEFAULT = 232;

/** Named stops on the accent wheel, so the common choice is one click. */
export const ACCENT_PRESETS: { hue: number; label: string }[] = [
  { hue: 232, label: "Indigo" },
  { hue: 262, label: "Violet" },
  { hue: 300, label: "Mauve" },
  { hue: 338, label: "Rose" },
  { hue: 12, label: "Clay" },
  { hue: 38, label: "Amber" },
  { hue: 88, label: "Olive" },
  { hue: 152, label: "Green" },
  { hue: 182, label: "Teal" },
  { hue: 204, label: "Blue" },
];

export function loadAccentHue(): number {
  return Math.round(
    clamp(readNumber(ACCENT_HUE_KEY) ?? ACCENT_HUE_DEFAULT, ACCENT_HUE_MIN, ACCENT_HUE_MAX),
  );
}

export function saveAccentHue(value: number) {
  writeNumber(ACCENT_HUE_KEY, Math.round(clamp(value, ACCENT_HUE_MIN, ACCENT_HUE_MAX)));
}

export function applyAccentHue(value: number) {
  const next = Math.round(clamp(value, ACCENT_HUE_MIN, ACCENT_HUE_MAX));
  document.documentElement.style.setProperty("--accent-hue", String(next));
  return next;
}

export type FontChoice = {
  id: string;
  label: string;
  /** Empty keeps the platform stack the app ships with. */
  stack: string;
};

/**
 * wavex ships no fonts, so every entry is a family the user may already have
 * with the shipped stack behind it. A missing family falls through.
 */
export const UI_FONTS: FontChoice[] = [
  { id: "system", label: "System", stack: "" },
  { id: "inter", label: "Inter", stack: "Inter" },
  { id: "geist", label: "Geist", stack: "Geist, Geist Sans" },
  { id: "helvetica", label: "Helvetica", stack: "Helvetica Neue, Helvetica" },
  { id: "ibm-plex", label: "IBM Plex Sans", stack: "IBM Plex Sans" },
  { id: "roboto", label: "Roboto", stack: "Roboto" },
  { id: "source-sans", label: "Source Sans 3", stack: "Source Sans 3, Source Sans Pro" },
  { id: "serif", label: "Serif", stack: "Iowan Old Style, Palatino, Georgia" },
];

export const MONO_FONTS: FontChoice[] = [
  { id: "system", label: "System", stack: "" },
  { id: "jetbrains", label: "JetBrains Mono", stack: "JetBrains Mono" },
  { id: "fira", label: "Fira Code", stack: "Fira Code" },
  { id: "cascadia", label: "Cascadia Code", stack: "Cascadia Code, Cascadia Mono" },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", stack: "IBM Plex Mono" },
  { id: "source-code", label: "Source Code Pro", stack: "Source Code Pro" },
  { id: "sf-mono", label: "SF Mono", stack: "SF Mono, SFMono-Regular" },
  { id: "menlo", label: "Menlo", stack: "Menlo" },
];

export const UI_FONT_DEFAULT = "system";
export const MONO_FONT_DEFAULT = "system";

const UI_FONT_FALLBACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif';
const MONO_FONT_FALLBACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const SYSTEM_FONT: FontChoice = { id: "system", label: "System", stack: "" };

function fontChoice(choices: FontChoice[], id: string): FontChoice {
  return choices.find((choice) => choice.id === id) ?? SYSTEM_FONT;
}

function fontStack(choice: FontChoice, fallback: string): string {
  if (!choice.stack) return fallback;
  const named = choice.stack
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (/[^a-zA-Z0-9-]/.test(part) ? `"${part}"` : part))
    .join(", ");
  return `${named}, ${fallback}`;
}

function loadFontId(key: string, choices: FontChoice[], fallback: string): string {
  try {
    const raw = profileStorage.getItem(key);
    return choices.some((choice) => choice.id === raw) ? (raw as string) : fallback;
  } catch {
    return fallback;
  }
}

export function loadUiFont(): string {
  return loadFontId(UI_FONT_KEY, UI_FONTS, UI_FONT_DEFAULT);
}

export function saveUiFont(id: string) {
  try {
    profileStorage.setItem(UI_FONT_KEY, id);
  } catch {
    // private mode / quota
  }
}

export function applyUiFont(id: string) {
  const choice = fontChoice(UI_FONTS, id);
  document.documentElement.style.setProperty("--font-sans", fontStack(choice, UI_FONT_FALLBACK));
  announceAppearance();
  return choice.id;
}

export function loadMonoFont(): string {
  return loadFontId(MONO_FONT_KEY, MONO_FONTS, MONO_FONT_DEFAULT);
}

export function saveMonoFont(id: string) {
  try {
    profileStorage.setItem(MONO_FONT_KEY, id);
  } catch {
    // private mode / quota
  }
}

export function applyMonoFont(id: string) {
  const choice = fontChoice(MONO_FONTS, id);
  document.documentElement.style.setProperty("--font-mono", fontStack(choice, MONO_FONT_FALLBACK));
  announceAppearance();
  return choice.id;
}

export const EDITOR_FONT_SIZE_MIN = 10;
export const EDITOR_FONT_SIZE_MAX = 22;
export const EDITOR_FONT_SIZE_DEFAULT = 13;

export function loadEditorFontSize(): number {
  return Math.round(
    clamp(
      readNumber(EDITOR_FONT_SIZE_KEY) ?? EDITOR_FONT_SIZE_DEFAULT,
      EDITOR_FONT_SIZE_MIN,
      EDITOR_FONT_SIZE_MAX,
    ),
  );
}

export function saveEditorFontSize(value: number) {
  writeNumber(
    EDITOR_FONT_SIZE_KEY,
    Math.round(clamp(value, EDITOR_FONT_SIZE_MIN, EDITOR_FONT_SIZE_MAX)),
  );
}

export function applyEditorFontSize(value: number) {
  const next = Math.round(clamp(value, EDITOR_FONT_SIZE_MIN, EDITOR_FONT_SIZE_MAX));
  document.documentElement.style.setProperty("--editor-font-size", `${next}px`);
  // CodeMirror caches the character box it measured. Repainting at a new size
  // without telling it leaves the caret and the gutter on the old grid.
  announceAppearance();
  return next;
}

export const TERMINAL_FONT_SIZE_MIN = 9;
export const TERMINAL_FONT_SIZE_MAX = 22;
export const TERMINAL_FONT_SIZE_DEFAULT = 13;

export function loadTerminalFontSize(): number {
  return Math.round(
    clamp(
      readNumber(TERMINAL_FONT_SIZE_KEY) ?? TERMINAL_FONT_SIZE_DEFAULT,
      TERMINAL_FONT_SIZE_MIN,
      TERMINAL_FONT_SIZE_MAX,
    ),
  );
}

export function saveTerminalFontSize(value: number) {
  writeNumber(
    TERMINAL_FONT_SIZE_KEY,
    Math.round(clamp(value, TERMINAL_FONT_SIZE_MIN, TERMINAL_FONT_SIZE_MAX)),
  );
  announceAppearance();
}

export type TerminalCursor = "bar" | "block" | "underline";

export const TERMINAL_CURSOR_DEFAULT: TerminalCursor = "bar";
export const TERMINAL_CURSOR_BLINK_DEFAULT = true;

function isTerminalCursor(value: unknown): value is TerminalCursor {
  return value === "bar" || value === "block" || value === "underline";
}

export function loadTerminalCursor(): TerminalCursor {
  try {
    const raw = profileStorage.getItem(TERMINAL_CURSOR_KEY);
    return isTerminalCursor(raw) ? raw : TERMINAL_CURSOR_DEFAULT;
  } catch {
    return TERMINAL_CURSOR_DEFAULT;
  }
}

export function saveTerminalCursor(value: TerminalCursor) {
  try {
    profileStorage.setItem(
      TERMINAL_CURSOR_KEY,
      isTerminalCursor(value) ? value : TERMINAL_CURSOR_DEFAULT,
    );
  } catch {
    // private mode / quota
  }
  announceAppearance();
}

export function loadTerminalCursorBlink(): boolean {
  return readFlag(TERMINAL_CURSOR_BLINK_KEY) ?? TERMINAL_CURSOR_BLINK_DEFAULT;
}

export function saveTerminalCursorBlink(value: boolean) {
  writeFlag(TERMINAL_CURSOR_BLINK_KEY, value);
  announceAppearance();
}

export type CornerRadius = "sharp" | "soft" | "round";

export const CORNER_RADIUS_DEFAULT: CornerRadius = "soft";

const RADIUS_SCALE: Record<CornerRadius, number> = {
  sharp: 0.3,
  soft: 1,
  round: 1.9,
};

/**
 * Tailwind's `rounded-*` utilities resolve to these theme variables, so one
 * factor moves every corner in the app rather than a hand-picked few.
 * `rounded-full` is a literal 9999px and stays a pill.
 *
 * The steps grow faster than Tailwind's so a row, a card and a dialog read as
 * three sizes of thing rather than three boxes with nearly the same corner.
 */
const RADIUS_TOKENS: [token: string, rem: number][] = [
  ["--radius-xs", 0.125],
  ["--radius-sm", 0.25],
  ["--radius-md", 0.375],
  ["--radius-lg", 0.5625],
  ["--radius-xl", 0.75],
  ["--radius-2xl", 1],
  ["--radius-3xl", 1.25],
  ["--radius-4xl", 1.5],
];

function isCornerRadius(value: unknown): value is CornerRadius {
  return value === "sharp" || value === "soft" || value === "round";
}

export function loadCornerRadius(): CornerRadius {
  try {
    const raw = profileStorage.getItem(CORNER_RADIUS_KEY);
    return isCornerRadius(raw) ? raw : CORNER_RADIUS_DEFAULT;
  } catch {
    return CORNER_RADIUS_DEFAULT;
  }
}

export function saveCornerRadius(value: CornerRadius) {
  try {
    profileStorage.setItem(
      CORNER_RADIUS_KEY,
      isCornerRadius(value) ? value : CORNER_RADIUS_DEFAULT,
    );
  } catch {
    // private mode / quota
  }
}

export function applyCornerRadius(value: CornerRadius) {
  const next = isCornerRadius(value) ? value : CORNER_RADIUS_DEFAULT;
  const factor = RADIUS_SCALE[next];
  for (const [token, rem] of RADIUS_TOKENS) {
    document.documentElement.style.setProperty(token, `${(rem * factor).toFixed(3)}rem`);
  }
  return next;
}

/* ------------------------------------------------------------------ *
 * Depth and the ambient wash — the two rules that decide how much of the
 * redesign's dimensionality is on. Both are plain display preferences: a
 * user who wants a flat, quiet window turns them down and every panel in the
 * app follows, because the shadows and the wash are single tokens rather
 * than values repeated per component.
 * ------------------------------------------------------------------ */

export type SurfaceDepth = "flat" | "soft" | "deep";

export const SURFACE_DEPTH_DEFAULT: SurfaceDepth = "soft";

function isSurfaceDepth(value: unknown): value is SurfaceDepth {
  return value === "flat" || value === "soft" || value === "deep";
}

export function loadSurfaceDepth(): SurfaceDepth {
  try {
    const raw = profileStorage.getItem(SURFACE_DEPTH_KEY);
    return isSurfaceDepth(raw) ? raw : SURFACE_DEPTH_DEFAULT;
  } catch {
    return SURFACE_DEPTH_DEFAULT;
  }
}

export function saveSurfaceDepth(value: SurfaceDepth) {
  try {
    profileStorage.setItem(
      SURFACE_DEPTH_KEY,
      isSurfaceDepth(value) ? value : SURFACE_DEPTH_DEFAULT,
    );
  } catch {
    // private mode / quota
  }
}

/**
 * `soft` is the value the stylesheet already carries, so it is the absence of
 * a class rather than a third set of shadows to keep in step with the other
 * two.
 */
export function applySurfaceDepth(value: SurfaceDepth) {
  const next = isSurfaceDepth(value) ? value : SURFACE_DEPTH_DEFAULT;
  const root = document.documentElement.classList;
  root.toggle("depth-flat", next === "flat");
  root.toggle("depth-deep", next === "deep");
  return next;
}

export type Separators = "subtle" | "regular" | "firm";

export const SEPARATORS_DEFAULT: Separators = "regular";

/**
 * How strongly every hairline in the app is drawn. It is a single number the
 * stylesheet multiplies, rather than a per-component border opacity, because
 * a rule around every box is the difference between chrome and a wireframe —
 * and that judgement is the user's, not one to hard-code a hundred times.
 */
const RULE_STRENGTH: Record<Separators, number> = {
  subtle: 0.05,
  regular: 0.09,
  firm: 0.15,
};

function isSeparators(value: unknown): value is Separators {
  return value === "subtle" || value === "regular" || value === "firm";
}

export function loadSeparators(): Separators {
  try {
    const raw = profileStorage.getItem(RULE_KEY);
    return isSeparators(raw) ? raw : SEPARATORS_DEFAULT;
  } catch {
    return SEPARATORS_DEFAULT;
  }
}

export function saveSeparators(value: Separators) {
  try {
    profileStorage.setItem(RULE_KEY, isSeparators(value) ? value : SEPARATORS_DEFAULT);
  } catch {
    // private mode / quota
  }
}

export function applySeparators(value: Separators) {
  const next = isSeparators(value) ? value : SEPARATORS_DEFAULT;
  document.documentElement.style.setProperty("--rule", String(RULE_STRENGTH[next]));
  return next;
}

export const REDUCE_MOTION_DEFAULT = false;

export function loadReduceMotion(): boolean {
  return readFlag(REDUCE_MOTION_KEY) ?? REDUCE_MOTION_DEFAULT;
}

export function saveReduceMotion(value: boolean) {
  writeFlag(REDUCE_MOTION_KEY, value);
}

export function applyReduceMotion(value: boolean) {
  document.documentElement.classList.toggle("reduce-motion", value);
  return value;
}

/**
 * Background and text lightness are stored per scheme. One shared slider would
 * carry a 9% background into the light theme and paint it black on black, so
 * dark and light keep their own value and the active one is what the page
 * edits.
 */
export const SURFACE_RANGE: Record<
  ColorScheme,
  { background: [min: number, max: number, fallback: number]; content: [number, number, number] }
> = {
  dark: { background: [2, 22, 5], content: [70, 100, 97] },
  light: { background: [86, 100, 100], content: [0, 42, 12] },
};

function schemeKey(key: string, scheme: ColorScheme) {
  return `${key}.${scheme}`;
}

export function loadBackgroundLightness(scheme: ColorScheme): number {
  const [min, max, fallback] = SURFACE_RANGE[scheme].background;
  return Math.round(
    clamp(readNumber(schemeKey(BACKGROUND_LIGHTNESS_KEY, scheme)) ?? fallback, min, max),
  );
}

export function saveBackgroundLightness(scheme: ColorScheme, value: number) {
  const [min, max] = SURFACE_RANGE[scheme].background;
  writeNumber(schemeKey(BACKGROUND_LIGHTNESS_KEY, scheme), Math.round(clamp(value, min, max)));
}

export function loadContentLightness(scheme: ColorScheme): number {
  const [min, max, fallback] = SURFACE_RANGE[scheme].content;
  return Math.round(
    clamp(readNumber(schemeKey(CONTENT_LIGHTNESS_KEY, scheme)) ?? fallback, min, max),
  );
}

export function saveContentLightness(scheme: ColorScheme, value: number) {
  const [min, max] = SURFACE_RANGE[scheme].content;
  writeNumber(schemeKey(CONTENT_LIGHTNESS_KEY, scheme), Math.round(clamp(value, min, max)));
}

/** Pushes the stored pair for whichever scheme is on screen. */
export function applySurfaceLightness(scheme: ColorScheme) {
  const background = loadBackgroundLightness(scheme);
  const content = loadContentLightness(scheme);
  document.documentElement.style.setProperty("--background-lightness", `${background}%`);
  document.documentElement.style.setProperty("--content-lightness", `${content}%`);
  return { background, content };
}

/* ------------------------------------------------------------------ *
 * Presets, the transcript column, and the editor's chrome.
 * ------------------------------------------------------------------ */

const TRANSCRIPT_WIDTH_KEY = "wavex.transcriptWidth";
const TRANSCRIPT_FONT_SIZE_KEY = "wavex.transcriptFontSize";
const TRANSCRIPT_SPACING_KEY = "wavex.transcriptSpacing";
const EDITOR_LINE_NUMBERS_KEY = "wavex.editorLineNumbers";
const EDITOR_FOLD_GUTTER_KEY = "wavex.editorFoldGutter";
const EDITOR_WORD_WRAP_KEY = "wavex.editorWordWrap";
const EDITOR_ACTIVE_LINE_KEY = "wavex.editorActiveLine";

/**
 * A preset is a bulk write to the four color settings, not a mode the app
 * stays in. Nudging the hue afterwards leaves the app looking however the user
 * left it rather than lying about which preset is on.
 */
export type ThemePreset = {
  id: string;
  label: string;
  themeHue: number;
  themeSaturation: number;
  accentHue: number;
  dark: { background: number; content: number };
  light: { background: number; content: number };
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "graphite",
    label: "Graphite",
    themeHue: THEME_HUE_DEFAULT,
    themeSaturation: THEME_SATURATION_DEFAULT,
    accentHue: ACCENT_HUE_DEFAULT,
    dark: { background: 5, content: 97 },
    light: { background: 100, content: 12 },
  },
  {
    id: "midnight",
    label: "Midnight",
    themeHue: 232,
    themeSaturation: 14,
    accentHue: 214,
    dark: { background: 7, content: 96 },
    light: { background: 100, content: 14 },
  },
  {
    id: "carbon",
    label: "Carbon",
    themeHue: 0,
    themeSaturation: 0,
    accentHue: 232,
    dark: { background: 4, content: 96 },
    light: { background: 100, content: 12 },
  },
  {
    id: "linen",
    label: "Linen",
    themeHue: 36,
    themeSaturation: 8,
    accentHue: 24,
    dark: { background: 7, content: 95 },
    light: { background: 99, content: 16 },
  },
  {
    id: "moss",
    label: "Moss",
    themeHue: 150,
    themeSaturation: 7,
    accentHue: 152,
    dark: { background: 6, content: 95 },
    light: { background: 100, content: 14 },
  },
  {
    id: "plum",
    label: "Plum",
    themeHue: 282,
    themeSaturation: 9,
    accentHue: 288,
    dark: { background: 6, content: 96 },
    light: { background: 100, content: 14 },
  },
  {
    id: "harbor",
    label: "Harbor",
    themeHue: 200,
    themeSaturation: 10,
    accentHue: 188,
    dark: { background: 6, content: 95 },
    light: { background: 100, content: 14 },
  },
];

/**
 * Writes both schemes, never only the one on screen: a preset that dressed
 * dark and left light as the user had bent it would look broken the moment
 * they switched.
 */
export function applyThemePreset(preset: ThemePreset, scheme: ColorScheme) {
  applyThemeTint(preset.themeHue, preset.themeSaturation);
  saveThemeHue(preset.themeHue);
  saveThemeSaturation(preset.themeSaturation);
  applyAccentHue(preset.accentHue);
  saveAccentHue(preset.accentHue);
  for (const each of ["dark", "light"] as ColorScheme[]) {
    saveBackgroundLightness(each, preset[each].background);
    saveContentLightness(each, preset[each].content);
  }
  return applySurfaceLightness(scheme);
}

export type TranscriptWidth = "narrow" | "normal" | "wide" | "full";

export const TRANSCRIPT_WIDTH_DEFAULT: TranscriptWidth = "normal";

/** `normal` is the 56rem the transcript shipped with. */
const TRANSCRIPT_WIDTHS: Record<TranscriptWidth, string> = {
  narrow: "42rem",
  normal: "56rem",
  wide: "72rem",
  full: "100%",
};

function isTranscriptWidth(value: unknown): value is TranscriptWidth {
  return value === "narrow" || value === "normal" || value === "wide" || value === "full";
}

export function loadTranscriptWidth(): TranscriptWidth {
  try {
    const raw = profileStorage.getItem(TRANSCRIPT_WIDTH_KEY);
    return isTranscriptWidth(raw) ? raw : TRANSCRIPT_WIDTH_DEFAULT;
  } catch {
    return TRANSCRIPT_WIDTH_DEFAULT;
  }
}

export function saveTranscriptWidth(value: TranscriptWidth) {
  try {
    profileStorage.setItem(
      TRANSCRIPT_WIDTH_KEY,
      isTranscriptWidth(value) ? value : TRANSCRIPT_WIDTH_DEFAULT,
    );
  } catch {
    // private mode / quota
  }
}

export function applyTranscriptWidth(value: TranscriptWidth) {
  const next = isTranscriptWidth(value) ? value : TRANSCRIPT_WIDTH_DEFAULT;
  document.documentElement.style.setProperty("--transcript-width", TRANSCRIPT_WIDTHS[next]);
  return next;
}

export const TRANSCRIPT_FONT_SIZE_MIN = 11;
export const TRANSCRIPT_FONT_SIZE_MAX = 18;
export const TRANSCRIPT_FONT_SIZE_DEFAULT = 13;

export function loadTranscriptFontSize(): number {
  return Math.round(
    clamp(
      readNumber(TRANSCRIPT_FONT_SIZE_KEY) ?? TRANSCRIPT_FONT_SIZE_DEFAULT,
      TRANSCRIPT_FONT_SIZE_MIN,
      TRANSCRIPT_FONT_SIZE_MAX,
    ),
  );
}

export function saveTranscriptFontSize(value: number) {
  writeNumber(
    TRANSCRIPT_FONT_SIZE_KEY,
    Math.round(clamp(value, TRANSCRIPT_FONT_SIZE_MIN, TRANSCRIPT_FONT_SIZE_MAX)),
  );
}

export function applyTranscriptFontSize(value: number) {
  const next = Math.round(clamp(value, TRANSCRIPT_FONT_SIZE_MIN, TRANSCRIPT_FONT_SIZE_MAX));
  document.documentElement.style.setProperty("--transcript-font-size", `${next}px`);
  return next;
}

export type TranscriptSpacing = "tight" | "normal" | "relaxed";

export const TRANSCRIPT_SPACING_DEFAULT: TranscriptSpacing = "normal";

const TRANSCRIPT_GAPS: Record<TranscriptSpacing, string> = {
  tight: "0.25rem",
  normal: "1rem",
  relaxed: "2rem",
};

function isTranscriptSpacing(value: unknown): value is TranscriptSpacing {
  return value === "tight" || value === "normal" || value === "relaxed";
}

export function loadTranscriptSpacing(): TranscriptSpacing {
  try {
    const raw = profileStorage.getItem(TRANSCRIPT_SPACING_KEY);
    return isTranscriptSpacing(raw) ? raw : TRANSCRIPT_SPACING_DEFAULT;
  } catch {
    return TRANSCRIPT_SPACING_DEFAULT;
  }
}

export function saveTranscriptSpacing(value: TranscriptSpacing) {
  try {
    profileStorage.setItem(
      TRANSCRIPT_SPACING_KEY,
      isTranscriptSpacing(value) ? value : TRANSCRIPT_SPACING_DEFAULT,
    );
  } catch {
    // private mode / quota
  }
}

export function applyTranscriptSpacing(value: TranscriptSpacing) {
  const next = isTranscriptSpacing(value) ? value : TRANSCRIPT_SPACING_DEFAULT;
  document.documentElement.style.setProperty("--transcript-gap", TRANSCRIPT_GAPS[next]);
  return next;
}

/**
 * The editor's own furniture. These are extensions rather than CSS, so the
 * open views reconfigure on `APPEARANCE_CHANGE_EVENT` instead of waiting for
 * the file to be reopened.
 */
export type EditorChromeSettings = {
  lineNumbers: boolean;
  foldGutter: boolean;
  wordWrap: boolean;
  activeLine: boolean;
};

export const EDITOR_CHROME_DEFAULT: EditorChromeSettings = {
  lineNumbers: true,
  foldGutter: true,
  wordWrap: true,
  activeLine: true,
};

export function loadEditorChrome(): EditorChromeSettings {
  return {
    lineNumbers: readFlag(EDITOR_LINE_NUMBERS_KEY) ?? EDITOR_CHROME_DEFAULT.lineNumbers,
    foldGutter: readFlag(EDITOR_FOLD_GUTTER_KEY) ?? EDITOR_CHROME_DEFAULT.foldGutter,
    wordWrap: readFlag(EDITOR_WORD_WRAP_KEY) ?? EDITOR_CHROME_DEFAULT.wordWrap,
    activeLine: readFlag(EDITOR_ACTIVE_LINE_KEY) ?? EDITOR_CHROME_DEFAULT.activeLine,
  };
}

const EDITOR_CHROME_KEYS: Record<keyof EditorChromeSettings, string> = {
  lineNumbers: EDITOR_LINE_NUMBERS_KEY,
  foldGutter: EDITOR_FOLD_GUTTER_KEY,
  wordWrap: EDITOR_WORD_WRAP_KEY,
  activeLine: EDITOR_ACTIVE_LINE_KEY,
};

export function saveEditorChrome(key: keyof EditorChromeSettings, value: boolean) {
  writeFlag(EDITOR_CHROME_KEYS[key], value);
  announceAppearance();
}
