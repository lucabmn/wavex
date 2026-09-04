import { ALT, IS_MAC, MOD, SHIFT } from "./platform";
import { fuzzyMatch } from "./fuzzy";

const CTRL = IS_MAC ? "⌃" : "Ctrl+";

/**
 * Every command the app can run by name. The keybindings settings page and the
 * command palette both read this list, so a shortcut can never be documented in
 * one place and missing from the other.
 */
export type CommandId =
  | "app.commandPalette"
  | "app.search"
  | "app.goToFile"
  | "app.findInFiles"
  | "app.openProject"
  | "app.newWindow"
  | "app.toggleSidebar"
  | "app.switchModel"
  | "app.switchProfile"
  | "app.settings"
  | "app.toggleMode"
  | "app.quickAsk"
  | "app.activity"
  | "app.inbox"
  | "app.notes"
  | "app.usage"
  | "tab.new"
  | "tab.closeOthers"
  | "tab.next"
  | "tab.prev"
  | "tab.cycleNext"
  | "tab.cyclePrev"
  | "tab.back"
  | "tab.forward"
  | "tab.activate"
  | "tab.activateLast"
  | "pane.close"
  | "pane.splitRight"
  | "pane.splitDown"
  | "pane.focusLeft"
  | "pane.focusRight"
  | "pane.focusUp"
  | "pane.focusDown"
  | "terminal.new"
  | "terminal.newTab"
  | "terminal.toggleDock"
  | "composer.steer"
  | "editor.find"
  | "editor.replace"
  | "diff.nextHunk"
  | "diff.prevHunk"
  | "diff.stage"
  | "diff.unstage"
  | "diff.discard";

export type AppCommand = {
  id: CommandId;
  /** "Group: Action". The palette groups on the part before the colon. */
  label: string;
  keys?: string;
  when: string;
  /**
   * A range binding (⌘1–8) or a key the palette cannot stand in for, such as a
   * diff review key that needs a cursor. Listed as a shortcut, never run by name.
   */
  listOnly?: boolean;
};

export const APP_COMMANDS: AppCommand[] = [
  { id: "app.commandPalette", label: "App: Command Palette", keys: `${MOD}K`, when: "Always" },
  // Shares ⌘F with the editor's find bar, which wins while an editor has focus.
  { id: "app.search", label: "App: Search", keys: `${MOD}F`, when: "!editorFocus" },
  { id: "app.goToFile", label: "App: Go to File", keys: `${MOD}P`, when: "Always" },
  { id: "app.findInFiles", label: "App: Find in Files", keys: `${MOD}${SHIFT}F`, when: "Always" },
  { id: "app.openProject", label: "App: Open Project", keys: `${MOD}O`, when: "Always" },
  { id: "app.newWindow", label: "App: New Window", keys: `${MOD}${SHIFT}N`, when: "Always" },
  { id: "app.toggleSidebar", label: "App: Toggle Sidebar", keys: `${MOD}B`, when: "Always" },
  { id: "app.switchModel", label: "App: Switch Model", keys: `${MOD}.`, when: "Always" },
  {
    id: "app.switchProfile",
    label: "App: Switch Profile",
    keys: `${MOD}${SHIFT}P`,
    when: "Always",
  },
  { id: "app.settings", label: "App: Settings", keys: `${MOD},`, when: "Always" },
  {
    id: "app.toggleMode",
    label: "App: Switch Work and Coding",
    keys: `${MOD}${SHIFT}M`,
    when: "Always",
  },
  { id: "app.quickAsk", label: "App: Quick Ask", keys: `${MOD}${SHIFT}Space`, when: "System-wide" },
  { id: "app.activity", label: "App: Agent Activity", keys: `${MOD}${SHIFT}A`, when: "Always" },
  { id: "app.inbox", label: "App: Inbox", when: "Always" },
  { id: "app.notes", label: "App: Notes", when: "Always" },
  { id: "app.usage", label: "App: Usage", when: "Always" },
  { id: "tab.new", label: "Tab: New", keys: `${MOD}T`, when: "Always" },
  { id: "tab.closeOthers", label: "Tab: Close Others", keys: `${MOD}${ALT}T`, when: "Always" },
  { id: "tab.next", label: "Tab: Next", keys: `${MOD}${SHIFT}]`, when: "Always" },
  { id: "tab.prev", label: "Tab: Previous", keys: `${MOD}${SHIFT}[`, when: "Always" },
  {
    id: "tab.cycleNext",
    label: "Tab: Cycle Next",
    keys: `${CTRL}Tab`,
    when: "Always",
    listOnly: true,
  },
  {
    id: "tab.cyclePrev",
    label: "Tab: Cycle Previous",
    keys: `${CTRL}${SHIFT}Tab`,
    when: "Always",
    listOnly: true,
  },
  { id: "tab.back", label: "Tab: Back", keys: `${MOD}[`, when: "Always" },
  { id: "tab.forward", label: "Tab: Forward", keys: `${MOD}]`, when: "Always" },
  {
    id: "tab.activate",
    label: "Tab: Activate 1–8",
    keys: `${MOD}1 … ${MOD}8`,
    when: "Always",
    listOnly: true,
  },
  { id: "tab.activateLast", label: "Tab: Activate Last", keys: `${MOD}9`, when: "Always" },
  { id: "pane.close", label: "Pane: Close", keys: `${MOD}W`, when: "Always" },
  { id: "pane.splitRight", label: "Pane: Split Right", keys: `${MOD}D`, when: "!editorFocus" },
  {
    id: "pane.splitDown",
    label: "Pane: Split Down",
    keys: `${MOD}${SHIFT}D`,
    when: "!editorFocus",
  },
  { id: "pane.focusLeft", label: "Pane: Focus Left", keys: `${MOD}${ALT}←`, when: "Always" },
  { id: "pane.focusRight", label: "Pane: Focus Right", keys: `${MOD}${ALT}→`, when: "Always" },
  { id: "pane.focusUp", label: "Pane: Focus Up", keys: `${MOD}${ALT}↑`, when: "Always" },
  { id: "pane.focusDown", label: "Pane: Focus Down", keys: `${MOD}${ALT}↓`, when: "Always" },
  { id: "terminal.new", label: "Terminal: New", keys: `${MOD}\``, when: "Always" },
  { id: "terminal.newTab", label: "Terminal: New Tab", keys: `${MOD}${SHIFT}\``, when: "Always" },
  { id: "terminal.toggleDock", label: "Terminal: Toggle Dock", keys: `${MOD}J`, when: "Always" },
  {
    // Follow-ups queue while a turn runs unless they steer; ⌥Enter always
    // steers instead, and this is the way past the queue.
    id: "composer.steer",
    label: "Composer: Steer Running Turn",
    keys: `${ALT}Enter`,
    when: "composerFocus",
    listOnly: true,
  },
  {
    id: "editor.find",
    label: "Editor: Find",
    keys: `${MOD}F`,
    when: "editorFocus",
    listOnly: true,
  },
  {
    id: "editor.replace",
    label: "Editor: Replace",
    keys: `${MOD}${ALT}F`,
    when: "editorFocus",
    listOnly: true,
  },
  { id: "diff.nextHunk", label: "Diff: Next Hunk", keys: "J", when: "diffFocus", listOnly: true },
  {
    id: "diff.prevHunk",
    label: "Diff: Previous Hunk",
    keys: "K",
    when: "diffFocus",
    listOnly: true,
  },
  {
    id: "diff.stage",
    label: "Diff: Stage Hunk or File",
    keys: `S / ${SHIFT}S`,
    when: "diffFocus",
    listOnly: true,
  },
  { id: "diff.unstage", label: "Diff: Unstage File", keys: "U", when: "diffFocus", listOnly: true },
  { id: "diff.discard", label: "Diff: Discard File", keys: "D", when: "diffFocus", listOnly: true },
];

export type PaletteEntry = {
  command: AppCommand;
  /** Characters of the label the query matched, for highlighting. */
  positions: number[];
  score: number;
};

/**
 * The palette is the single entry point for keyboard navigation. A leading
 * character selects what it searches, so ⌘K covers what used to be four
 * overlapping finders (palette, go-to-file, search, project search):
 *
 * - `> commands` (default, prefix optional) — run an app command by name
 * - `@ files` — jump to a file, same destination as ⌘P
 * - `# search` — search across conversations and file contents
 * - `? shortcuts` — every documented shortcut, including list-only keys
 */
export type PaletteMode = "commands" | "files" | "search" | "help";

export const PALETTE_MODES: Record<
  PaletteMode,
  { prefix: string; label: string; placeholder: string; empty: string }
> = {
  commands: {
    prefix: ">",
    label: "Commands",
    placeholder: "Run a command",
    empty: "No matching command",
  },
  files: {
    prefix: "@",
    label: "Files",
    placeholder: "Go to file…",
    empty: "No file command matches",
  },
  search: {
    prefix: "#",
    label: "Search",
    placeholder: "Search conversations and files…",
    empty: "No search command matches",
  },
  help: {
    prefix: "?",
    label: "Shortcuts",
    placeholder: "Search all shortcuts…",
    empty: "No shortcut matches",
  },
};

const PALETTE_MODE_BY_PREFIX: Record<string, PaletteMode> = {
  ">": "commands",
  "@": "files",
  "#": "search",
  "?": "help",
};

/** Split a palette query into its mode prefix and the remaining needle. */
export function parsePaletteQuery(query: string): { mode: PaletteMode; rest: string } {
  const trimmed = query.trimStart();
  const mode = PALETTE_MODE_BY_PREFIX[trimmed[0]];
  if (!mode) return { mode: "commands", rest: query };
  return { mode, rest: trimmed.slice(1).trimStart() };
}

/** Command ids each non-default mode searches. Help sees the full catalog. */
const FILE_COMMANDS: ReadonlySet<CommandId> = new Set(["app.goToFile", "app.openProject"]);
const SEARCH_COMMANDS: ReadonlySet<CommandId> = new Set([
  "app.search",
  "app.findInFiles",
  "app.goToFile",
]);

/**
 * Palette rows: only commands the caller can actually run, ranked by the query.
 * An empty query keeps catalog order, which puts the app-wide verbs first.
 * A leading mode prefix (`>`, `@`, `#`, `?`) narrows the searched commands;
 * `?` also lists list-only shortcuts, which are documentation elsewhere.
 */
export function paletteEntries(
  commands: readonly AppCommand[],
  runnable: ReadonlySet<CommandId>,
  query: string,
): PaletteEntry[] {
  const { mode, rest } = parsePaletteQuery(query);
  const scope = mode === "files" ? FILE_COMMANDS : mode === "search" ? SEARCH_COMMANDS : null;
  const available = commands.filter((command) => {
    // Help documents every shortcut, including list-only keys the palette
    // cannot run. Everywhere else only runnable commands are offered.
    if (mode === "help") return runnable.has(command.id) || !!command.listOnly;
    if (command.listOnly || !runnable.has(command.id)) return false;
    return scope === null || scope.has(command.id);
  });
  const needle = rest.trim();
  if (!needle) {
    return available.map((command) => ({ command, positions: [], score: 0 }));
  }
  const entries: PaletteEntry[] = [];
  for (const command of available) {
    const hit = fuzzyMatch(needle, command.label);
    if (!hit) continue;
    entries.push({ command, positions: hit.positions, score: hit.score });
  }
  return entries.sort(
    (a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label),
  );
}
