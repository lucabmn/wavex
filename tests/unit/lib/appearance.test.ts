import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadTranscriptLayout,
  saveTranscriptLayout,
  TRANSCRIPT_LAYOUT_DEFAULT,
  loadTranscriptAnchor,
  saveTranscriptAnchor,
  TRANSCRIPT_ANCHOR_DEFAULT,
  loadThemePreference,
  saveThemePreference,
  resolveColorScheme,
  THEME_PREFERENCE_DEFAULT,
  ACCENT_HUE_DEFAULT,
  loadAccentHue,
  saveAccentHue,
  CORNER_RADIUS_DEFAULT,
  loadCornerRadius,
  saveCornerRadius,
  EDITOR_FONT_SIZE_DEFAULT,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  loadEditorFontSize,
  saveEditorFontSize,
  loadBackgroundLightness,
  saveBackgroundLightness,
  loadContentLightness,
  saveContentLightness,
  loadMonoFont,
  saveMonoFont,
  MONO_FONT_DEFAULT,
  loadReduceMotion,
  saveReduceMotion,
  REDUCE_MOTION_DEFAULT,
  loadTerminalCursor,
  saveTerminalCursor,
  loadTerminalCursorBlink,
  TERMINAL_CURSOR_BLINK_DEFAULT,
  TERMINAL_CURSOR_DEFAULT,
  loadTerminalFontSize,
  saveTerminalFontSize,
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  loadUiFont,
  saveUiFont,
  UI_FONT_DEFAULT,
  SURFACE_RANGE,
  EDITOR_CHROME_DEFAULT,
  loadEditorChrome,
  saveEditorChrome,
  THEME_PRESETS,
  loadTranscriptWidth,
  saveTranscriptWidth,
  TRANSCRIPT_WIDTH_DEFAULT,
  loadTranscriptFontSize,
  saveTranscriptFontSize,
  TRANSCRIPT_FONT_SIZE_DEFAULT,
  TRANSCRIPT_FONT_SIZE_MAX,
  TRANSCRIPT_FONT_SIZE_MIN,
  loadTranscriptSpacing,
  saveTranscriptSpacing,
  TRANSCRIPT_SPACING_DEFAULT,
} from "@/lib/appearance";

const KEY = "wavex.transcriptLayout";
const SCHEME_KEY = "wavex.colorScheme";
const ANCHOR_KEY = "wavex.transcriptAnchor";

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

describe("transcript layout setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it("defaults to full width", () => {
    expect(TRANSCRIPT_LAYOUT_DEFAULT).toBe("full");
    expect(loadTranscriptLayout()).toBe("full");
  });

  it("persists the chat layout", () => {
    saveTranscriptLayout("chat");
    expect(localStorage.getItem(KEY)).toBe("chat");
    expect(loadTranscriptLayout()).toBe("chat");
    saveTranscriptLayout("full");
    expect(loadTranscriptLayout()).toBe("full");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(KEY, "bubbles");
    expect(loadTranscriptLayout()).toBe("full");
  });
});

describe("transcript prompt-to-top setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(ANCHOR_KEY);
  });

  it("defaults to on", () => {
    expect(TRANSCRIPT_ANCHOR_DEFAULT).toBe(true);
    expect(loadTranscriptAnchor()).toBe(true);
  });

  it("persists across loads", () => {
    saveTranscriptAnchor(true);
    expect(loadTranscriptAnchor()).toBe(true);
    saveTranscriptAnchor(false);
    expect(loadTranscriptAnchor()).toBe(false);
  });
});

function mockSystemScheme(scheme: "dark" | "light") {
  Object.defineProperty(globalThis, "window", {
    value: {
      matchMedia: (query: string) => ({
        matches: query.includes("light") && scheme === "light",
      }),
    },
    configurable: true,
  });
}

describe("theme preference setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(SCHEME_KEY);
    Reflect.deleteProperty(globalThis, "window");
  });

  it("defaults to dark", () => {
    expect(THEME_PREFERENCE_DEFAULT).toBe("dark");
    expect(loadThemePreference()).toBe("dark");
  });

  it("persists each preference", () => {
    for (const value of ["system", "light", "dark"] as const) {
      saveThemePreference(value);
      expect(localStorage.getItem(SCHEME_KEY)).toBe(value);
      expect(loadThemePreference()).toBe(value);
    }
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(SCHEME_KEY, "solarized");
    expect(loadThemePreference()).toBe(THEME_PREFERENCE_DEFAULT);
  });

  it("resolves system against the OS appearance", () => {
    mockSystemScheme("light");
    expect(resolveColorScheme("system")).toBe("light");
    mockSystemScheme("dark");
    expect(resolveColorScheme("system")).toBe("dark");
  });

  it("keeps explicit picks regardless of the OS appearance", () => {
    mockSystemScheme("light");
    expect(resolveColorScheme("dark")).toBe("dark");
    mockSystemScheme("dark");
    expect(resolveColorScheme("light")).toBe("light");
  });

  it("falls back to dark without matchMedia", () => {
    expect(resolveColorScheme("system")).toBe("dark");
  });
});

describe("accent hue setting", () => {
  beforeEach(mockLocalStorage);

  it("defaults to the shipped blue", () => {
    expect(ACCENT_HUE_DEFAULT).toBe(211);
    expect(loadAccentHue()).toBe(211);
  });

  it("clamps and rounds what it stores", () => {
    saveAccentHue(400);
    expect(loadAccentHue()).toBe(360);
    saveAccentHue(-20);
    expect(loadAccentHue()).toBe(0);
    saveAccentHue(210.6);
    expect(loadAccentHue()).toBe(211);
  });
});

describe("font settings", () => {
  beforeEach(mockLocalStorage);

  it("defaults to the platform stack", () => {
    expect(loadUiFont()).toBe(UI_FONT_DEFAULT);
    expect(loadMonoFont()).toBe(MONO_FONT_DEFAULT);
  });

  it("persists a family it knows", () => {
    saveUiFont("inter");
    expect(loadUiFont()).toBe("inter");
    saveMonoFont("jetbrains");
    expect(loadMonoFont()).toBe("jetbrains");
  });

  it("falls back when the stored family is gone", () => {
    localStorage.setItem("wavex.uiFont", "comic");
    expect(loadUiFont()).toBe(UI_FONT_DEFAULT);
    localStorage.setItem("wavex.monoFont", "comic");
    expect(loadMonoFont()).toBe(MONO_FONT_DEFAULT);
  });
});

describe("text size settings", () => {
  beforeEach(mockLocalStorage);

  it("clamps the editor size into its range", () => {
    expect(loadEditorFontSize()).toBe(EDITOR_FONT_SIZE_DEFAULT);
    saveEditorFontSize(99);
    expect(loadEditorFontSize()).toBe(EDITOR_FONT_SIZE_MAX);
    saveEditorFontSize(1);
    expect(loadEditorFontSize()).toBe(EDITOR_FONT_SIZE_MIN);
  });

  it("clamps the terminal size into its range", () => {
    expect(loadTerminalFontSize()).toBe(TERMINAL_FONT_SIZE_DEFAULT);
    saveTerminalFontSize(99);
    expect(loadTerminalFontSize()).toBe(TERMINAL_FONT_SIZE_MAX);
    saveTerminalFontSize(1);
    expect(loadTerminalFontSize()).toBe(TERMINAL_FONT_SIZE_MIN);
  });
});

describe("corner radius and motion settings", () => {
  beforeEach(mockLocalStorage);

  it("defaults to soft corners and full motion", () => {
    expect(loadCornerRadius()).toBe(CORNER_RADIUS_DEFAULT);
    expect(loadReduceMotion()).toBe(REDUCE_MOTION_DEFAULT);
  });

  it("persists each corner choice and ignores unknown ones", () => {
    for (const value of ["sharp", "soft", "round"] as const) {
      saveCornerRadius(value);
      expect(loadCornerRadius()).toBe(value);
    }
    localStorage.setItem("wavex.cornerRadius", "bevelled");
    expect(loadCornerRadius()).toBe(CORNER_RADIUS_DEFAULT);
  });

  it("persists reduce motion", () => {
    saveReduceMotion(true);
    expect(loadReduceMotion()).toBe(true);
  });
});

describe("surface lightness settings", () => {
  beforeEach(mockLocalStorage);

  it("keeps dark and light apart", () => {
    expect(loadBackgroundLightness("dark")).toBe(SURFACE_RANGE.dark.background[2]);
    expect(loadBackgroundLightness("light")).toBe(SURFACE_RANGE.light.background[2]);

    saveBackgroundLightness("dark", 4);
    expect(loadBackgroundLightness("dark")).toBe(4);
    expect(loadBackgroundLightness("light")).toBe(SURFACE_RANGE.light.background[2]);
  });

  it("clamps each scheme into its own range", () => {
    saveBackgroundLightness("dark", 90);
    expect(loadBackgroundLightness("dark")).toBe(SURFACE_RANGE.dark.background[1]);
    saveContentLightness("light", 90);
    expect(loadContentLightness("light")).toBe(SURFACE_RANGE.light.content[1]);
  });
});

describe("terminal cursor settings", () => {
  beforeEach(mockLocalStorage);

  it("defaults to a blinking bar", () => {
    expect(loadTerminalCursor()).toBe(TERMINAL_CURSOR_DEFAULT);
    expect(loadTerminalCursorBlink()).toBe(TERMINAL_CURSOR_BLINK_DEFAULT);
  });

  it("persists each shape and ignores unknown ones", () => {
    for (const value of ["bar", "block", "underline"] as const) {
      saveTerminalCursor(value);
      expect(loadTerminalCursor()).toBe(value);
    }
    localStorage.setItem("wavex.terminalCursor", "beam");
    expect(loadTerminalCursor()).toBe(TERMINAL_CURSOR_DEFAULT);
  });
});

describe("transcript column settings", () => {
  beforeEach(mockLocalStorage);

  it("defaults to the width, size, and spacing it shipped with", () => {
    expect(loadTranscriptWidth()).toBe(TRANSCRIPT_WIDTH_DEFAULT);
    expect(loadTranscriptFontSize()).toBe(TRANSCRIPT_FONT_SIZE_DEFAULT);
    expect(loadTranscriptSpacing()).toBe(TRANSCRIPT_SPACING_DEFAULT);
  });

  it("persists each width and ignores unknown ones", () => {
    for (const value of ["narrow", "normal", "wide", "full"] as const) {
      saveTranscriptWidth(value);
      expect(loadTranscriptWidth()).toBe(value);
    }
    localStorage.setItem("wavex.transcriptWidth", "enormous");
    expect(loadTranscriptWidth()).toBe(TRANSCRIPT_WIDTH_DEFAULT);
  });

  it("clamps the transcript text size", () => {
    saveTranscriptFontSize(99);
    expect(loadTranscriptFontSize()).toBe(TRANSCRIPT_FONT_SIZE_MAX);
    saveTranscriptFontSize(1);
    expect(loadTranscriptFontSize()).toBe(TRANSCRIPT_FONT_SIZE_MIN);
  });

  it("persists each spacing and ignores unknown ones", () => {
    for (const value of ["tight", "normal", "relaxed"] as const) {
      saveTranscriptSpacing(value);
      expect(loadTranscriptSpacing()).toBe(value);
    }
    localStorage.setItem("wavex.transcriptSpacing", "airy");
    expect(loadTranscriptSpacing()).toBe(TRANSCRIPT_SPACING_DEFAULT);
  });
});

describe("editor chrome settings", () => {
  beforeEach(mockLocalStorage);

  it("starts with every piece of furniture on", () => {
    expect(loadEditorChrome()).toEqual(EDITOR_CHROME_DEFAULT);
  });

  it("persists one switch without disturbing the others", () => {
    saveEditorChrome("wordWrap", false);
    expect(loadEditorChrome()).toEqual({ ...EDITOR_CHROME_DEFAULT, wordWrap: false });
    saveEditorChrome("lineNumbers", false);
    expect(loadEditorChrome()).toEqual({
      ...EDITOR_CHROME_DEFAULT,
      wordWrap: false,
      lineNumbers: false,
    });
  });
});

describe("theme presets", () => {
  it("dresses both schemes inside the range each one allows", () => {
    for (const preset of THEME_PRESETS) {
      for (const scheme of ["dark", "light"] as const) {
        const range = SURFACE_RANGE[scheme];
        expect(preset[scheme].background).toBeGreaterThanOrEqual(range.background[0]);
        expect(preset[scheme].background).toBeLessThanOrEqual(range.background[1]);
        expect(preset[scheme].content).toBeGreaterThanOrEqual(range.content[0]);
        expect(preset[scheme].content).toBeLessThanOrEqual(range.content[1]);
      }
      expect(preset.themeHue).toBeGreaterThanOrEqual(0);
      expect(preset.themeHue).toBeLessThanOrEqual(360);
      expect(preset.accentHue).toBeGreaterThanOrEqual(0);
      expect(preset.accentHue).toBeLessThanOrEqual(360);
    }
  });

  it("starts with Nord and keeps the wavex palette as the second preset", () => {
    expect(THEME_PRESETS.slice(0, 2).map((preset) => preset.label)).toEqual(["Nord", "wavex"]);
    expect(THEME_PRESETS.slice(0, 2).map((preset) => preset.id)).toEqual(["nord", "wavex"]);
  });

  it("has one id per preset", () => {
    const ids = THEME_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
