import type { HarnessId } from "./session";
import { HARNESSES, HARNESS_LABEL, HARNESS_TITLE } from "./session";
import { profileStorage } from "./profiles/profileStorage";

export type ModelSettingChoice = {
  value: string;
  label: string;
};

export type ModelSetting = {
  id: string;
  label: string;
  kind: "select" | "toggle";
  value: string;
  options: ModelSettingChoice[];
  description?: string;
};

export type AgentModel = {
  id: string;
  harness: HarnessId;
  name: string;
  nativeId?: string;
  settings?: ModelSetting[];
  /** Context window, when the harness catalog reports one. */
  contextWindow?: number;
};

export const MODELS: AgentModel[] = [
  {
    id: "claude:sonnet-5",
    harness: "claude",
    name: "Claude Sonnet 5",
    nativeId: "claude-sonnet-5",
  },
  {
    id: "claude:opus-5",
    harness: "claude",
    name: "Claude Opus 5",
    nativeId: "claude-opus-5",
  },
  {
    id: "claude:fable-5",
    harness: "claude",
    name: "Claude Fable 5",
    nativeId: "claude-fable-5",
  },
  {
    id: "claude:opus-4.6",
    harness: "claude",
    name: "Opus 4.6",
    nativeId: "claude-opus-4-6",
  },
  {
    id: "claude:sonnet-4.6",
    harness: "claude",
    name: "Sonnet 4.6",
    nativeId: "claude-sonnet-4-6",
  },
  {
    id: "claude:haiku-4.5",
    harness: "claude",
    name: "Haiku 4.5",
    nativeId: "claude-haiku-4-5",
  },
  {
    id: "claude:opus-4.5",
    harness: "claude",
    name: "Opus 4.5",
    nativeId: "claude-opus-4-5",
  },

  {
    id: "cursor:composer-2.5",
    harness: "cursor",
    name: "Composer 2.5",
    nativeId: "composer-2.5",
  },
  {
    id: "cursor:gpt-5.4",
    harness: "cursor",
    name: "GPT-5.4",
    nativeId: "gpt-5.4",
  },
  {
    id: "cursor:claude-sonnet-4-6",
    harness: "cursor",
    name: "Sonnet 4.6",
    nativeId: "claude-sonnet-4-6",
  },
  {
    id: "cursor:grok-4.6",
    harness: "cursor",
    name: "Cursor Grok 4.6",
    nativeId: "grok-4.6",
  },

  {
    id: "grok:grok-4.6",
    harness: "grok",
    name: "Grok 4.6",
    nativeId: "grok-4.6",
    contextWindow: 500_000,
    settings: [
      {
        id: "effort",
        label: "Reasoning",
        kind: "select",
        value: "high",
        options: [
          { value: "xhigh", label: "Extra High" },
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
        ],
      },
    ],
  },
  {
    id: "grok:grok-4.5",
    harness: "grok",
    name: "Grok 4.5",
    nativeId: "grok-4.5",
    contextWindow: 500_000,
    settings: [
      {
        id: "effort",
        label: "Reasoning",
        kind: "select",
        value: "high",
        options: [
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
        ],
      },
    ],
  },

  { id: "opencode:glm-5", harness: "opencode", name: "GLM 5" },
  { id: "opencode:minimax-m2.5", harness: "opencode", name: "MiniMax M2.5" },
  { id: "opencode:kimi-k2.5", harness: "opencode", name: "Kimi K2.5" },
  {
    id: "opencode:deepseek-v4-flash",
    harness: "opencode",
    name: "DeepSeek V4 Flash",
  },
  { id: "opencode:qwen-3.5", harness: "opencode", name: "Qwen 3.5" },
  { id: "opencode:grok-4.5", harness: "opencode", name: "Grok 4.5" },
  {
    id: "opencode:claude-sonnet-4.6",
    harness: "opencode",
    name: "Claude Sonnet 4.6",
  },
  { id: "opencode:gpt-5.4", harness: "opencode", name: "GPT-5.4" },
  {
    id: "pi:default",
    harness: "pi",
    name: "Default",
    nativeId: "",
  },
  {
    id: "omp:default",
    harness: "omp",
    name: "Default",
    nativeId: "",
  },
  {
    id: "fx:zai/glm-5.2-fast",
    harness: "fx",
    name: "GLM 5.2 Fast",
    nativeId: "zai/glm-5.2-fast",
  },
];

export const DEFAULT_MODEL_ID: Record<HarnessId, string> = {
  claude: "claude:sonnet-5",
  codex: "",
  cursor: "cursor:composer-2.5",
  grok: "grok:grok-4.6",
  opencode: "opencode:glm-5",
  pi: "pi:default",
  omp: "omp:default",
  fx: "fx:zai/glm-5.2-fast",
};

const FAVORITES_KEY = "wavex.favoriteModels";
const MODEL_PICKER_TAB_KEY = "wavex.modelPickerTab";
const HIDDEN_PICKER_PROVIDERS_KEY = "wavex.hiddenPickerProviders";
const DISABLED_MODELS_KEY = "wavex.disabledModels";
const LAST_MODEL_KEY = "wavex.lastModel";
const LAST_MODEL_SETTINGS_KEY = "wavex.lastModelSettings";
const DEFAULT_MODELS_KEY = "wavex.defaultModels";
const GIT_WRITING_MODEL_KEY = "wavex.gitWritingModel";

/** Fired on `window` when the git-writing provider/model choice flips. */
export const GIT_WRITING_CHANGE_EVENT = "wavex:git-writing-change";

export type ModelPickerTab = "favorites" | HarnessId;

export type LastModelChoice = {
  harness: HarnessId;
  model: string;
};

const HARNESS_ORDER: HarnessId[] = [
  "claude",
  "codex",
  "cursor",
  "grok",
  "opencode",
  "pi",
  "omp",
  "fx",
];

const EMPTY_MODELS: AgentModel[] = [];

let overlays: Partial<Record<HarnessId, AgentModel[]>> = {};
let overlayDefaults: Partial<Record<HarnessId, string>> = {};
let catalogVersion = 0;
const listeners = new Set<() => void>();

function emit() {
  catalogVersion += 1;
  baseByHarness = null;
  indexById = null;
  allCache = null;
  enabledByHarness = null;
  for (const listener of listeners) listener();
}

export function subscribeModels(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getModelSnapshot(): number {
  return catalogVersion;
}

export function setHarnessModels(harness: HarnessId, models: AgentModel[]) {
  if (models.length === 0) return;
  overlays = { ...overlays, [harness]: models };
  overlayDefaults = {
    ...overlayDefaults,
    [harness]: pickDefaultId(harness, models),
  };
  emit();
}

/** True after a live CLI catalog has replaced the built-in fallback list. */
export function hasLiveCatalog(harness: HarnessId): boolean {
  return overlays[harness] != null;
}

/** Test seam. */
export function resetHarnessModelOverlays() {
  overlays = {};
  overlayDefaults = {};
  disabledModels = null;
  enabledByHarness = null;
  emit();
}

export function defaultModelId(harness: HarnessId): string {
  return overlayDefaults[harness] ?? DEFAULT_MODEL_ID[harness];
}

// `modelsFor`/`findModel` sit in render bodies (every session card, every
// provider row, the picker itself), so they must not rebuild the catalog on
// each call. These caches are dropped in `emit()` whenever an overlay lands.
let baseByHarness: Partial<Record<HarnessId, AgentModel[]>> | null = null;
let allCache: AgentModel[] | null = null;
let indexById: Map<string, AgentModel> | null = null;

function baseModelsFor(harness: HarnessId): AgentModel[] {
  if (!baseByHarness) {
    const grouped: Partial<Record<HarnessId, AgentModel[]>> = {};
    for (const model of MODELS) {
      (grouped[model.harness] ??= []).push(model);
    }
    baseByHarness = grouped;
  }
  return baseByHarness[harness] ?? EMPTY_MODELS;
}

export function modelsFor(harness: HarnessId): AgentModel[] {
  return overlays[harness] ?? baseModelsFor(harness);
}

/**
 * Search text for one model. A catalog id is what a user types — fx names
 * `zai/glm-5.3-flash` "Glm 5.3 Flash", so a name-only haystack cannot match the
 * string the fx CLI prints. Separators collapse to spaces on both sides so
 * `zai/glm`, `glm-5.3`, and `glm 5.3 flash` all reach the same entry.
 */
function modelHaystack(model: AgentModel): string {
  return normalizeModelSearchText(
    `${model.name} ${model.nativeId ?? ""} ${model.id} ${HARNESS_TITLE[model.harness]} ${HARNESS_LABEL[model.harness]}`,
  );
}

function normalizeModelSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s/_-]+/g, " ")
    .trim();
}

/** Every whitespace-separated term must appear; no fuzzy scoring. */
export function modelMatchesQuery(model: AgentModel, query: string): boolean {
  const needle = normalizeModelSearchText(query);
  if (!needle) return true;
  const hay = modelHaystack(model);
  return needle.split(" ").every((term) => hay.includes(term));
}

export function filterModels(models: AgentModel[], query: string): AgentModel[] {
  if (!query.trim()) return models;
  return models.filter((model) => modelMatchesQuery(model, query));
}

export function allModels(): AgentModel[] {
  return (allCache ??= HARNESS_ORDER.flatMap(modelsFor));
}

export function findModel(id: string): AgentModel | undefined {
  if (!indexById) {
    const index = new Map<string, AgentModel>();
    // First writer wins, matching the previous `allModels().find(...)` order.
    for (const model of allModels()) {
      if (!index.has(model.id)) index.set(model.id, model);
    }
    indexById = index;
  }
  return indexById.get(id);
}

export function resolveModel(harness: HarnessId, id?: string): AgentModel {
  const available = modelsFor(harness);
  if (id) {
    const exact = findModel(id);
    if (exact && exact.harness === harness) return exact;
    const slug = nativeIdFrom(id);
    const byNative = available.find((model) => (model.nativeId ?? nativeIdFrom(model.id)) === slug);
    if (byNative) return byNative;
    const prefix = available.find((model) => {
      const native = model.nativeId ?? nativeIdFrom(model.id);
      return native.startsWith(slug) || slug.startsWith(native);
    });
    if (prefix) return prefix;
  }
  const fallbackId = defaultModelId(harness);
  return (
    (fallbackId ? findModel(fallbackId) : undefined) ??
    available[0] ??
    MODELS.find((model) => model.harness === harness) ??
    MODELS[0]
  );
}

/** Catalog-reported context window for a model id, when known. */
export function modelContextWindow(id: string): number | undefined {
  const window = findModel(id)?.contextWindow;
  return window && window > 0 ? window : undefined;
}

export function nativeModelId(model: AgentModel | string): string {
  if (typeof model !== "string") {
    return model.nativeId ?? nativeIdFrom(model.id);
  }
  return findModel(model)?.nativeId ?? nativeIdFrom(model);
}

export function defaultModelSettings(model: AgentModel): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const setting of model.settings ?? []) {
    settings[setting.id] = setting.value;
  }
  return settings;
}

export function mergeModelSettings(
  model: AgentModel,
  current?: Record<string, string>,
): Record<string, string> {
  const next = defaultModelSettings(model);
  if (!current) return next;
  for (const setting of model.settings ?? []) {
    const value = compatibleSettingValue(setting, current[setting.id]);
    if (value != null) next[setting.id] = value;
  }
  return next;
}

/** Last chosen effort/fast/etc., applied to any model that supports those values. */
export function preferredModelSettings(
  model: AgentModel,
  current?: Record<string, string>,
): Record<string, string> {
  return mergeModelSettings(model, {
    ...current,
    ...loadLastModelSettings(),
  });
}

export function loadLastModelSettings(): Record<string, string> {
  try {
    const raw = profileStorage.getItem(LAST_MODEL_SETTINGS_KEY);
    if (!raw) return {};
    return parseStringRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveLastModelSettings(
  settings: Record<string, string>,
  mode: "overwrite" | "fill" = "overwrite",
) {
  const prev = loadLastModelSettings();
  const incoming = parseStringRecord(settings);
  const next = mode === "fill" ? { ...incoming, ...prev } : { ...prev, ...incoming };
  try {
    profileStorage.setItem(LAST_MODEL_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
}

/** Compound launch id, e.g. `claude-opus-4-8[effort=high,fast=false]`. */
export function encodeModelLaunchId(modelId: string, settings?: Record<string, string>): string {
  const model = findModel(modelId);
  const native = nativeModelId(model ?? modelId);
  const defs = model?.settings ?? [];
  if (!native || defs.length === 0) return native;
  const parts = defs.map((setting) => `${setting.id}=${settings?.[setting.id] ?? setting.value}`);
  return `${native}[${parts.join(",")}]`;
}

export function loadFavoriteModels(): string[] {
  try {
    const raw = profileStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function saveFavoriteModels(ids: string[]) {
  try {
    profileStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    // private mode / quota
  }
}

function isHarnessId(value: string): value is HarnessId {
  return HARNESS_ORDER.includes(value as HarnessId);
}

export function loadModelPickerTab(): ModelPickerTab {
  try {
    const raw = profileStorage.getItem(MODEL_PICKER_TAB_KEY);
    if (!raw) return "favorites";
    if (raw === "favorites") return "favorites";
    if (isHarnessId(raw)) return raw;
    return "favorites";
  } catch {
    return "favorites";
  }
}

export function saveModelPickerTab(tab: ModelPickerTab) {
  try {
    profileStorage.setItem(MODEL_PICKER_TAB_KEY, tab);
  } catch {
    // private mode / quota
  }
}

let pickerVisibilityVersion = 0;
const pickerVisibilityListeners = new Set<() => void>();

function emitPickerVisibility() {
  pickerVisibilityVersion += 1;
  disabledModels = null;
  enabledByHarness = null;
  for (const listener of pickerVisibilityListeners) listener();
}

export function subscribePickerVisibility(onStoreChange: () => void): () => void {
  pickerVisibilityListeners.add(onStoreChange);
  return () => {
    pickerVisibilityListeners.delete(onStoreChange);
  };
}

export function getPickerVisibilitySnapshot(): number {
  return pickerVisibilityVersion;
}

export function loadHiddenPickerProviders(): HarnessId[] {
  try {
    const raw = profileStorage.getItem(HIDDEN_PICKER_PROVIDERS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is HarnessId => typeof id === "string" && isHarnessId(id));
  } catch {
    return [];
  }
}

export function isPickerProviderVisible(id: HarnessId): boolean {
  return !loadHiddenPickerProviders().includes(id);
}

export function savePickerProviderVisible(id: HarnessId, visible: boolean) {
  const hidden = new Set(loadHiddenPickerProviders());
  if (visible) hidden.delete(id);
  else hidden.add(id);
  try {
    profileStorage.setItem(HIDDEN_PICKER_PROVIDERS_KEY, JSON.stringify([...hidden]));
  } catch {
    // private mode / quota
  }
  emitPickerVisibility();
}

/**
 * A model the user turned off in Settings. The catalog keeps it: a session
 * started on that model has to resume on it, and `resolveModel` has to keep
 * finding it. Only the places a new choice is made — the picker, race, second
 * opinion — read the filtered list.
 */
let disabledModels: Set<string> | null = null;

export function loadDisabledModels(): Set<string> {
  if (disabledModels) return disabledModels;
  try {
    const raw = profileStorage.getItem(DISABLED_MODELS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    disabledModels = new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    disabledModels = new Set<string>();
  }
  return disabledModels;
}

export function isModelEnabled(id: string): boolean {
  return !loadDisabledModels().has(id);
}

/**
 * The models of one provider a new conversation may still be started on. Like
 * `modelsFor`, this sits in render bodies — the race menu asks once per
 * provider per render — so the filtered list is cached until the catalog or
 * the off list moves.
 */
let enabledByHarness: Partial<Record<HarnessId, AgentModel[]>> | null = null;

export function enabledModelsFor(harness: HarnessId): AgentModel[] {
  const disabled = loadDisabledModels();
  if (disabled.size === 0) return modelsFor(harness);
  enabledByHarness ??= {};
  return (enabledByHarness[harness] ??= modelsFor(harness).filter(
    (model) => !disabled.has(model.id),
  ));
}

export function setModelEnabled(id: string, enabled: boolean) {
  const next = new Set(loadDisabledModels());
  if (enabled) next.delete(id);
  else next.add(id);
  try {
    profileStorage.setItem(DISABLED_MODELS_KEY, JSON.stringify([...next]));
  } catch {
    // private mode / quota
  }
  disabledModels = next;
  if (!enabled) repointDefaultsAway(id, next);
  emitPickerVisibility();
}

/**
 * Turning off the model a provider starts with would leave that provider
 * pointing at something the picker no longer offers, so the default moves to
 * the first model still on. A provider with nothing left keeps its pointer and
 * reads as having no models, the same as one whose CLI is missing.
 */
function repointDefaultsAway(id: string, disabled: Set<string>) {
  const model = findModel(id);
  if (!model) return;
  const replacement = modelsFor(model.harness).find((entry) => !disabled.has(entry.id));
  if (!replacement) return;
  if (loadDefaultModels()[model.harness] === id) {
    saveDefaultModel(model.harness, replacement.id);
  }
  const last = loadLastModelChoice();
  if (last?.harness === model.harness && last.model === id) {
    saveLastModelChoice(model.harness, replacement.id);
  }
}

/**
 * Installed providers the user has not hidden appear as picker tabs.
 * Before the first probe we keep them visible so the tab strip does not
 * collapse to Favorites and then jump once CLIs are found.
 */
export function showProviderInModelPicker(
  id: HarnessId,
  installed: boolean,
  probed: boolean,
): boolean {
  if (!isPickerProviderVisible(id)) return false;
  return !probed || installed;
}

export function modelPickerTabs(available: (id: HarnessId) => boolean): ModelPickerTab[] {
  return ["favorites", ...HARNESSES.filter(available)];
}

export function coerceModelPickerTab(
  tab: ModelPickerTab,
  available: (id: HarnessId) => boolean,
): ModelPickerTab {
  const tabs = modelPickerTabs(available);
  return tabs.includes(tab) ? tab : "favorites";
}

export function stepModelPickerTab(
  tab: ModelPickerTab,
  delta: -1 | 1,
  available: (id: HarnessId) => boolean,
): ModelPickerTab {
  const tabs = modelPickerTabs(available);
  if (tabs.length === 0) return tab;
  const index = tabs.indexOf(tab);
  const from = index < 0 ? 0 : index;
  return tabs[(from + delta + tabs.length) % tabs.length] ?? tab;
}

export function loadDefaultModels(): Partial<Record<HarnessId, string>> {
  try {
    const raw = profileStorage.getItem(DEFAULT_MODELS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Partial<Record<HarnessId, string>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isHarnessId(key) && typeof value === "string" && value) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveDefaultModel(harness: HarnessId, model: string) {
  const next = { ...loadDefaultModels(), [harness]: model };
  try {
    profileStorage.setItem(DEFAULT_MODELS_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
}

/** User-picked model for a provider, else the catalog default. */
export function preferredModelId(harness: HarnessId): string {
  const saved = loadDefaultModels()[harness];
  if (saved) return saved;
  const last = loadLastModelChoice();
  if (last?.harness === harness) return last.model;
  return defaultModelId(harness);
}

/** Provider + model new conversations should start with. */
export function defaultSessionChoice(): LastModelChoice {
  const last = loadLastModelChoice();
  const harness = last?.harness ?? "cursor";
  return { harness, model: preferredModelId(harness) };
}

export function loadLastModelChoice(): LastModelChoice | null {
  try {
    const raw = profileStorage.getItem(LAST_MODEL_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed != null &&
      "harness" in parsed &&
      "model" in parsed &&
      typeof (parsed as LastModelChoice).harness === "string" &&
      typeof (parsed as LastModelChoice).model === "string" &&
      isHarnessId((parsed as LastModelChoice).harness)
    ) {
      return parsed as LastModelChoice;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLastModelChoice(harness: HarnessId, model: string) {
  saveDefaultModel(harness, model);
  try {
    profileStorage.setItem(LAST_MODEL_KEY, JSON.stringify({ harness, model }));
  } catch {
    // private mode / quota
  }
}

/**
 * Provider + model used for git writings: commit messages, PR content, and
 * branch names. Stored per profile like the other model preferences. Until
 * the user picks one explicitly, writings follow the new-session default.
 */
export type GitWritingChoice = {
  harness: HarnessId;
  model: string;
};

export function loadGitWritingChoice(): GitWritingChoice | null {
  try {
    const raw = profileStorage.getItem(GIT_WRITING_MODEL_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed != null &&
      "harness" in parsed &&
      "model" in parsed &&
      typeof (parsed as GitWritingChoice).harness === "string" &&
      typeof (parsed as GitWritingChoice).model === "string" &&
      isHarnessId((parsed as GitWritingChoice).harness) &&
      (parsed as GitWritingChoice).model.trim().length > 0
    ) {
      return parsed as GitWritingChoice;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveGitWritingChoice(harness: HarnessId, model: string) {
  const trimmed = model.trim();
  if (!trimmed) return;
  try {
    profileStorage.setItem(GIT_WRITING_MODEL_KEY, JSON.stringify({ harness, model: trimmed }));
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GIT_WRITING_CHANGE_EVENT));
}

export function subscribeGitWritingChoice(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(GIT_WRITING_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(GIT_WRITING_CHANGE_EVENT, onStoreChange);
}

/** Saved git-writing choice, else the model new sessions start with. */
export function gitWritingChoice(): GitWritingChoice {
  return loadGitWritingChoice() ?? defaultSessionChoice();
}

/**
 * Native model id the git-writing choice resolves to for `harness`, or
 * `undefined` when the choice belongs to another provider. Lets each
 * harness's cheap text default stand aside once the user picked a model for
 * that provider — even before its live catalog has loaded, via the slug.
 */
export function gitWritingModelNativeId(harness: HarnessId): string | undefined {
  const saved = loadGitWritingChoice();
  if (!saved || saved.harness !== harness) return undefined;
  const trimmed = saved.model.trim();
  if (!trimmed) return undefined;
  const exact = findModel(trimmed);
  if (exact) {
    return exact.harness === harness ? nativeModelId(exact) : undefined;
  }
  const colon = trimmed.indexOf(":");
  if (colon >= 0) {
    if (trimmed.slice(0, colon) !== harness) return undefined;
    const slug = trimmed
      .slice(colon + 1)
      .split("[", 1)[0]
      ?.trim();
    return slug ? slug : undefined;
  }
  return trimmed;
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

/** Cursor CLI uses `extra-high`; Claude uses `xhigh`. */
const SETTING_VALUE_ALIASES: Record<string, string> = {
  "extra-high": "xhigh",
  xhigh: "extra-high",
};

function compatibleSettingValue(
  setting: ModelSetting,
  value: string | undefined,
): string | undefined {
  if (value == null) return undefined;
  if (setting.options.some((option) => option.value === value)) return value;
  const alias = SETTING_VALUE_ALIASES[value];
  if (alias && setting.options.some((option) => option.value === alias)) {
    return alias;
  }
  return undefined;
}

function nativeIdFrom(id: string): string {
  const trimmed = id.trim();
  const colon = trimmed.indexOf(":");
  const slug = colon >= 0 ? trimmed.slice(colon + 1) : trimmed;
  const bracket = slug.indexOf("[");
  return bracket >= 0 ? slug.slice(0, bracket) : slug;
}

function pickDefaultId(harness: HarnessId, models: AgentModel[]): string {
  if (harness === "claude") {
    return (
      models.find((model) => model.nativeId === "claude-sonnet-5")?.id ??
      models.find((model) => model.nativeId === "sonnet")?.id ??
      models.find((model) => model.id === DEFAULT_MODEL_ID.claude)?.id ??
      models[0]?.id ??
      DEFAULT_MODEL_ID.claude
    );
  }
  if (harness === "cursor") {
    return (
      models.find((model) => model.nativeId === "composer-2.5")?.id ??
      models.find((model) => model.nativeId === "default" || model.nativeId === "auto")?.id ??
      models[0]?.id ??
      DEFAULT_MODEL_ID.cursor
    );
  }
  if (harness === "codex") {
    return models[0]?.id ?? "";
  }
  if (harness === "grok") {
    return (
      models.find((model) => model.nativeId === "grok-4.6")?.id ??
      models.find((model) => model.id === DEFAULT_MODEL_ID.grok)?.id ??
      models[0]?.id ??
      DEFAULT_MODEL_ID.grok
    );
  }
  if (harness === "fx") {
    const preferred = [
      "zai/glm-5.2-fast",
      "zai/glm-5.2",
      "zai/glm-4.7-flash",
      "zai/glm-4.7",
      "openai/gpt-5.2",
    ];
    for (const nativeId of preferred) {
      const hit = models.find((model) => model.nativeId === nativeId);
      if (hit) return hit.id;
    }
    return (
      models.find((model) => model.id === DEFAULT_MODEL_ID.fx)?.id ??
      models[0]?.id ??
      DEFAULT_MODEL_ID.fx
    );
  }
  return (
    models.find((model) => model.id === DEFAULT_MODEL_ID[harness])?.id ??
    models[0]?.id ??
    DEFAULT_MODEL_ID[harness]
  );
}
