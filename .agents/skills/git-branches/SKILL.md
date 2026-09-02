---
name: git-branches
description: Manage branches and worktree-safe branch hygiene in wavex. Use when starting work, naming a branch, updating it from main, preparing a pull request, or cleaning up a merged branch.
---

# Git branches

## Naming

Use a short Conventional Commit type and slug:

```text
<type>/<short-slug>
```

When a branch belongs to a tracked issue, an issue number may be included:

```text
<type>/<issue>-<short-slug>
```

Examples:

```text
feat/worktree-sidebar
fix/123-harness-resume
perf/transcript-streaming
chore/update-tauri-plugins
```

Keep the slug lower-case and hyphenated. Do not require an issue number when no
issue exists.

## Starting work

1. Inspect status, the current branch, and attached worktrees.
2. Preserve all uncommitted work before switching or creating a branch.
3. Fetch the remote when network access is appropriate and approved.
4. For new work based on main, branch from current `origin/main`, not a stale
   local branch.
5. Keep one branch focused on one concern.

## Updating and cleanup

- Prefer a clean rebase onto `origin/main` for an owned, unpublished feature
  branch when updating is needed.
- Never rewrite a shared branch without explicit approval. If an approved force
  push is necessary, use `--force-with-lease`.
- Push or open a pull request only when asked.
- Before deleting a branch, confirm it is merged, not checked out by any
  worktree, and has no uncommitted work.
- Delete local or remote branches only when cleanup was requested or approved.

## Safety

- Never develop directly on `main`.
- Never merge `main` into a feature branch merely to update it unless the
  repository workflow explicitly requires that.
- Never delete, reset, overwrite, or detach a wavex-managed worktree casually.
- Do not bypass hooks or branch protection.
