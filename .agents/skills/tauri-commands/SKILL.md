---
name: tauri-commands
description: Add, modify, review, or debug wavex Tauri IPC and Rust host behavior. Use for filesystem, Git, worktree, process, PTY, SQLite, updater, window, macOS-native, or other commands crossing between TypeScript and src-tauri.
---

# Tauri commands

The Tauri boundary is a security and ownership boundary. Rust owns native side
effects; TypeScript owns typed domain-facing wrappers and UI orchestration.

## Change checklist

1. Find the cohesive Rust module under `src-tauri/src/`; do not grow `lib.rs`
   with implementation logic.
2. Define a narrow `#[tauri::command]` with serializable input/output types.
3. Validate paths, repository state, and destructive preconditions near the
   native operation.
4. Pass paths and subprocess arguments as structured arguments. Never interpolate
   them into a shell command string.
5. Return `Result<T, String>` or the established typed error mapping with an
   actionable message. Do not panic for user/environment failures.
6. Register the command in `tauri::generate_handler!` in
   `src-tauri/src/lib.rs`.
7. Add a typed frontend wrapper in the owning `src/lib/` module. Components
   should not scatter raw `invoke()` calls.
8. Update permissions/capabilities or Tauri configuration only when the command
   requires them, and keep the scope minimal.
9. Add focused Rust tests for native behavior and TypeScript tests for extracted
   normalization/state logic.

## Native invariants

- wavex operates on real user checkouts. Preserve uncommitted changes and reject
  ambiguous destructive operations.
- Keep provider-specific behavior out of the generic harness host.
- Preserve process and PTY cleanup on cancellation, window destruction, and app
  exit.
- Finder-launched apps may lack HOME, USER, and SHELL. Use the existing passwd
  fallback rather than assuming a terminal environment.
- Keep macOS-only APIs behind appropriate `cfg` boundaries and do not broaden
  entitlements, CSP, asset-protocol scope, or updater permissions casually.
- Do not log credentials, prompts, repository contents, full private paths, or
  raw provider output.

## Verification

Use focused tests while iterating:

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm run check:web
```

Run `pnpm check` before a pull request. If the command affects packaging,
updating, permissions, or distribution metadata, also inspect and run the
matching scripts under `scripts/`.
