import { statFiles } from "../fs";
import { getDefaultHostId } from "../transport";
import { hostPathKey, type HostId } from "../host";
import { editorPathsEqual } from "../search";

const MAX_PATHS = 64;

type Listener = () => void;

/**
 * One watched file. The host is part of the identity, not context around it:
 * two hosts can serve `/srv/app/main.rs` and a single path-keyed map would
 * reload one host's editor because the other host's file changed.
 */
type Watched = {
  hostId: HostId;
  path: string;
  listeners: Set<Listener>;
  /** `undefined` until the first poll seeds a baseline. */
  mtime: number | null | undefined;
};

const watched = new Map<string, Watched>();
let inFlight = false;
let queued: string[] | "all" | null = null;

/** Watch a currently open file. First poll seeds mtime and does not notify. */
export function watchFile(
  path: string,
  onChange: Listener,
  hostId: HostId = getDefaultHostId(),
): () => void {
  const key = hostPathKey(hostId, path);
  let entry = watched.get(key);
  if (!entry) {
    entry = { hostId, path, listeners: new Set(), mtime: undefined };
    watched.set(key, entry);
  }
  entry.listeners.add(onChange);
  if (typeof document === "undefined" || !document.hidden) {
    void poll([key]);
  }
  return () => {
    const current = watched.get(key);
    if (!current) return;
    current.listeners.delete(onChange);
    if (current.listeners.size === 0) watched.delete(key);
  };
}

/** Re-stat watched paths now (agent edit / shell / window focus). */
export function nudgeWatchedFiles(paths?: string[], hostId: HostId = getDefaultHostId()) {
  if (watched.size === 0) return;
  if (typeof document !== "undefined" && document.hidden) return;
  const keys = watchedKeys(paths, hostId);
  if (keys.length > 0) void poll(paths ? keys : "all");
}

/**
 * Reload open editors even when mtime looks unchanged (git restore can
 * rewrite a file in the same second as the last save).
 */
export function invalidateWatchedFiles(paths?: string[], hostId: HostId = getDefaultHostId()) {
  if (watched.size === 0) return;
  const keys = watchedKeys(paths, hostId);
  for (const key of keys) {
    const entry = watched.get(key);
    if (!entry) continue;
    entry.mtime = undefined;
    for (const listener of entry.listeners) listener();
  }
  if (keys.length > 0 && (typeof document === "undefined" || !document.hidden)) {
    void poll(paths ? keys : "all");
  }
}

function watchedKeys(paths: string[] | undefined, hostId: HostId): string[] {
  if (!paths) return [...watched.keys()];
  const keys: string[] = [];
  for (const path of paths) {
    for (const [key, entry] of watched) {
      if (entry.hostId !== hostId) continue;
      if (editorPathsEqual(entry.path, path) && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/** Update the mtime baseline after our own save so we do not reload it. */
export async function syncWatchedMtime(
  path: string,
  hostId: HostId = getDefaultHostId(),
): Promise<void> {
  const key = hostPathKey(hostId, path);
  if (!watched.has(key)) return;
  try {
    const [stat] = await statFiles([path], hostId);
    const entry = watched.get(key);
    if (stat && entry) entry.mtime = stat.mtimeMs;
  } catch {
    /* next nudge will retry */
  }
}

async function poll(keys: string[] | "all") {
  if (inFlight) {
    if (keys === "all" || queued === "all") {
      queued = "all";
      return;
    }
    const next = queued == null ? [...keys] : [...queued, ...keys];
    queued = [...new Set(next)];
    return;
  }

  const list = keys === "all" ? [...watched.keys()] : keys.filter((key) => watched.has(key));
  if (list.length === 0) return;

  // One `stat_files` call reaches exactly one host, so the batch is grouped by
  // host before it is chunked.
  const byHost = new Map<HostId, string[]>();
  for (const key of list) {
    const entry = watched.get(key);
    if (!entry) continue;
    const group = byHost.get(entry.hostId) ?? [];
    group.push(key);
    byHost.set(entry.hostId, group);
  }

  inFlight = true;
  try {
    for (const [hostId, group] of byHost) {
      for (let i = 0; i < group.length; i += MAX_PATHS) {
        const chunk = group.slice(i, i + MAX_PATHS);
        const stats = await statFiles(
          chunk.map((key) => watched.get(key)?.path ?? "").filter(Boolean),
          hostId,
        );
        const byPath = new Map(stats.map((stat) => [stat.path, stat.mtimeMs]));
        for (const key of chunk) {
          const entry = watched.get(key);
          if (!entry || !byPath.has(entry.path)) continue;
          const mtimeMs = byPath.get(entry.path) ?? null;
          const previous = entry.mtime;
          entry.mtime = mtimeMs;
          // First observation is the baseline so opening a tab does not re-read.
          if (previous === undefined || previous === mtimeMs) continue;
          for (const listener of entry.listeners) listener();
        }
      }
    }
  } catch {
    /* next nudge will retry */
  } finally {
    inFlight = false;
    const next = queued;
    queued = null;
    if (next) void poll(next === "all" ? "all" : next);
  }
}
