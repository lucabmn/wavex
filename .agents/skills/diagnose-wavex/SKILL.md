---
name: diagnose-wavex
description: Diagnose wavex runtime failures and regressions across the React WebView, Tauri commands, Rust backend, provider harnesses, PTYs, Git, worktrees, and macOS integration. Use when wavex is broken, slow, crashing, or producing unexpected provider behavior.
---

# Diagnose wavex

Use evidence from the actual failing boundary. wavex does not use evlog and has
no `.evlog/logs` contract or hosted request log.

## First pass

1. Capture the exact symptom, action, provider, wavex version, macOS version,
   project path shape, and whether the app was started from `pnpm tauri dev` or
   as an installed bundle.
2. Preserve the working tree and active worktrees. Reproduce with the least
   destructive input possible.
3. Identify the boundary:
   - React state/rendering or browser API
   - typed Tauri invocation
   - Rust filesystem/Git/SQLite/native command
   - harness child lifecycle or provider wire protocol
   - PTY/terminal transport
   - updater/signing/distribution
4. Read the relevant code and tests before adding diagnostics.

## Evidence sources

### Development app

Run from a terminal when reproduction is safe:

```sh
pnpm tauri dev
```

Use WebView developer-console errors for React-side failures and the launching
terminal for Rust stderr, panics, and child-process supervision errors. For a
Rust panic, rerun with `RUST_BACKTRACE=1` if the output lacks a backtrace.

### Installed app

Ask the user for the smallest relevant Console.app excerpt or use a bounded
macOS unified-log query when available. Do not collect an unbounded system log.
Installed-app failures may differ because Finder launches have a reduced
environment; inspect the HOME/USER/SHELL fallback and executable-resolution
logic before assuming the CLI is absent.

### Harnesses

Trace provider output through its protocol parser and adapter into generic
`HarnessEvent` values. Check:

- executable discovery and login state;
- spawn arguments and environment;
- stdout/SSE/JSON-RPC framing;
- provider session ID binding and resume behavior;
- cancel, stop, forget, idle park, and process reaping;
- model catalog normalization.

Prefer a focused parser or lifecycle test with sanitized fixture data over
printing a live transcript.

### Filesystem, Git, worktrees, and PTYs

Inspect the typed frontend wrapper, Rust command, and `generate_handler!`
registration together. Confirm paths are passed as arguments rather than shell
text. Before reproducing mutations, use a temporary repository or obtain
explicit approval.

## Verification

Start focused, then expand:

```sh
pnpm exec vitest run <matching-test-file>
cargo test --workspace <matching-test-name>
pnpm run check:web
pnpm run check:rust
```

Use `pnpm check` for the final repository-wide gate when warranted.

## Diagnostic changes

- Add temporary logging only when existing evidence cannot distinguish the
  hypotheses.
- Log operation names, provider IDs, state transitions, durations, and sanitized
  error classes—not prompts, credentials, authorization headers, full command
  output, private paths, repository contents, or session transcripts.
- Remove temporary diagnostics before completion unless they are deliberately
  useful product diagnostics.
- Report root cause separately from symptoms, evidence, fix, and residual risk.
