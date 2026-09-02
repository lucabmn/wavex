---
name: commits
description: Create, validate, split, or rewrite Git commits for wavex. Use when committing changes, staging a focused concern, amending a message, or discussing this repository's commit conventions.
---

# Commits

## Format

Use Conventional Commits:

```text
type(scope): short imperative summary
```

Examples:

```text
feat(worktrees): add branch checkout creation
fix(harness): preserve provider session after idle park
perf(files): reuse unchanged project indexes
test(editor): cover deleted-file gutter state
build(release): verify updater artifacts
chore(deps): update Tauri plugins
```

Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
`chore`, `style`, `revert`.

## Rules

- Write the subject and optional body in clear English.
- Keep the subject at 72 characters or fewer.
- Use lower-case imperative language and no trailing period.
- Use a narrow domain scope when it helps: `harness`, `worktrees`, `editor`,
  `terminal`, `files`, `sessions`, `inbox`, `updates`, `tauri`, or `release`.
- Keep one concern per commit; split unrelated changes.
- Use `!` only for a breaking change and explain the impact in the body.
- Explain why in the body only when the subject is insufficient.
- Never add `Co-authored-by`, generated-by text, or agent attribution.
- Do not append issue or PR numbers to ordinary branch commits.

## Procedure

1. Inspect the working tree and the complete diff.
2. Stage only the files or hunks for this concern.
3. Run the smallest relevant verification.
4. Inspect the staged diff and confirm no unrelated user work is included.
5. Commit only when the user asked.
6. Reinspect the staged/working diff after the commit: Lefthook may rewrite and
   restage JS, TS, JSON, CSS, or Rust files during `pre-commit`.

Conventional Commit format is currently a repository convention, not an
installed `commit-msg` hook. Lefthook's formatting hook is authoritative; never
bypass it with `--no-verify`.
