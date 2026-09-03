import { normalizeProjectPath } from "../paths";
import { profileStorage } from "../profiles/profileStorage";

/**
 * Which repository each known worktree belongs to.
 *
 * Git is the source of truth, but answering "is this folder a worktree?"
 * through git means a subprocess and an await — and the sidebar has to decide
 * that synchronously, on first paint, for folders whose repository is not even
 * the open one. So every listing writes what it learned here, and the rail
 * reads it back instantly.
 */
const KEY = "wavex.worktreeIndex";

type Index = Record<string, string>;

function read(): Index {
  try {
    const raw = profileStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Index = {};
    for (const [path, repo] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof repo !== "string" || !repo || !path) continue;
      out[normalizeProjectPath(path)] = normalizeProjectPath(repo);
    }
    return out;
  } catch {
    return {};
  }
}

function write(index: Index) {
  try {
    profileStorage.setItem(KEY, JSON.stringify(index));
  } catch {
    // private mode / quota
  }
}

/** Every worktree path wavex has seen, mapped to its repository. */
export function loadWorktreeIndex(): Index {
  return read();
}

/**
 * Record one repository's worktrees, replacing what was known about it. Passing
 * the linked worktrees only — the main checkout is the repository itself and
 * must stay a plain project.
 */
export function rememberWorktrees(repoPath: string, worktreePaths: Iterable<string>): void {
  const repo = normalizeProjectPath(repoPath);
  const next: Index = {};
  for (const [path, owner] of Object.entries(read())) {
    if (owner !== repo) next[path] = owner;
  }
  for (const path of worktreePaths) {
    const normalized = normalizeProjectPath(path);
    if (normalized === repo) continue;
    next[normalized] = repo;
  }
  write(next);
}

/** Record a single worktree, without disturbing what is known about the rest. */
export function rememberWorktree(repoPath: string, worktreePath: string): void {
  const repo = normalizeProjectPath(repoPath);
  const path = normalizeProjectPath(worktreePath);
  if (path === repo) return;
  const index = read();
  if (index[path] === repo) return;
  index[path] = repo;
  write(index);
}

/** Repository a worktree folder belongs to, or `null` for a plain project. */
export function worktreeRepo(path: string): string | null {
  return read()[normalizeProjectPath(path)] ?? null;
}

export function isWorktreePath(path: string): boolean {
  return worktreeRepo(path) != null;
}

/** Forget a single worktree, after it was removed from disk. */
export function forgetWorktree(path: string): void {
  const normalized = normalizeProjectPath(path);
  const index = read();
  if (!(normalized in index)) return;
  delete index[normalized];
  write(index);
}
