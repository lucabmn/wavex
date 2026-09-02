import { basename } from "../fs";
import { normalizeProjectPath } from "../recents";

/**
 * Worktrees live under the home directory, never inside the repository: the
 * file index, the search index and the watcher all walk from the project root,
 * so a checkout placed inside it would be indexed as part of the project.
 */
export const WORKTREES_DIR = ".wavex/worktrees";

const MAX_SLUG = 64;
const MAX_DEDUPE = 99;

/**
 * Branch name as a single, filesystem-safe folder name.
 *
 * Dots go too, not only slashes: a folder named `foo.app` anywhere in the path
 * makes `looksLikeProject` read the worktree as an application bundle and
 * refuse to open it. The row shows git's real branch name regardless.
 */
export function branchSlug(branch: string): string {
  const slug = branch
    .trim()
    // Fold accents first, so `feature/übersicht` keeps its letters instead of
    // trading them for dashes.
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "");
  return slug || "worktree";
}

/**
 * Folder holding every worktree of one repository. The repository's own name is
 * slugged the same way — a folder called `desktop.app` would otherwise produce
 * paths that read as an app bundle, leaving every row unclickable.
 */
export function worktreesRoot(home: string, repoPath: string): string {
  const base = normalizeProjectPath(home);
  return `${base}/${WORKTREES_DIR}/${branchSlug(basename(normalizeProjectPath(repoPath)))}`;
}

/**
 * Where a new worktree for `branch` should go. `taken` are paths already in
 * use — `feat/login` and `feat-login` slug the same way, so the suffix is what
 * keeps two branches from pointing at one folder.
 */
export function suggestWorktreePath(
  home: string,
  repoPath: string,
  branch: string,
  taken: Iterable<string> = [],
): string {
  const root = worktreesRoot(home, repoPath);
  const slug = branchSlug(branch);
  const used = new Set<string>();
  for (const path of taken) used.add(normalizeProjectPath(path));

  const first = `${root}/${slug}`;
  if (!used.has(first)) return first;
  for (let n = 2; n <= MAX_DEDUPE; n += 1) {
    const candidate = `${root}/${slug}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${root}/${slug}-${Date.now()}`;
}
