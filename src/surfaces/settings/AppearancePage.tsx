import { useCallback, useEffect, useState } from "react";
import { Row, Section, Segmented, Select, Slider, Toggle } from "../../chrome/SettingsRow";
import {
  ACCENT_HUE_DEFAULT,
  ACCENT_PRESETS,
  applyAccentHue,
  applyBodyGlass,
  applySeparators,
  applyCornerRadius,
  applyEditorFontSize,
  applyMonoFont,
  applyReduceMotion,
  applySidebarBlur,
  applySidebarOpacity,
  applySurfaceDepth,
  applySurfaceLightness,
  applyThemePreference,
  applyThemePreset,
  applyThemeTint,
  applyTranscriptFontSize,
  applyTranscriptSpacing,
  applyTranscriptWidth,
  applyUiFont,
  BODY_GLASS_DEFAULT,
  CORNER_RADIUS_DEFAULT,
  EDITOR_FONT_SIZE_DEFAULT,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  loadAccentHue,
  loadBackgroundLightness,
  loadBodyGlass,
  loadContentLightness,
  loadSeparators,
  loadCornerRadius,
  EDITOR_CHROME_DEFAULT,
  loadEditorChrome,
  loadEditorFontSize,
  loadMonoFont,
  loadReduceMotion,
  loadSidebarBlur,
  loadSidebarOpacity,
  loadSurfaceDepth,
  loadTerminalCursor,
  loadTerminalCursorBlink,
  loadTerminalFontSize,
  loadThemeHue,
  loadThemePreference,
  loadThemeSaturation,
  loadTranscriptAnchor,
  loadTranscriptFontSize,
  loadTranscriptLayout,
  loadTranscriptSpacing,
  loadTranscriptWidth,
  loadUiFont,
  MONO_FONT_DEFAULT,
  MONO_FONTS,
  REDUCE_MOTION_DEFAULT,
  resolveColorScheme,
  saveAccentHue,
  saveBackgroundLightness,
  saveBodyGlass,
  saveContentLightness,
  saveSeparators,
  saveCornerRadius,
  saveEditorChrome,
  saveEditorFontSize,
  saveMonoFont,
  saveReduceMotion,
  saveSidebarBlur,
  saveSidebarOpacity,
  saveSurfaceDepth,
  saveTerminalCursor,
  saveTerminalCursorBlink,
  saveTerminalFontSize,
  saveThemeHue,
  saveThemePreference,
  saveThemeSaturation,
  saveTranscriptAnchor,
  saveTranscriptFontSize,
  saveTranscriptLayout,
  saveTranscriptSpacing,
  saveTranscriptWidth,
  saveUiFont,
  SCHEME_CHANGE_EVENT,
  SIDEBAR_BLUR_DEFAULT,
  SIDEBAR_BLUR_MAX,
  SIDEBAR_BLUR_MIN,
  SIDEBAR_OPACITY_DEFAULT,
  SIDEBAR_OPACITY_MAX,
  SIDEBAR_OPACITY_MIN,
  SEPARATORS_DEFAULT,
  SURFACE_DEPTH_DEFAULT,
  SURFACE_RANGE,
  TERMINAL_CURSOR_BLINK_DEFAULT,
  TERMINAL_CURSOR_DEFAULT,
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  THEME_HUE_DEFAULT,
  THEME_HUE_MAX,
  THEME_HUE_MIN,
  THEME_PREFERENCE_DEFAULT,
  THEME_SATURATION_DEFAULT,
  THEME_SATURATION_MAX,
  THEME_SATURATION_MIN,
  THEME_PRESETS,
  TRANSCRIPT_ANCHOR_CHANGE_EVENT,
  TRANSCRIPT_ANCHOR_DEFAULT,
  TRANSCRIPT_FONT_SIZE_DEFAULT,
  TRANSCRIPT_FONT_SIZE_MAX,
  TRANSCRIPT_FONT_SIZE_MIN,
  TRANSCRIPT_LAYOUT_DEFAULT,
  TRANSCRIPT_SPACING_DEFAULT,
  TRANSCRIPT_WIDTH_DEFAULT,
  UI_FONT_DEFAULT,
  UI_FONTS,
  type ColorScheme,
  type CornerRadius,
  type EditorChromeSettings,
  type Separators,
  type SurfaceDepth,
  type ThemePreset,
  type TranscriptSpacing,
  type TranscriptWidth,
  type TerminalCursor,
  type ThemePreference,
  type TranscriptLayout,
} from "../../lib/appearance";
import {
  COMPOSER_RUNNER_DEFAULT,
  loadComposerRunner,
  saveComposerRunner,
} from "../../lib/settings";
import {
  applyUiScale,
  loadUiScale,
  saveUiScale,
  subscribeUiScale,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
} from "../../lib/uiScale";

export type AppearanceSettings = ReturnType<typeof useAppearanceSettings>;

/**
 * Every appearance rule is read here and written straight through to the DOM,
 * so the page previews itself: there is no Apply button and no staged state to
 * fall out of sync with what is on screen.
 */
export function useAppearanceSettings() {
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemePreference);
  const [scheme, setScheme] = useState<ColorScheme>(() =>
    resolveColorScheme(loadThemePreference()),
  );
  const [accentHue, setAccentHue] = useState(loadAccentHue);
  const [opacity, setOpacity] = useState(loadSidebarOpacity);
  const [blur, setBlur] = useState(loadSidebarBlur);
  const [themeHue, setThemeHue] = useState(loadThemeHue);
  const [themeSaturation, setThemeSaturation] = useState(loadThemeSaturation);
  const [bodyGlass, setBodyGlass] = useState(loadBodyGlass);
  const [uiScale, setUiScale] = useState(loadUiScale);
  const [uiFont, setUiFont] = useState(loadUiFont);
  const [monoFont, setMonoFont] = useState(loadMonoFont);
  const [editorFontSize, setEditorFontSize] = useState(loadEditorFontSize);
  const [terminalFontSize, setTerminalFontSize] = useState(loadTerminalFontSize);
  const [terminalCursor, setTerminalCursor] = useState<TerminalCursor>(loadTerminalCursor);
  const [terminalCursorBlink, setTerminalCursorBlink] = useState(loadTerminalCursorBlink);
  const [cornerRadius, setCornerRadius] = useState<CornerRadius>(loadCornerRadius);
  const [surfaceDepth, setSurfaceDepth] = useState<SurfaceDepth>(loadSurfaceDepth);
  const [separators, setSeparators] = useState<Separators>(loadSeparators);
  const [reduceMotion, setReduceMotion] = useState(loadReduceMotion);
  const [transcriptLayout, setTranscriptLayout] = useState<TranscriptLayout>(loadTranscriptLayout);
  const [transcriptAnchor, setTranscriptAnchor] = useState(loadTranscriptAnchor);
  const [composerRunner, setComposerRunner] = useState(loadComposerRunner);
  const [transcriptWidth, setTranscriptWidth] = useState<TranscriptWidth>(loadTranscriptWidth);
  const [transcriptFontSize, setTranscriptFontSize] = useState(loadTranscriptFontSize);
  const [transcriptSpacing, setTranscriptSpacing] =
    useState<TranscriptSpacing>(loadTranscriptSpacing);
  const [editorChrome, setEditorChrome] = useState<EditorChromeSettings>(loadEditorChrome);
  const [surface, setSurface] = useState(() => {
    const current = resolveColorScheme(loadThemePreference());
    return {
      background: loadBackgroundLightness(current),
      content: loadContentLightness(current),
    };
  });

  useEffect(() => subscribeUiScale(() => setUiScale(loadUiScale())), []);

  // "System" can flip under the page, and the surface sliders belong to
  // whichever scheme is on screen.
  useEffect(() => {
    const onScheme = (event: Event) => {
      setScheme((event as CustomEvent<ColorScheme>).detail);
    };
    window.addEventListener(SCHEME_CHANGE_EVENT, onScheme);
    return () => window.removeEventListener(SCHEME_CHANGE_EVENT, onScheme);
  }, []);

  useEffect(() => {
    setSurface({
      background: loadBackgroundLightness(scheme),
      content: loadContentLightness(scheme),
    });
  }, [scheme]);

  useEffect(() => {
    const onAnchor = (event: Event) => {
      setTranscriptAnchor((event as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener(TRANSCRIPT_ANCHOR_CHANGE_EVENT, onAnchor);
    return () => window.removeEventListener(TRANSCRIPT_ANCHOR_CHANGE_EVENT, onAnchor);
  }, []);

  const onThemePreference = useCallback((next: ThemePreference) => {
    applyThemePreference(next);
    saveThemePreference(next);
    setThemePreference(next);
  }, []);

  const onAccentHue = useCallback((hue: number) => {
    const next = applyAccentHue(hue);
    saveAccentHue(next);
    setAccentHue(next);
  }, []);

  const onOpacity = useCallback((percent: number) => {
    const next = applySidebarOpacity(percent / 100);
    saveSidebarOpacity(next);
    setOpacity(next);
  }, []);

  const onBlur = useCallback((radius: number) => {
    const next = applySidebarBlur(radius);
    saveSidebarBlur(next);
    setBlur(next);
  }, []);

  const onTint = useCallback((hue: number, saturation: number) => {
    const next = applyThemeTint(hue, saturation);
    saveThemeHue(next.hue);
    saveThemeSaturation(next.saturation);
    setThemeHue(next.hue);
    setThemeSaturation(next.saturation);
  }, []);

  const onBodyGlass = useCallback((next: boolean) => {
    applyBodyGlass(next);
    saveBodyGlass(next);
    setBodyGlass(next);
  }, []);

  const onUiScale = useCallback((percent: number) => {
    const next = saveUiScale(percent / 100);
    setUiScale(next);
    void applyUiScale(next);
  }, []);

  const onUiFont = useCallback((id: string) => {
    const next = applyUiFont(id);
    saveUiFont(next);
    setUiFont(next);
  }, []);

  const onMonoFont = useCallback((id: string) => {
    const next = applyMonoFont(id);
    saveMonoFont(next);
    setMonoFont(next);
  }, []);

  const onEditorFontSize = useCallback((value: number) => {
    const next = applyEditorFontSize(value);
    saveEditorFontSize(next);
    setEditorFontSize(next);
  }, []);

  const onTerminalFontSize = useCallback((value: number) => {
    saveTerminalFontSize(value);
    setTerminalFontSize(loadTerminalFontSize());
  }, []);

  const onTerminalCursor = useCallback((value: TerminalCursor) => {
    saveTerminalCursor(value);
    setTerminalCursor(value);
  }, []);

  const onTerminalCursorBlink = useCallback((value: boolean) => {
    saveTerminalCursorBlink(value);
    setTerminalCursorBlink(value);
  }, []);

  const onCornerRadius = useCallback((value: CornerRadius) => {
    const next = applyCornerRadius(value);
    saveCornerRadius(next);
    setCornerRadius(next);
  }, []);

  const onSurfaceDepth = useCallback((value: SurfaceDepth) => {
    const next = applySurfaceDepth(value);
    saveSurfaceDepth(next);
    setSurfaceDepth(next);
  }, []);

  const onSeparators = useCallback((value: Separators) => {
    const next = applySeparators(value);
    saveSeparators(next);
    setSeparators(next);
  }, []);

  const onReduceMotion = useCallback((value: boolean) => {
    applyReduceMotion(value);
    saveReduceMotion(value);
    setReduceMotion(value);
  }, []);

  const onBackgroundLightness = useCallback(
    (value: number) => {
      saveBackgroundLightness(scheme, value);
      setSurface(applySurfaceLightness(scheme));
    },
    [scheme],
  );

  const onContentLightness = useCallback(
    (value: number) => {
      saveContentLightness(scheme, value);
      setSurface(applySurfaceLightness(scheme));
    },
    [scheme],
  );

  const onTranscriptLayout = useCallback((next: TranscriptLayout) => {
    saveTranscriptLayout(next);
    setTranscriptLayout(next);
  }, []);

  const onTranscriptAnchor = useCallback((next: boolean) => {
    saveTranscriptAnchor(next);
    setTranscriptAnchor(next);
  }, []);

  const onComposerRunner = useCallback((next: boolean) => {
    saveComposerRunner(next);
    setComposerRunner(next);
  }, []);

  const onTranscriptWidth = useCallback((value: TranscriptWidth) => {
    const next = applyTranscriptWidth(value);
    saveTranscriptWidth(next);
    setTranscriptWidth(next);
  }, []);

  const onTranscriptFontSize = useCallback((value: number) => {
    const next = applyTranscriptFontSize(value);
    saveTranscriptFontSize(next);
    setTranscriptFontSize(next);
  }, []);

  const onTranscriptSpacing = useCallback((value: TranscriptSpacing) => {
    const next = applyTranscriptSpacing(value);
    saveTranscriptSpacing(next);
    setTranscriptSpacing(next);
  }, []);

  const onEditorChrome = useCallback((key: keyof EditorChromeSettings, value: boolean) => {
    saveEditorChrome(key, value);
    setEditorChrome((current) => ({ ...current, [key]: value }));
  }, []);

  // A preset writes the color settings and then the page re-reads them, so the
  // sliders below move with it instead of drifting out of sync.
  const onPreset = useCallback(
    (preset: ThemePreset) => {
      applyThemePreset(preset, scheme);
      setThemeHue(preset.themeHue);
      setThemeSaturation(preset.themeSaturation);
      setAccentHue(preset.accentHue);
      setSurface({
        background: loadBackgroundLightness(scheme),
        content: loadContentLightness(scheme),
      });
    },
    [scheme],
  );

  const restoreDefaults = useCallback(() => {
    onThemePreference(THEME_PREFERENCE_DEFAULT);
    onAccentHue(ACCENT_HUE_DEFAULT);
    onOpacity(Math.round(SIDEBAR_OPACITY_DEFAULT * 100));
    onBlur(SIDEBAR_BLUR_DEFAULT);
    onTint(THEME_HUE_DEFAULT, THEME_SATURATION_DEFAULT);
    onBodyGlass(BODY_GLASS_DEFAULT);
    onUiScale(Math.round(UI_SCALE_DEFAULT * 100));
    onUiFont(UI_FONT_DEFAULT);
    onMonoFont(MONO_FONT_DEFAULT);
    onEditorFontSize(EDITOR_FONT_SIZE_DEFAULT);
    onTerminalFontSize(TERMINAL_FONT_SIZE_DEFAULT);
    onTerminalCursor(TERMINAL_CURSOR_DEFAULT);
    onTerminalCursorBlink(TERMINAL_CURSOR_BLINK_DEFAULT);
    onCornerRadius(CORNER_RADIUS_DEFAULT);
    onSurfaceDepth(SURFACE_DEPTH_DEFAULT);
    onSeparators(SEPARATORS_DEFAULT);
    onReduceMotion(REDUCE_MOTION_DEFAULT);
    onTranscriptLayout(TRANSCRIPT_LAYOUT_DEFAULT);
    onTranscriptAnchor(TRANSCRIPT_ANCHOR_DEFAULT);
    onComposerRunner(COMPOSER_RUNNER_DEFAULT);
    onTranscriptWidth(TRANSCRIPT_WIDTH_DEFAULT);
    onTranscriptFontSize(TRANSCRIPT_FONT_SIZE_DEFAULT);
    onTranscriptSpacing(TRANSCRIPT_SPACING_DEFAULT);
    for (const key of Object.keys(EDITOR_CHROME_DEFAULT) as (keyof EditorChromeSettings)[]) {
      onEditorChrome(key, EDITOR_CHROME_DEFAULT[key]);
    }
    // Both schemes, not only the one on screen: a user asking for defaults
    // does not mean "and leave light theme as I bent it".
    for (const each of ["dark", "light"] as ColorScheme[]) {
      const range = SURFACE_RANGE[each];
      saveBackgroundLightness(each, range.background[2]);
      saveContentLightness(each, range.content[2]);
    }
    setSurface(applySurfaceLightness(resolveColorScheme(THEME_PREFERENCE_DEFAULT)));
  }, [
    onAccentHue,
    onBlur,
    onBodyGlass,
    onComposerRunner,
    onCornerRadius,
    onEditorChrome,
    onEditorFontSize,
    onMonoFont,
    onOpacity,
    onReduceMotion,
    onSeparators,
    onSurfaceDepth,
    onTerminalCursor,
    onTerminalCursorBlink,
    onTerminalFontSize,
    onThemePreference,
    onTint,
    onTranscriptAnchor,
    onTranscriptFontSize,
    onTranscriptLayout,
    onTranscriptSpacing,
    onTranscriptWidth,
    onUiFont,
    onUiScale,
  ]);

  return {
    themePreference,
    scheme,
    accentHue,
    opacity,
    blur,
    themeHue,
    themeSaturation,
    bodyGlass,
    uiScale,
    uiFont,
    monoFont,
    editorFontSize,
    terminalFontSize,
    terminalCursor,
    terminalCursorBlink,
    cornerRadius,
    surfaceDepth,
    separators,
    reduceMotion,
    transcriptLayout,
    transcriptAnchor,
    composerRunner,
    transcriptWidth,
    transcriptFontSize,
    transcriptSpacing,
    editorChrome,
    surface,
    onThemePreference,
    onAccentHue,
    onOpacity,
    onBlur,
    onTint,
    onBodyGlass,
    onUiScale,
    onUiFont,
    onMonoFont,
    onEditorFontSize,
    onTerminalFontSize,
    onTerminalCursor,
    onTerminalCursorBlink,
    onCornerRadius,
    onSurfaceDepth,
    onSeparators,
    onReduceMotion,
    onBackgroundLightness,
    onContentLightness,
    onTranscriptLayout,
    onTranscriptAnchor,
    onComposerRunner,
    onTranscriptWidth,
    onTranscriptFontSize,
    onTranscriptSpacing,
    onEditorChrome,
    onPreset,
    restoreDefaults,
  };
}

export function AppearancePage({ appearance }: { appearance: AppearanceSettings }) {
  const percent = Math.round(appearance.opacity * 100);
  const range = SURFACE_RANGE[appearance.scheme];
  const schemeWord = appearance.scheme === "light" ? "light" : "dark";

  return (
    <>
      <Section
        title="Presets"
        description="A starting point: one click writes the interface hue, the accent, and the depth of both themes. Everything below stays free to move afterwards."
      >
        <Row label="Palette" layout="stacked">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {THEME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => appearance.onPreset(preset)}
                className="ui-focus flex items-center gap-2 rounded-md border border-edge bg-surface-raised px-2.5 py-2 text-left text-[12.5px] text-muted hover:border-edge-strong hover:text-content"
              >
                <span
                  aria-hidden
                  className="size-4 shrink-0 rounded-full border border-edge-strong"
                  style={{
                    background: `linear-gradient(to right, hsl(${preset.accentHue} 62% 58%) 0 50%, hsl(${preset.themeHue} ${preset.themeSaturation}% ${preset.dark.background + 4}%) 50% 100%)`,
                  }}
                />
                <span className="min-w-0 truncate">{preset.label}</span>
              </button>
            ))}
          </div>
        </Row>
      </Section>

      <Section
        title="Theme"
        description="Dark and light share one tint and one accent, so a change here follows you across both."
      >
        <Row
          label="Theme"
          description="System follows the OS appearance and flips with it while wavex is open."
        >
          <Segmented
            label="Theme"
            value={appearance.themePreference}
            options={[
              { value: "system", label: "System" },
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            onChange={appearance.onThemePreference}
          />
        </Row>
        <Row
          label="Accent"
          description="The one saturated colour in the window: the selected row, the live tab, focus, links, and the single filled action a surface is allowed."
          layout="stacked"
        >
          <AccentSwatches value={appearance.accentHue} onChange={appearance.onAccentHue} />
        </Row>
        <Row label="Accent hue" description="Anywhere between the presets.">
          <Slider
            label="Accent hue"
            value={appearance.accentHue}
            display={`${appearance.accentHue}°`}
            min={0}
            max={360}
            onChange={appearance.onAccentHue}
          />
        </Row>
        <Row label="Interface hue" description="Base hue for the chrome and its tinted surfaces.">
          <Slider
            label="Interface hue"
            value={appearance.themeHue}
            display={`${appearance.themeHue}°`}
            min={THEME_HUE_MIN}
            max={THEME_HUE_MAX}
            onChange={(value) => appearance.onTint(value, appearance.themeSaturation)}
          />
        </Row>
        <Row
          label="Interface saturation"
          description="How strongly that hue tints the interface. Zero keeps it neutral grey."
        >
          <Slider
            label="Interface saturation"
            value={appearance.themeSaturation}
            display={`${appearance.themeSaturation}%`}
            min={THEME_SATURATION_MIN}
            max={THEME_SATURATION_MAX}
            onChange={(value) => appearance.onTint(appearance.themeHue, value)}
          />
        </Row>
      </Section>

      <Section
        title="Surfaces"
        description={`The window's own planes: how deep it sits, how far things stand off it, how firmly they are ruled apart, and how much of the desktop shows through. Background and contrast are kept per theme, so those two are the ${schemeWord} theme's.`}
      >
        <Row
          label="Background depth"
          description="How dark or light the window itself sits behind everything else."
        >
          <Slider
            label="Background depth"
            value={appearance.surface.background}
            display={`${appearance.surface.background}%`}
            min={range.background[0]}
            max={range.background[1]}
            onChange={appearance.onBackgroundLightness}
          />
        </Row>
        <Row
          label="Text contrast"
          description="Lightness of the text against that background. Higher is sharper, lower is softer."
        >
          <Slider
            label="Text contrast"
            value={appearance.surface.content}
            display={`${appearance.surface.content}%`}
            min={range.content[0]}
            max={range.content[1]}
            onChange={appearance.onContentLightness}
          />
        </Row>
        <Row
          label="Depth"
          description="How far raised surfaces stand off the ones behind them. Flat keeps a hairline where the shadow was."
        >
          <Segmented
            label="Depth"
            value={appearance.surfaceDepth}
            options={[
              { value: "flat", label: "Flat" },
              { value: "soft", label: "Soft" },
              { value: "deep", label: "Deep" },
            ]}
            onChange={appearance.onSurfaceDepth}
          />
        </Row>
        <Row
          label="Separators"
          description="How strongly every hairline in the app is drawn. Subtle leans on the difference between one surface and the next; firm draws the line."
        >
          <Segmented
            label="Separators"
            value={appearance.separators}
            options={[
              { value: "subtle", label: "Subtle" },
              { value: "regular", label: "Regular" },
              { value: "firm", label: "Firm" },
            ]}
            onChange={appearance.onSeparators}
          />
        </Row>
        <Row
          label="Window opacity"
          description="How much of the desktop shows through wavex. It applies to the sidebar and the project rail, and to the main pane as well when Main pane glass is on."
        >
          <Slider
            label="Window opacity"
            value={percent}
            display={`${percent}%`}
            min={Math.round(SIDEBAR_OPACITY_MIN * 100)}
            max={Math.round(SIDEBAR_OPACITY_MAX * 100)}
            onChange={appearance.onOpacity}
          />
        </Row>
        <Row
          label="Blur radius"
          description="Background blur behind the window. Higher values cost more to composite."
        >
          <Slider
            label="Blur radius"
            value={appearance.blur}
            display={String(appearance.blur)}
            min={SIDEBAR_BLUR_MIN}
            max={SIDEBAR_BLUR_MAX}
            onChange={appearance.onBlur}
          />
        </Row>
        <Row
          label="Main pane glass"
          description="Extend the translucent treatment to the main pane behind sessions and editors."
        >
          <Toggle
            label="Main pane glass"
            on={appearance.bodyGlass}
            onChange={appearance.onBodyGlass}
          />
        </Row>
      </Section>

      <Section
        title="Typography"
        description="wavex ships no fonts. A family you do not have falls back to the stack it shipped with."
      >
        <Row label="Interface font" description="Everything outside code and terminals.">
          <Select
            label="Interface font"
            value={appearance.uiFont}
            options={UI_FONTS.map((font) => ({ value: font.id, label: font.label }))}
            onChange={appearance.onUiFont}
          />
        </Row>
        <Row label="Monospace font" description="Code blocks, diffs, the editor, and the terminal.">
          <Select
            label="Monospace font"
            value={appearance.monoFont}
            options={MONO_FONTS.map((font) => ({ value: font.id, label: font.label }))}
            onChange={appearance.onMonoFont}
          />
        </Row>
      </Section>

      <Section
        title="Transcript"
        description="The column a conversation is read in. This is the surface you spend the day on."
      >
        <Row
          label="Column width"
          description="How wide a turn is allowed to run before it wraps. Full lets it use the whole pane."
        >
          <Segmented
            label="Column width"
            value={appearance.transcriptWidth}
            options={[
              { value: "narrow", label: "Narrow" },
              { value: "normal", label: "Normal" },
              { value: "wide", label: "Wide" },
              { value: "full", label: "Full" },
            ]}
            onChange={appearance.onTranscriptWidth}
          />
        </Row>
        <Row label="Text size" description="Prompts, replies, and tool output.">
          <Slider
            label="Transcript text size"
            value={appearance.transcriptFontSize}
            display={`${appearance.transcriptFontSize}px`}
            min={TRANSCRIPT_FONT_SIZE_MIN}
            max={TRANSCRIPT_FONT_SIZE_MAX}
            onChange={appearance.onTranscriptFontSize}
          />
        </Row>
        <Row label="Spacing" description="How much air sits between one turn and the next.">
          <Segmented
            label="Transcript spacing"
            value={appearance.transcriptSpacing}
            options={[
              { value: "tight", label: "Tight" },
              { value: "normal", label: "Normal" },
              { value: "relaxed", label: "Relaxed" },
            ]}
            onChange={appearance.onTranscriptSpacing}
          />
        </Row>
      </Section>

      <Section
        title="Editor"
        description="The coding view's own furniture. Changes reach the files already open."
      >
        <Row label="Text size" description="File contents in the coding view.">
          <Slider
            label="Editor text size"
            value={appearance.editorFontSize}
            display={`${appearance.editorFontSize}px`}
            min={EDITOR_FONT_SIZE_MIN}
            max={EDITOR_FONT_SIZE_MAX}
            onChange={appearance.onEditorFontSize}
          />
        </Row>
        <Row label="Line numbers" description="The gutter down the left of the file.">
          <Toggle
            label="Line numbers"
            on={appearance.editorChrome.lineNumbers}
            onChange={(next) => appearance.onEditorChrome("lineNumbers", next)}
          />
        </Row>
        <Row
          label="Fold gutter"
          description="Arrows beside a block that can be collapsed. Folding by keyboard keeps working either way."
        >
          <Toggle
            label="Fold gutter"
            on={appearance.editorChrome.foldGutter}
            onChange={(next) => appearance.onEditorChrome("foldGutter", next)}
          />
        </Row>
        <Row
          label="Word wrap"
          description="Wrap a long line into the pane instead of scrolling sideways for it."
        >
          <Toggle
            label="Word wrap"
            on={appearance.editorChrome.wordWrap}
            onChange={(next) => appearance.onEditorChrome("wordWrap", next)}
          />
        </Row>
        <Row label="Highlight the active line" description="Tint the line the caret is on.">
          <Toggle
            label="Highlight the active line"
            on={appearance.editorChrome.activeLine}
            onChange={(next) => appearance.onEditorChrome("activeLine", next)}
          />
        </Row>
      </Section>

      <Section
        title="Terminal"
        description="Applies to the terminals already open, not only the next one."
      >
        <Row label="Terminal text size" description="Columns and rows refit as you drag.">
          <Slider
            label="Terminal text size"
            value={appearance.terminalFontSize}
            display={`${appearance.terminalFontSize}px`}
            min={TERMINAL_FONT_SIZE_MIN}
            max={TERMINAL_FONT_SIZE_MAX}
            onChange={appearance.onTerminalFontSize}
          />
        </Row>
        <Row label="Cursor" description="Shape of the caret in the terminal.">
          <Segmented
            label="Terminal cursor"
            value={appearance.terminalCursor}
            options={[
              { value: "bar", label: "Bar" },
              { value: "block", label: "Block" },
              { value: "underline", label: "Under" },
            ]}
            onChange={appearance.onTerminalCursor}
          />
        </Row>
        <Row label="Blink" description="Whether that caret blinks.">
          <Toggle
            label="Terminal cursor blink"
            on={appearance.terminalCursorBlink}
            onChange={appearance.onTerminalCursorBlink}
          />
        </Row>
      </Section>

      <Section title="Layout">
        <Row
          label="Interface scale"
          description="Zoom the whole interface. You can also use Ctrl+=, Ctrl+-, and Ctrl+0 (Cmd on macOS)."
        >
          <Slider
            label="Interface scale"
            value={Math.round(appearance.uiScale * 100)}
            display={`${Math.round(appearance.uiScale * 100)}%`}
            min={Math.round(UI_SCALE_MIN * 100)}
            max={Math.round(UI_SCALE_MAX * 100)}
            step={10}
            onChange={appearance.onUiScale}
          />
        </Row>
        <Row label="Corners" description="How rounded cards, buttons, and menus are.">
          <Segmented
            label="Corners"
            value={appearance.cornerRadius}
            options={[
              { value: "sharp", label: "Sharp" },
              { value: "soft", label: "Soft" },
              { value: "round", label: "Round" },
            ]}
            onChange={appearance.onCornerRadius}
          />
        </Row>
        <Row
          label="Transcript layout"
          description="Full width keeps user prompts as a spanning card. Chat aligns them to the right with a max width, like a messaging app."
        >
          <Segmented
            label="Transcript layout"
            value={appearance.transcriptLayout}
            options={[
              { value: "full", label: "Full width" },
              { value: "chat", label: "Chat" },
            ]}
            onChange={appearance.onTranscriptLayout}
          />
        </Row>
        <Row
          label="Anchor prompts to top"
          description="When you send, the new prompt sits at the top of the transcript and the reply grows into the space below. Turn this off to keep the classic layout, with the latest message resting on the composer."
        >
          <Toggle
            label="Anchor prompts to top"
            on={appearance.transcriptAnchor}
            onChange={appearance.onTranscriptAnchor}
          />
        </Row>
      </Section>

      <Section title="Motion">
        <Row
          label="Reduce motion"
          description="Cut transitions and animations across the app. Nothing moves that does not have to."
        >
          <Toggle
            label="Reduce motion"
            on={appearance.reduceMotion}
            onChange={appearance.onReduceMotion}
          />
        </Row>
        <Row
          label="Composer mascot"
          description="When a turn is running, the project mascot runs along the composer, bonks the scroll-to-latest button the first time, then jumps it, and sometimes grabs a coin."
        >
          <Toggle
            label="Composer mascot"
            on={appearance.composerRunner}
            onChange={appearance.onComposerRunner}
          />
        </Row>
      </Section>
    </>
  );
}

function AccentSwatches({ value, onChange }: { value: number; onChange: (hue: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Accent" className="flex flex-wrap gap-2">
      {ACCENT_PRESETS.map((preset) => {
        const selected = preset.hue === value;
        return (
          <button
            key={preset.hue}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={preset.label}
            title={preset.label}
            onClick={() => onChange(preset.hue)}
            className={`size-6 rounded-full border-2 border-background-base transition-shadow ${
              selected ? "ring-2 ring-content/70" : "ring-1 ring-content/15 hover:ring-content/40"
            }`}
            style={{
              background: `hsl(${preset.hue} var(--accent-saturation, 62%) var(--accent-lightness, 58%))`,
            }}
          />
        );
      })}
    </div>
  );
}
