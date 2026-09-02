import { invoke } from "@tauri-apps/api/core";
import { basename } from "../fs";

/** One checkout of a repository. The first entry git reports is `main`. */
export type Worktree = {
  path: string;
  /** Short branch name, or `null` when the checkout is detached or bare. */
  branch: string | null;
  head: string | null;
  /** The repository's own working tree. It can never be removed. */
  main: boolean;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  /** Registered with git, but the folder is gone from disk. */
  missing: boolean;
};

export function gitWorktreeList(cwd: string): Promise<Worktree[]> {
  return invoke<Worktree[]>("git_worktree_list", { cwd });
}

export function gitWorktreeCreate(
  cwd: string,
  path: string,
  branch: string,
  base?: string | null,
): Promise<Worktree> {
  return invoke<Worktree>("git_worktree_create", {
    cwd,
    path,
    branch,
    base: base ?? null,
  });
}

export function gitWorktreeRemove(
  cwd: string,
  path: string,
  options: { force?: boolean; deleteBranch?: boolean } = {},
): Promise<void> {
  return invoke<void>("git_worktree_remove", {
    cwd,
    path,
    force: options.force ?? false,
    deleteBranch: options.deleteBranch ?? false,
  });
}

export function gitWorktreePrune(cwd: string): Promise<void> {
  return invoke<void>("git_worktree_prune", { cwd });
}

/** What to call a worktree in the UI: its branch, else a short head, else the folder. */
export function worktreeLabel(worktree: Worktree): string {
  if (worktree.branch) return worktree.branch;
  if (worktree.head) return worktree.head.slice(0, 7);
  return basename(worktree.path);
}

/**
 * A branch lives in exactly one worktree, so adding a second one for it fails.
 * With many branches in flight that is the everyday collision, and the path git
 * names is the worktree the user actually wants — worth an offer to jump there
 * rather than raw stderr.
 */
export function checkedOutElsewhere(message: string): string | null {
  const match = /already (?:used|checked out) by (?:another )?worktree at '([^']+)'/i.exec(message);
  if (match?.[1]) return match[1];
  const fallback = /is already checked out at '([^']+)'/i.exec(message);
  return fallback?.[1] ?? null;
}

/** Git refused to remove a worktree because it still holds work. */
export function worktreeHasLocalChanges(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes("contains modified or untracked files");
}
