import { APP_COMMANDS } from "./commands";
import { profileStorage } from "./profiles/profileStorage";

const SECTION_KEY = "wavex.settingsSection";

export type SettingsSectionId =
  | "general"
  | "profiles"
  | "appearance"
  | "keybindings"
  | "providers"
  | "language-servers"
  | "archive";

export const SETTINGS_SECTIONS: {
  id: SettingsSectionId;
  label: string;
  description: string;
}[] = [
  {
    id: "general",
    label: "General",
    description: "App-wide behavior and the build you are running.",
  },
  {
    id: "profiles",
    label: "Profiles",
    description: "Separate identities inside one wavex, each with its own workspace.",
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, translucency, and the tint applied to the chrome.",
  },
  {
    id: "keybindings",
    label: "Keybindings",
    description: "Every shortcut the workspace handles, from the app menu and the key handler.",
  },
  {
    id: "providers",
    label: "Providers",
    description: "Agent CLIs wavex can drive, and the model new sessions start with.",
  },
  {
    id: "language-servers",
    label: "Language servers",
    description: "Language servers wavex can drive in the coding view, and where each one is.",
  },
  {
    id: "archive",
    label: "Archive",
    description: "Projects and conversations you have archived.",
  },
];

export const SETTINGS_SECTION_DEFAULT: SettingsSectionId = "general";

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

export function settingsSectionLabel(id: SettingsSectionId): string {
  return SETTINGS_SECTIONS.find((section) => section.id === id)?.label ?? "General";
}

export function settingsSectionDescription(id: SettingsSectionId): string {
  return SETTINGS_SECTIONS.find((section) => section.id === id)?.description ?? "";
}

export function loadSettingsSection(): SettingsSectionId {
  try {
    const raw = profileStorage.getItem(SECTION_KEY);
    return isSettingsSectionId(raw) ? raw : SETTINGS_SECTION_DEFAULT;
  } catch {
    return SETTINGS_SECTION_DEFAULT;
  }
}

export function saveSettingsSection(id: SettingsSectionId) {
  try {
    profileStorage.setItem(SECTION_KEY, id);
  } catch {
    // private mode / quota
  }
}

const COMPOSER_RUNNER_KEY = "wavex.composerRunner";

export const COMPOSER_RUNNER_DEFAULT = true;

/** Fired on `window` when the composer mascot setting flips. */
export const COMPOSER_RUNNER_CHANGE_EVENT = "wavex:composer-runner-change";

export function loadComposerRunner(): boolean {
  try {
    const raw = profileStorage.getItem(COMPOSER_RUNNER_KEY);
    if (raw == null) return COMPOSER_RUNNER_DEFAULT;
    return raw === "1" || raw === "true";
  } catch {
    return COMPOSER_RUNNER_DEFAULT;
  }
}

export function saveComposerRunner(value: boolean) {
  try {
    profileStorage.setItem(COMPOSER_RUNNER_KEY, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<boolean>(COMPOSER_RUNNER_CHANGE_EVENT, { detail: value }));
}

const NOTES_ENABLED_KEY = "wavex.notesEnabled";

export const NOTES_ENABLED_DEFAULT = true;

/** Fired on `window` when the Notes UI setting flips. */
export const NOTES_ENABLED_CHANGE_EVENT = "wavex:notes-enabled-change";

export function loadNotesEnabled(): boolean {
  try {
    const raw = profileStorage.getItem(NOTES_ENABLED_KEY);
    if (raw == null) return NOTES_ENABLED_DEFAULT;
    return raw === "1" || raw === "true";
  } catch {
    return NOTES_ENABLED_DEFAULT;
  }
}

export function saveNotesEnabled(value: boolean) {
  try {
    profileStorage.setItem(NOTES_ENABLED_KEY, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<boolean>(NOTES_ENABLED_CHANGE_EVENT, { detail: value }));
}

export function subscribeNotesEnabled(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(NOTES_ENABLED_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(NOTES_ENABLED_CHANGE_EVENT, onStoreChange);
}

const LIVE_AGENTS_ENABLED_KEY = "wavex.liveAgentsEnabled";

export const LIVE_AGENTS_ENABLED_DEFAULT = true;

/** Fired on `window` when the working-agents rail card setting flips. */
export const LIVE_AGENTS_ENABLED_CHANGE_EVENT = "wavex:live-agents-enabled-change";

export function loadLiveAgentsEnabled(): boolean {
  try {
    const raw = profileStorage.getItem(LIVE_AGENTS_ENABLED_KEY);
    if (raw == null) return LIVE_AGENTS_ENABLED_DEFAULT;
    return raw === "1" || raw === "true";
  } catch {
    return LIVE_AGENTS_ENABLED_DEFAULT;
  }
}

export function saveLiveAgentsEnabled(value: boolean) {
  try {
    profileStorage.setItem(LIVE_AGENTS_ENABLED_KEY, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(LIVE_AGENTS_ENABLED_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export function subscribeLiveAgentsEnabled(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(LIVE_AGENTS_ENABLED_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(LIVE_AGENTS_ENABLED_CHANGE_EVENT, onStoreChange);
}

const DIFF_VIEWER_KEY = "wavex.diffViewer";

export type DiffViewer = "editor" | "unified";

export const DIFF_VIEWER_DEFAULT: DiffViewer = "editor";

/** Fired on `window` when the working-tree diff layout flips. */
export const DIFF_VIEWER_CHANGE_EVENT = "wavex:diff-viewer-change";

function isDiffViewer(value: unknown): value is DiffViewer {
  return value === "editor" || value === "unified";
}

export function loadDiffViewer(): DiffViewer {
  try {
    const raw = profileStorage.getItem(DIFF_VIEWER_KEY);
    return isDiffViewer(raw) ? raw : DIFF_VIEWER_DEFAULT;
  } catch {
    return DIFF_VIEWER_DEFAULT;
  }
}

export function saveDiffViewer(value: DiffViewer) {
  const next = isDiffViewer(value) ? value : DIFF_VIEWER_DEFAULT;
  try {
    profileStorage.setItem(DIFF_VIEWER_KEY, next);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DiffViewer>(DIFF_VIEWER_CHANGE_EVENT, { detail: next }));
}

export function subscribeDiffViewer(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DIFF_VIEWER_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(DIFF_VIEWER_CHANGE_EVENT, onStoreChange);
}

const CLAUDE_HOOKS_KEY = "wavex.claudeHooks";

export const CLAUDE_HOOKS_DEFAULT = true;

export function loadClaudeHooks(): boolean {
  try {
    const raw = profileStorage.getItem(CLAUDE_HOOKS_KEY);
    if (raw == null) return CLAUDE_HOOKS_DEFAULT;
    return raw === "1" || raw === "true";
  } catch {
    return CLAUDE_HOOKS_DEFAULT;
  }
}

export function saveClaudeHooks(value: boolean) {
  try {
    profileStorage.setItem(CLAUDE_HOOKS_KEY, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
}

export type KeybindingRow = {
  command: string;
  keys: string;
  when: string;
};

/**
 * The shortcut half of the command catalog. Commands with no key never reach
 * this page; they are still reachable by name from the command palette.
 */
export const KEYBINDINGS: KeybindingRow[] = APP_COMMANDS.filter((command) => !!command.keys).map(
  (command) => ({ command: command.label, keys: command.keys as string, when: command.when }),
);

export function filterKeybindings(rows: KeybindingRow[], query: string): KeybindingRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (row) =>
      row.command.toLowerCase().includes(needle) ||
      row.keys.toLowerCase().includes(needle) ||
      row.when.toLowerCase().includes(needle),
  );
}
