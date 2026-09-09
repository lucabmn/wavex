import type { CSSProperties } from "react";
import { EMPTY_BROWSER_HISTORY, type BrowserHistory } from "./browserHistory";
import {
  newEditorPane,
  nextTerminalTitleFromFiles,
  type EditorPane,
  type FilePaneTab,
  type WorkspaceTab,
} from "./layout";
import { profileStorage } from "../profiles/profileStorage";
import { normalizeProjectPath, sameProjectPath } from "../recents";
import type { Session } from "../session";
import { applyTerminalMeta, type TerminalMetaPatch } from "../terminal/terminalTab";
import { workspaceTabCwd } from "./workspaceTabGroups";

export type DockSide = "top" | "bottom" | "left" | "right";

/**
 * What the dock is showing. One dock per project holds them all, so switching
 * between them is a change of which one paints — never a teardown of the rest,
 * whose terminals, page, and scroll positions have to survive it.
 */
export type DockSurface = "sessions" | "browser" | "terminal" | "files" | "review";

export const DOCK_SURFACES: readonly DockSurface[] = [
  "sessions",
  "browser",
  "terminal",
  "files",
  "review",
];

export const DOCK_SURFACE_LABEL: Record<DockSurface, string> = {
  sessions: "Sessions",
  browser: "Browser",
  terminal: "Terminal",
  files: "Files",
  review: "Review",
};

export type ProjectDock = {
  projectPath: string;
  pane: EditorPane;
  side: DockSide;
  size: number;
  open: boolean;
  surface: DockSurface;
  browser: BrowserHistory;
};

export const DOCK_SIZE_DEFAULT = {
  top: 220,
  bottom: 220,
  left: 360,
  right: 360,
} as const;

const DOCK_SIDE_KEY = "wavex.panelSide";

const VERTICAL_MIN = 88;
const HORIZONTAL_MIN = 180;

export function isDockSide(value: unknown): value is DockSide {
  return value === "top" || value === "bottom" || value === "left" || value === "right";
}

export function isDockSurface(value: unknown): value is DockSurface {
  return DOCK_SURFACES.includes(value as DockSurface);
}

/**
 * Where the panel sits until somebody moves it. Every surface it holds — the
 * session list, a page, a tree, a diff — is read in a tall narrow column beside
 * the editor, so one side answers for the panel rather than for each surface:
 * an edge that moved under the user whenever they switched surfaces would be a
 * layout they never chose.
 */
export function defaultDockSide(): DockSide {
  return "right";
}

/**
 * The side the user last moved a panel to, which is where the next project's
 * panel opens. Where the panel lives is one answer for the app, not one per
 * checkout — a default kept per project would ask again for every new one.
 */
export function loadDockSide(): DockSide {
  try {
    const raw = profileStorage.getItem(DOCK_SIDE_KEY);
    return isDockSide(raw) ? raw : defaultDockSide();
  } catch {
    return defaultDockSide();
  }
}

export function saveDockSide(side: DockSide) {
  try {
    profileStorage.setItem(DOCK_SIDE_KEY, side);
  } catch {
    // private mode / quota
  }
}

export function isVerticalDock(side: DockSide): boolean {
  return side === "top" || side === "bottom";
}

export function defaultDockSize(side: DockSide): number {
  return DOCK_SIZE_DEFAULT[side];
}

export function clampDockSize(
  side: DockSide,
  value: number,
  viewport: { width: number; height: number } = {
    width: 1280,
    height: 800,
  },
): number {
  const vertical = isVerticalDock(side);
  const min = vertical ? VERTICAL_MIN : HORIZONTAL_MIN;
  const span = vertical ? viewport.height : viewport.width;
  const max = Math.max(min, Math.floor(span * 0.7));
  if (!Number.isFinite(value)) return defaultDockSize(side);
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function findProjectDock(
  docks: ProjectDock[],
  projectPath: string,
): ProjectDock | undefined {
  return docks.find((dock) => sameProjectPath(dock.projectPath, projectPath));
}

export function emptyDockPane(): EditorPane {
  return { id: crypto.randomUUID(), files: [], activeFileId: "" };
}

export function createProjectDock(
  projectPath: string,
  options: { file?: FilePaneTab; surface?: DockSurface; side?: DockSide } = {},
): ProjectDock {
  const surface = options.surface ?? (options.file ? "terminal" : "sessions");
  const side = options.side ?? defaultDockSide();
  return {
    projectPath: normalizeProjectPath(projectPath),
    pane: options.file ? newEditorPane(options.file) : emptyDockPane(),
    side,
    size: defaultDockSize(side),
    open: true,
    surface,
    browser: EMPTY_BROWSER_HISTORY,
  };
}

export function addTerminalToDock(dock: ProjectDock, file: FilePaneTab): ProjectDock {
  return {
    ...dock,
    open: true,
    surface: "terminal",
    pane: {
      ...dock.pane,
      files: [...dock.pane.files, file],
      activeFileId: file.id,
    },
  };
}

export function nextDockTerminalTitle(dock: ProjectDock, cwd: string): string {
  return nextTerminalTitleFromFiles(dock.pane.files, cwd);
}

/**
 * The dock outlives its last terminal, because the Browser it is also holding
 * has a page in it. Closing the last one while the terminals are showing still
 * puts the dock away, which is what closing the last terminal always did.
 */
export function closeTerminalInDock(dock: ProjectDock, fileId: string): ProjectDock {
  const index = dock.pane.files.findIndex((file) => file.id === fileId);
  if (index < 0) return dock;
  const files = dock.pane.files.filter((file) => file.id !== fileId);
  if (files.length === 0) {
    return {
      ...dock,
      pane: { ...dock.pane, files, activeFileId: "" },
      open: dock.surface === "terminal" ? false : dock.open,
    };
  }
  const activeFileId =
    dock.pane.activeFileId === fileId
      ? files[Math.min(index, files.length - 1)].id
      : dock.pane.activeFileId;
  return { ...dock, pane: { ...dock.pane, files, activeFileId } };
}

export function selectDockTerminal(dock: ProjectDock, fileId: string): ProjectDock {
  if (!dock.pane.files.some((file) => file.id === fileId) || dock.pane.activeFileId === fileId) {
    return dock;
  }
  return { ...dock, pane: { ...dock.pane, activeFileId: fileId } };
}

export function reorderDockTerminals(dock: ProjectDock, files: FilePaneTab[]): ProjectDock {
  return { ...dock, pane: { ...dock.pane, files } };
}

export function patchDockTerminal(
  dock: ProjectDock,
  fileId: string,
  patch: TerminalMetaPatch,
): ProjectDock {
  let changed = false;
  const files = dock.pane.files.map((file) => {
    if (!file.terminal || file.id !== fileId) return file;
    const next = applyTerminalMeta(file, patch);
    if (next !== file) changed = true;
    return next;
  });
  if (!changed) return dock;
  return { ...dock, pane: { ...dock.pane, files } };
}

export function patchProjectDocks(
  docks: ProjectDock[],
  fileId: string,
  patch: TerminalMetaPatch,
): ProjectDock[] {
  let changed = false;
  const next = docks.map((dock) => {
    const updated = patchDockTerminal(dock, fileId, patch);
    if (updated !== dock) changed = true;
    return updated;
  });
  return changed ? next : docks;
}

export function mapProjectDock(
  docks: ProjectDock[],
  projectPath: string,
  update: (dock: ProjectDock) => ProjectDock,
): ProjectDock[] {
  let found = false;
  const next: ProjectDock[] = [];
  for (const dock of docks) {
    if (!sameProjectPath(dock.projectPath, projectPath)) {
      next.push(dock);
      continue;
    }
    found = true;
    next.push(update(dock));
  }
  return found ? next : docks;
}

export function withDockOpen(dock: ProjectDock, open: boolean): ProjectDock {
  return dock.open === open ? dock : { ...dock, open };
}

export function withDockSurface(dock: ProjectDock, surface: DockSurface): ProjectDock {
  return dock.surface === surface ? dock : { ...dock, surface };
}

export function withDockBrowser(dock: ProjectDock, browser: BrowserHistory): ProjectDock {
  return dock.browser === browser ? dock : { ...dock, browser };
}

export function withDockSide(
  dock: ProjectDock,
  side: DockSide,
  viewport?: { width: number; height: number },
): ProjectDock {
  if (dock.side === side) return dock;
  return {
    ...dock,
    side,
    size: clampDockSize(side, dock.size, viewport),
  };
}

export function withDockSize(
  dock: ProjectDock,
  size: number,
  viewport?: { width: number; height: number },
): ProjectDock {
  const next = clampDockSize(dock.side, size, viewport);
  return next === dock.size ? dock : { ...dock, size: next };
}

/**
 * Give width or height back after the window shrank past what the docks were
 * holding. A dock keeps the size the user dragged it to whenever it still fits.
 */
export function clampDocksToViewport(
  docks: ProjectDock[],
  viewport: { width: number; height: number },
): ProjectDock[] {
  let changed = false;
  const next = docks.map((dock) => {
    const size = clampDockSize(dock.side, dock.size, viewport);
    if (size === dock.size) return dock;
    changed = true;
    return { ...dock, size };
  });
  return changed ? next : docks;
}

export function dockTerminalFileIds(docks: ProjectDock[]): string[] {
  const ids: string[] = [];
  for (const dock of docks) {
    for (const file of dock.pane.files) {
      if (file.terminal) ids.push(file.id);
    }
  }
  return ids;
}

export function dockGridStyle(side: DockSide | null, size: number): CSSProperties {
  if (!side) {
    return {
      gridTemplateRows: "minmax(0, 1fr)",
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateAreas: '"main"',
    };
  }
  const px = `${Math.max(1, Math.round(size))}px`;
  if (side === "top") {
    return {
      gridTemplateRows: `${px} minmax(0, 1fr)`,
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateAreas: '"dock" "main"',
    };
  }
  if (side === "bottom") {
    return {
      gridTemplateRows: `minmax(0, 1fr) ${px}`,
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateAreas: '"main" "dock"',
    };
  }
  if (side === "left") {
    return {
      gridTemplateRows: "minmax(0, 1fr)",
      gridTemplateColumns: `${px} minmax(0, 1fr)`,
      gridTemplateAreas: '"dock main"',
    };
  }
  return {
    gridTemplateRows: "minmax(0, 1fr)",
    gridTemplateColumns: `minmax(0, 1fr) ${px}`,
    gridTemplateAreas: '"main dock"',
  };
}

export function applyDockGridStyle(el: HTMLElement, side: DockSide | null, size: number): void {
  const style = dockGridStyle(side, size);
  el.style.gridTemplateRows = String(style.gridTemplateRows ?? "");
  el.style.gridTemplateColumns = String(style.gridTemplateColumns ?? "");
  el.style.gridTemplateAreas = String(style.gridTemplateAreas ?? "");
}

/**
 * A dock follows the tabs of its project into a new window only when
 * every remaining tab of that project is leaving too — otherwise the
 * original window keeps the running terminals.
 */
export function splitProjectDocksForMove(
  docks: ProjectDock[],
  movingTabs: WorkspaceTab[],
  remainingTabs: WorkspaceTab[],
  sessions: Session[],
): { moving: ProjectDock[]; remaining: ProjectDock[] } {
  const remainingProjects = projectPathsOf(remainingTabs, sessions);
  const movingProjects = projectPathsOf(movingTabs, sessions);
  const moving: ProjectDock[] = [];
  const remaining: ProjectDock[] = [];
  for (const dock of docks) {
    const path = normalizeProjectPath(dock.projectPath);
    const stays = remainingProjects.has(path);
    const follows = movingProjects.has(path) && !stays;
    if (follows) moving.push(dock);
    else remaining.push(dock);
  }
  return { moving, remaining };
}

function projectPathsOf(tabs: WorkspaceTab[], sessions: Session[]): Set<string> {
  const paths = new Set<string>();
  for (const tab of tabs) {
    const cwd = workspaceTabCwd(tab, sessions);
    if (cwd) paths.add(normalizeProjectPath(cwd));
  }
  return paths;
}
