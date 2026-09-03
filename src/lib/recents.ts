import { normalizeProjectPath, pathKey, prettyCwd } from "./paths";
import { isWorktreePath, worktreeRepo } from "./worktrees/worktreeIndex";
import { profileStorage } from "./profiles/profileStorage";

export { normalizeProjectPath };

const KEY = "wavex.recentProjects";
const RAIL_ORDER_KEY = "wavex.projectRailOrder";
const RAIL_PINNED_KEY = "wavex.projectRailPinned";
const ARCHIVED_KEY = "wavex.archivedProjects";
const ARCHIVED_CHANGED = "wavex:archived-projects-changed";
const MAX = 20;

export type RecentProject = {
  path: string;
  openedAt: number;
};

export type ArchivedProject = {
  path: string;
  archivedAt: number;
};

function normalize(path: string): string {
  return normalizeProjectPath(path);
}

export function sameProjectPath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

export function loadRecents(): RecentProject[] {
  try {
    const raw = profileStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RecentProject[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { path?: unknown; openedAt?: unknown };
      if (typeof rec.path !== "string" || !rec.path) continue;
      const openedAt =
        typeof rec.openedAt === "number" && Number.isFinite(rec.openedAt) ? rec.openedAt : 0;
      out.push({ path: normalize(rec.path), openedAt });
    }
    return out;
  } catch {
    return [];
  }
}

function save(next: RecentProject[]) {
  try {
    profileStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
}

export function rememberProject(path: string): RecentProject[] {
  const normalized = normalize(path);
  if (normalized === "~") return loadRecents();
  // Worktrees ride along with the repository they belong to. Twenty of them
  // open at once would otherwise push every real project out of the list.
  if (isWorktreePath(normalized)) return loadRecents();
  dropArchived(normalized);
  const prev = loadRecents().filter((p) => !sameProjectPath(p.path, normalized));
  const next = [{ path: normalized, openedAt: Date.now() }, ...prev].slice(0, MAX);
  save(next);
  return next;
}

/** Drops a project from the rail: its recent entry, saved order slot, and pin. */
function dropFromRail(path: string): RecentProject[] {
  const normalized = normalize(path);
  const next = loadRecents().filter((item) => !sameProjectPath(item.path, normalized));
  save(next);
  saveProjectRailOrder(
    loadProjectRailOrder().filter((entry) => !sameProjectPath(entry, normalized)),
  );
  savePinnedProjects(loadPinnedProjects().filter((entry) => !sameProjectPath(entry, normalized)));
  return next;
}

/** Removes a project from the rail and from the archive (Delete). */
export function forgetProject(path: string): RecentProject[] {
  dropArchived(path);
  return dropFromRail(path);
}

/** Removes a project from the rail and files it in the archive (Archive). */
export function archiveProject(path: string): RecentProject[] {
  const normalized = normalize(path);
  if (!looksLikeProject(normalized)) return loadRecents();
  const recents = dropFromRail(normalized);
  const rest = loadArchivedProjects().filter((item) => !sameProjectPath(item.path, normalized));
  saveArchived([{ path: normalized, archivedAt: Date.now() }, ...rest]);
  return recents;
}

export function loadArchivedProjects(): ArchivedProject[] {
  try {
    const raw = profileStorage.getItem(ARCHIVED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ArchivedProject[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { path?: unknown; archivedAt?: unknown };
      if (typeof rec.path !== "string" || !rec.path) continue;
      const path = normalize(rec.path);
      const key = pathKey(path);
      if (seen.has(key) || !looksLikeProject(path)) continue;
      seen.add(key);
      const archivedAt =
        typeof rec.archivedAt === "number" && Number.isFinite(rec.archivedAt) ? rec.archivedAt : 0;
      out.push({ path, archivedAt });
    }
    return out;
  } catch {
    return [];
  }
}

export function subscribeArchivedProjects(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(ARCHIVED_CHANGED, onChange);
  return () => window.removeEventListener(ARCHIVED_CHANGED, onChange);
}

function saveArchived(next: ArchivedProject[]) {
  try {
    profileStorage.setItem(ARCHIVED_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ARCHIVED_CHANGED));
  }
}

function dropArchived(path: string) {
  const normalized = normalize(path);
  const prev = loadArchivedProjects();
  const next = prev.filter((item) => !sameProjectPath(item.path, normalized));
  if (next.length === prev.length) return;
  saveArchived(next);
}

/** Most recently opened project, if any. Used to restore the folder on launch. */
export function lastProjectPath(): string | null {
  for (const item of loadRecents()) {
    if (looksLikeProject(item.path)) return item.path;
  }
  return null;
}

export type ProjectRailSections = {
  pinned: RecentProject[];
  projects: RecentProject[];
};

function readPathList(key: string): string[] {
  try {
    const raw = profileStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string" || !item) continue;
      const path = normalize(item);
      const key = pathKey(path);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(path);
    }
    return out;
  } catch {
    return [];
  }
}

function savePathList(key: string, paths: string[]) {
  try {
    profileStorage.setItem(key, JSON.stringify(paths));
  } catch {
    // private mode / quota
  }
}

export function loadProjectRailOrder(): string[] {
  return readPathList(RAIL_ORDER_KEY);
}

export function saveProjectRailOrder(order: string[]) {
  savePathList(RAIL_ORDER_KEY, order.map(normalize));
}

export function loadPinnedProjects(): string[] {
  return readPathList(RAIL_PINNED_KEY);
}

export function savePinnedProjects(pinned: string[]) {
  savePathList(RAIL_PINNED_KEY, pinned.map(normalize));
}

/**
 * All projects for the rail, keyed by `pathKey` — the map key decides identity,
 * the entry's `path` is what gets displayed. On Windows the same folder reaches
 * us in more than one case and must not become two rail entries.
 */
export function collectRailProjects(
  recents: RecentProject[],
  currentCwd: string,
): Map<string, RecentProject> {
  const map = new Map<string, RecentProject>();
  for (const item of recents) {
    if (!looksLikeProject(item.path)) continue;
    const path = normalize(item.path);
    map.set(pathKey(path), { path, openedAt: item.openedAt });
  }
  if (currentCwd && looksLikeProject(currentCwd)) {
    const path = normalize(currentCwd);
    const key = pathKey(path);
    if (!map.has(key)) {
      map.set(key, { path, openedAt: Date.now() });
    }
  }
  return withoutNestedWorktrees(map);
}

/**
 * The rail row that stands for the repository `repo`, or `null` when the
 * repository is not on the rail.
 *
 * A project is keyed by the folder the user opened, which is not always the
 * repository root: opening `wavex/src-tauri` puts that folder on the rail while
 * git still calls the repository `wavex`. The row is the repository's all the
 * same, so its worktrees belong under it. The shallowest candidate wins, and a
 * worktree that happens to sit inside the repository is never one — it is a
 * child row, not the repository's own.
 */
export function repoRailPath(repo: string, projects: Iterable<string>): string | null {
  const root = normalize(repo);
  const rootKey = pathKey(root);
  let best: string | null = null;
  for (const candidate of projects) {
    const path = normalize(candidate);
    const key = pathKey(path);
    if (key === rootKey) return path;
    if (!key.startsWith(`${rootKey}/`) || isWorktreePath(path)) continue;
    if (best === null || path.length < best.length) best = path;
  }
  return best;
}

/**
 * Worktrees belong under their repository, not beside it. One whose repository
 * is not on the rail stays a project of its own — otherwise opening a worktree
 * folder directly would leave it with nowhere to appear.
 */
function withoutNestedWorktrees(map: Map<string, RecentProject>): Map<string, RecentProject> {
  // Keys are comparison keys now, so the repository lookup walks the entries'
  // real paths and the deletion walks the keys.
  const paths = [...map.values()].map((project) => project.path);
  const nested: string[] = [];
  for (const [key, project] of map) {
    const repo = worktreeRepo(project.path);
    if (repo && repoRailPath(repo, paths) != null) nested.push(key);
  }
  for (const key of nested) map.delete(key);
  return map;
}

/** Append new projects to the saved order without moving existing entries. */
export function syncProjectRailOrder(
  order: string[],
  projects: Map<string, RecentProject>,
): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const path of order) {
    const key = pathKey(path);
    const project = projects.get(key);
    if (!project || seen.has(key)) continue;
    seen.add(key);
    next.push(project.path);
  }
  const newcomers = [...projects.entries()]
    .filter(([key]) => !seen.has(key))
    .sort(([, a], [, b]) => b.openedAt - a.openedAt)
    .map(([, project]) => project.path);
  return [...next, ...newcomers];
}

export function projectRailSections(
  recents: RecentProject[],
  currentCwd: string,
  order: string[],
  pinnedPaths: string[],
): ProjectRailSections {
  const projects = collectRailProjects(recents, currentCwd);
  const syncedOrder = syncProjectRailOrder(order, projects);
  const pinnedSet = new Set(pinnedPaths.map(pathKey));
  const pinned: RecentProject[] = [];
  const unpinned: RecentProject[] = [];
  for (const path of syncedOrder) {
    const key = pathKey(path);
    const item = projects.get(key);
    if (!item) continue;
    if (pinnedSet.has(key)) pinned.push(item);
    else unpinned.push(item);
  }
  return { pinned, projects: unpinned };
}

/** Recents plus the current folder when it is a project not yet remembered. */
export function projectRailItems(recents: RecentProject[], currentCwd: string): RecentProject[] {
  const projects = collectRailProjects(recents, currentCwd);
  const order = syncProjectRailOrder(loadProjectRailOrder(), projects);
  const { pinned, projects: unpinned } = projectRailSections(
    recents,
    currentCwd,
    order,
    loadPinnedProjects(),
  );
  return [...pinned, ...unpinned];
}

/** True if this looks like a user project, not an app bundle or system root. */
export function looksLikeProject(path: string): boolean {
  if (!path || path === "/" || path === "~") return false;
  // A drive root is not a project any more than `/` is.
  if (/^[A-Za-z]:$/.test(normalize(path))) return false;
  // Home itself arrives expanded (`/Users/me`), so the `~` check above misses
  // it. Indexing it walks `~/Library`, which trips the OS consent prompt.
  if (prettyCwd(path) === "~") return false;
  if (normalize(path).includes(".app/")) return false;
  return true;
}
