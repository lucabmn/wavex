import { useCallback, useSyncExternalStore } from "react";
import { subscribeGitChanged } from "../lib/fs";
import { rememberWorktrees } from "../lib/worktrees/worktreeIndex";
import { gitWorktreeList, type Worktree } from "../lib/worktrees/worktrees";

export type WorktreesState = {
  /** Main checkout first, exactly as git orders them. */
  worktrees: Worktree[];
  /** First lookup for this folder has finished, repo or not. */
  settled: boolean;
};

const EMPTY: Worktree[] = [];
const PENDING: WorktreesState = { worktrees: EMPTY, settled: false };

type Entry = {
  cwd: string;
  state: WorktreesState;
  listeners: Set<() => void>;
  inFlight: boolean;
  unsubscribeGit: (() => void) | null;
  onResume: (() => void) | null;
};

const entries = new Map<string, Entry>();

function sameWorktree(a: Worktree, b: Worktree): boolean {
  return (
    a.path === b.path &&
    a.branch === b.branch &&
    a.head === b.head &&
    a.main === b.main &&
    a.detached === b.detached &&
    a.bare === b.bare &&
    a.locked === b.locked &&
    a.lockReason === b.lockReason &&
    a.prunable === b.prunable &&
    a.missing === b.missing
  );
}

function worktreesEqual(a: Worktree[], b: Worktree[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((worktree, index) => {
    const other = b[index];
    return other != null && sameWorktree(worktree, other);
  });
}

function entryFor(cwd: string): Entry {
  const existing = entries.get(cwd);
  if (existing) return existing;
  const entry: Entry = {
    cwd,
    state: PENDING,
    listeners: new Set(),
    inFlight: false,
    unsubscribeGit: null,
    onResume: null,
  };
  entries.set(cwd, entry);
  return entry;
}

function publish(entry: Entry, worktrees: Worktree[]) {
  const [main, ...linked] = worktrees;
  if (main) {
    rememberWorktrees(
      main.path,
      linked.map((worktree) => worktree.path),
    );
  }
  // `settled` still has to flip on a folder that turned out not to be a repo,
  // so an unchanged empty list is only a no-op once the first one has landed.
  if (entry.state.settled && worktreesEqual(entry.state.worktrees, worktrees)) return;
  entry.state = { worktrees, settled: true };
  for (const listener of entry.listeners) listener();
}

async function load(entry: Entry, force = false) {
  if (entry.inFlight || (!force && document.hidden)) return;
  entry.inFlight = true;
  try {
    publish(entry, await gitWorktreeList(entry.cwd));
  } catch {
    publish(entry, EMPTY);
  } finally {
    entry.inFlight = false;
  }
}

function start(entry: Entry) {
  if (entry.onResume) return;
  void load(entry, true);
  entry.onResume = () => {
    if (!document.hidden) void load(entry, true);
  };
  window.addEventListener("focus", entry.onResume);
  document.addEventListener("visibilitychange", entry.onResume);
  entry.unsubscribeGit = subscribeGitChanged(entry.onResume);
}

function stop(entry: Entry) {
  if (entry.onResume) {
    window.removeEventListener("focus", entry.onResume);
    document.removeEventListener("visibilitychange", entry.onResume);
  }
  entry.unsubscribeGit?.();
  entry.onResume = null;
  entry.unsubscribeGit = null;
}

/**
 * Worktrees of the repository `cwd` belongs to. Any worktree of a repository
 * answers with the same list, so the caller can pass the repository or one of
 * its checkouts. Reloads on window focus and after every local git mutation.
 */
export function useWorktrees(cwd: string, enabled: boolean): WorktreesState {
  const active = enabled && Boolean(cwd) && cwd !== "~";
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!active) return () => undefined;
      const entry = entryFor(cwd);
      entry.listeners.add(listener);
      if (entry.listeners.size === 1) start(entry);
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) stop(entry);
      };
    },
    [active, cwd],
  );
  const getSnapshot = useCallback(() => (active ? entryFor(cwd).state : PENDING), [active, cwd]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
