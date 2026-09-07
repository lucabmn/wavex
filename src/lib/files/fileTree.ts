import { listDir, type FsEntry } from "../fs";
import { pathSegments } from "./fileName";
import { joinPath, parentPath } from "../paths";
import { hostIdForProject } from "../transport";
import { hostPathKey, type HostId } from "../host";

/**
 * A cached listing belongs to one host's folder. Keyed on the bare path, a
 * client holding two hosts with the same checkout path would draw one host's
 * explorer from the other host's directory listing.
 *
 * A caller that names no host gets the one its project reference names, the
 * same rule the wrappers follow, so a remote root can never land in a local
 * slot. A bare child path still needs its host passed — nothing in the path
 * itself says which machine it is on.
 */
function keyFor(hostId: HostId | undefined, path: string): string {
  return hostPathKey(hostId ?? hostIdForProject(path), path);
}

type CachedDir = {
  hostId: HostId;
  path: string;
  entries: FsEntry[];
};

const expandedByProject = new Map<string, Set<string>>();
const selectedByProject = new Map<string, string | null>();
const dirs = new Map<string, CachedDir>();
const listeners = new Set<() => void>();

const REFRESH_MS = 150;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshing = false;
let refreshAgain = false;

export function loadExpanded(cwd: string, hostId?: HostId): Set<string> {
  const saved = expandedByProject.get(keyFor(hostId, cwd));
  return saved ? new Set(saved) : new Set([cwd]);
}

export function saveExpanded(cwd: string, expanded: Set<string>, hostId?: HostId) {
  expandedByProject.set(keyFor(hostId, cwd), new Set(expanded));
}

export function loadSelected(cwd: string, hostId?: HostId): string | null {
  return selectedByProject.get(keyFor(hostId, cwd)) ?? null;
}

export function saveSelected(cwd: string, path: string | null, hostId?: HostId) {
  selectedByProject.set(keyFor(hostId, cwd), path);
}

/** Cached `listDir` — same path stays instant when the tree remounts. */
export function peekDir(path: string, hostId?: HostId): FsEntry[] | null {
  return dirs.get(keyFor(hostId, path))?.entries ?? null;
}

export function listCachedDir(path: string, hostId?: HostId): Promise<FsEntry[]> {
  const key = keyFor(hostId, path);
  const hit = dirs.get(key);
  if (hit) return Promise.resolve(hit.entries);
  return listDir(path, hostId).then((entries) => {
    dirs.set(key, { hostId: hostId ?? hostIdForProject(path), path, entries });
    return entries;
  });
}

export function refreshDir(path: string, hostId?: HostId): Promise<FsEntry[]> {
  dirs.delete(keyFor(hostId, path));
  return listCachedDir(path, hostId);
}

export function forgetDir(path: string, hostId?: HostId) {
  const prefix = keyFor(hostId, path);
  // Snapshot keys before deleting cached directories.
  // oxlint-disable-next-line unicorn/no-useless-spread
  for (const key of [...dirs.keys()]) {
    if (key === prefix || key.startsWith(`${prefix}/`)) dirs.delete(key);
  }
}

/** Re-list every cached folder. Agent writes and window focus use this. */
export async function refreshCachedDirs(): Promise<void> {
  const cached = [...dirs.values()];
  if (cached.length === 0) return;
  await Promise.all(
    cached.map((dir) =>
      refreshDir(dir.path, dir.hostId).catch(() => {
        forgetDir(dir.path, dir.hostId);
      }),
    ),
  );
}

export function subscribeDirsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reload the explorer cache after an agent/shell write (debounced). */
export function notifyDirsChanged() {
  if (typeof document !== "undefined" && document.hidden) return;
  scheduleRefresh();
}

function scheduleRefresh() {
  if (refreshTimer != null) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void runRefresh();
  }, REFRESH_MS);
}

async function runRefresh() {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    await refreshCachedDirs();
    for (const listener of listeners) listener();
  } finally {
    refreshing = false;
    if (refreshAgain) {
      refreshAgain = false;
      scheduleRefresh();
    }
  }
}

/** Folder that VS Code would create into, given the explorer selection. */
export function createParentOf(cwd: string, selectedPath: string | null, hostId?: HostId): string {
  if (!selectedPath || selectedPath === cwd) return cwd;
  const parent = parentPath(selectedPath);
  const entry = peekDir(parent, hostId)?.find((e) => e.path === selectedPath);
  if (entry?.isDir) return selectedPath;
  if (entry && !entry.isDir) return parent;
  if (peekDir(selectedPath, hostId)) return selectedPath;
  return parent;
}

/** Directories whose children change when creating `name` under `parent`. */
export function dirsTouchedByCreate(parent: string, name: string): string[] {
  const segments = pathSegments(name);
  const out = [parent];
  let cur = parent;
  for (let i = 0; i < segments.length - 1; i++) {
    cur = joinPath(cur, segments[i]);
    out.push(cur);
  }
  return out;
}

export function dirsTouchedByMove(from: string, to: string): string[] {
  const fromParent = parentPath(from);
  const toParent = parentPath(to);
  return fromParent === toParent ? [fromParent] : [fromParent, toParent];
}
