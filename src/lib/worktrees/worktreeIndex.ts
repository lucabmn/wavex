import { normalizeProjectPath, pathKey } from "../paths";
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

/**
 * Keyed by `pathKey`, valued with the repository's display path. The rail
 * compares on the key, so a Windows folder that reaches us in two cases still
 * resolves to one repository.
 */
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
      out[pathKey(path)] = normalizeProjectPath(repo);
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
  const repoKey = pathKey(repo);
  const next: Index = {};
  for (const [path, owner] of Object.entries(read())) {
    if (pathKey(owner) !== repoKey) next[path] = owner;
  }
  for (const path of worktreePaths) {
    const key = pathKey(path);
    if (key === repoKey) continue;
    next[key] = repo;
  }
  write(next);
}

/** Record a single worktree, without disturbing what is known about the rest. */
export function rememberWorktree(repoPath: string, worktreePath: string): void {
  const repo = normalizeProjectPath(repoPath);
  const key = pathKey(worktreePath);
  if (key === pathKey(repo)) return;
  const index = read();
  if (index[key] && pathKey(index[key]) === pathKey(repo)) return;
  index[key] = repo;
  write(index);
}

/** Repository a worktree folder belongs to, or `null` for a plain project. */
export function worktreeRepo(path: string): string | null {
  return read()[pathKey(path)] ?? null;
}

export function isWorktreePath(path: string): boolean {
  return worktreeRepo(path) != null;
}

/** Forget a single worktree, after it was removed from disk. */
export function forgetWorktree(path: string): void {
  const key = pathKey(path);
  const index = read();
  if (!(key in index)) return;
  delete index[key];
  write(index);
}
