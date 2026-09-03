# wavex development guide

wavex is a Tauri 2 desktop application for installed coding-agent CLIs. It
ships for macOS (Apple Silicon), Linux (x86-64), and Windows (x86-64). The
frontend is React 19 + TypeScript; the native host is Rust. It works in the
user's real checkout, so filesystem, Git, process, and worktree changes must be
treated as user data rather than disposable sandbox state.

## Product boundaries

- wavex has no account or hosted backend. Provider authentication belongs to the
  installed CLI, not to wavex.
- macOS, Linux, and Windows are all supported distribution targets, and every
  release builds all three. Code that reaches the operating system belongs
  behind a `cfg` arm or a platform helper, not behind an assumption that the
  host is macOS. Native integrations without an equivalent elsewhere — the menu
  bar popover, the Dock badge, window vibrancy — stay `#[cfg(target_os =
"macos")]` and degrade to nothing.
- Spawn child processes through `src-tauri/src/process.rs`, never
  `Command::new` directly. Windows gives a bare `CreateProcess` its own console
  window, which flashes over the app on every `git status`.
- Every path Rust hands the WebView goes through `fs::path_to_js`, and TypeScript
  keeps one slash direction via `slash`/`normalizeProjectPath` in
  `src/lib/paths.ts`. Compare paths with `pathKey`, never `===`: Windows paths
  are case-insensitive, so a raw comparison splits one project into two rail
  entries, two tabs, and a pin that never matches.
- Match a program by `binary_name_eq`, not `file_name()`. Agent CLIs install
  through npm, which writes `claude.cmd` — a `== "claude"` check rejects every
  provider on Windows.
- A **harness** is an adapter for one coding-agent CLI. CLI-specific protocol
  details stay behind the harness registry.
- A **session** is the persisted conversation. Tabs, panes, splits, and groups
  are workspace presentation around sessions.
- A **worktree** is a real Git checkout. Never delete, reset, or reuse one
  without preserving uncommitted user work.

## Structure

`src/lib/` holds shared domain vocabulary such as `session.ts`, `fs.ts`,
`paths.ts`, `recents.ts`, `models.ts`, and `platform.ts`. Wide-fan-in modules
stay at the root; cohesive machinery lives in a subdirectory:

- `src/lib/harness/`: provider adapters, protocol parsers, and the registry
- `src/lib/sessions/`: session collections, history, filters, and persistence
- `src/lib/workspace/`: tabs, panes, splits, groups, and snapshots
- `src/lib/terminal/`: PTY plumbing and terminal dock state
- `src/lib/editor/`: editor documents, git gutter, lint, and search
- `src/lib/files/`: file index, tree, mentions, and watching
- `src/lib/inbox/`: GitHub issues and pull requests
- `src/lib/updates/`: updater and release notes
- `src/lib/profiles/`: profiles, their registry, and profile-scoped storage
- `src/lib/project/`: project logos, mascots, metadata
- `src/lib/worktrees/`: git worktrees, their folders, and the repository they
  belong to
- `src/lib/updates/`: updater state and release notes
- `src/lib/project/`: project logos, mascots, and metadata
- `src/lib/usage/`: local provider usage summaries

`src/chrome/` contains application chrome and reusable controls,
`src/surfaces/` the main views, `src/hooks/` React hooks, and
`src-tauri/src/` the Rust backend. `tests/unit/` mirrors `src/` and imports
through the `@/` alias.

Keep the distinction between a domain type and its collection machinery. For
example, `src/lib/session.ts` is the session vocabulary while
`src/lib/sessions/` manages groups of sessions.

## Architecture rules

### Harnesses

Harnesses register through `src/lib/harness/registry.ts`. Consumers dispatch
through the registry or the generic `src/lib/harness/index.ts` surface; they do
not import a provider adapter directly. Keep provider wire formats and quirks in
that provider's protocol/adapter files, then translate them into generic harness
events and types.

The Rust harness host supervises processes and transports. It must not acquire
provider-specific product behavior that belongs in a TypeScript adapter. Preserve
session bind, stop, forget, cancel, and idle-park semantics when changing a
provider lifecycle.

### Profiles

A profile is a separate identity inside one install: its own projects, chats,
agents, workspace, and preferences. It is app-wide, not per window — switching
persists every window, stops the agents and terminals of the profile being left,
swaps the native stores, and reloads.

Browser state that belongs to a profile goes through `profileStorage` in
`src/lib/profiles/`, never `localStorage` directly. Native state lives under the
profile's data directory in `src-tauri/src/profiles.rs`. The default profile
deliberately keeps the top-level directory and the unprefixed keys, so an
install that predates profiles needs no migration. It can be renamed but not
deleted.

Provider authentication and CLI-owned agent definitions are not profile-scoped;
they belong to the installed CLI. Say so in the UI rather than implying
otherwise.

### Tauri boundary

Rust owns operating-system side effects: processes, PTYs, filesystem access,
Git, native windows, SQLite, and per-platform desktop integration. React should call a typed
wrapper rather than scattering raw `invoke()` calls through components.

When adding a command, update every applicable layer:

1. Implement the Rust command in the cohesive `src-tauri/src/` module.
2. Register it in `tauri::generate_handler!` in `src-tauri/src/lib.rs`.
3. Add the typed TypeScript wrapper and domain types in `src/lib/`.
4. Cover pure TypeScript logic in `tests/unit/` and Rust behavior with focused
   unit tests where practical.

Pass paths and command arguments as structured values. Do not build shell command
strings from user-controlled paths. Return actionable errors instead of panicking
at the IPC boundary.

### React and state

Follow existing `useSyncExternalStore` stores for shared external state. Do not
add Zustand, Jotai, Redux, or another state package without an architecture
decision. Keep transient view state local.

This is a client-rendered Vite application, not Next.js or an SSR application.
Do not introduce server-component, hydration, or web-framework patterns.

Use the existing custom chrome primitives and Tailwind 4 tokens. This is not a
shadcn project. Import application icons from `src/chrome/icons.tsx`; that file
deep-imports Hugeicons deliberately so the full catalog is not bundled.

Long transcripts, file lists, and live streaming are performance-sensitive.
Avoid unbounded rendering, unnecessary global subscriptions, continuously
repainting decoration, and work repeated for every streamed token.

## Tests

Vitest runs in the Node environment and discovers `tests/**/*.test.ts`. Tests
cover extracted logic and observable server-rendered markup; there is no jsdom
or React Testing Library setup. Do not add either without a separate testing
architecture decision.

Mirror the source path under `tests/unit/`. Prefer testing protocol parsers,
state transitions, persistence normalization, path logic, and command results
over implementation wiring.

## Verification

Run the smallest focused proof while iterating. Before a pull request, run:

```sh
pnpm check
```

It checks distribution metadata, oxlint, oxfmt, TypeScript, Vitest, the Vite
build, rustfmt, Clippy with warnings denied, and Rust tests — for the host
platform only. CI compiles the Rust host on macOS, Linux, and Windows, so a
change inside a non-host `cfg` arm is not proven until that matrix runs. The Vite build is
part of the gate because `index.html` references `/src/main.tsx` as plain HTML,
which TypeScript does not validate.

Useful focused commands:

```sh
pnpm exec vitest run tests/unit/lib/harness/registry.test.ts
pnpm run check:web
pnpm run check:rust
cargo test --workspace
```

Use oxlint and oxfmt, not ESLint or a Prettier formatting script. Existing
comments explain load-bearing reasons; change them only when the reason changed.

## Git and GitHub

The detailed workflow lives in the project skills under `.agents/skills/`.
Use the matching skill for commits, branches, issues, pull requests, repository
settings, and releases.

- Never commit, push, open or merge a PR, tag, publish a release, or modify
  remote GitHub settings unless the user asked.
- Preserve unrelated work in the working tree. Reinspect the staged diff after
  Lefthook because it may format staged files.
- Use clear English Conventional Commit titles no longer than 72 characters.
- Never add `Co-authored-by`, generated-by text, or agent attribution.
- Work on a focused branch, not directly on `main`.
- Link an existing issue when one exists; do not manufacture an issue solely to
  satisfy a pull-request template.
- UI pull requests include before/after evidence when it helps reviewers.
- Never bypass hooks, required checks, reviews, or branch protection.

## Plans and artifacts

Do not commit implementation plans, research notes, generated audit reports, or
agent scratch files. Durable architecture decisions belong in this file or in
the code whose behavior they constrain.
