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
- `src/lib/transport/`: the host transport seam and its remote connection
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

### Hosts and the transport seam

The part that owns the checkout and supervises agents does not have to be the
part that draws the UI. Command calls and event subscriptions therefore go
through `src/lib/transport`, which dispatches either to local Tauri IPC or to a
remote host, instead of importing `@tauri-apps/api/core` directly. Emitting is
the exception: it broadcasts between this client's windows, so it stays local.

`src/lib/host.ts` is the vocabulary for which machine an identity belongs to. A
path is unique only on the machine that owns it, so projects compare through
`projectKey` and sessions through `sessionRefKey`. This device keeps the
unqualified form — the bare path, the bare session id — exactly as the default
profile keeps the unprefixed keys, so an install that has never connected to a
remote host needs no migration.

A remote host is the user's own machine reached directly or through a tunnel.
That keeps "no account or hosted backend" intact; a hosted relay would not, and
is a separate decision.

`src-tauri/src/connect/` is the host end of that seam. It binds loopback and
nothing else, refuses every unauthenticated connection including the first,
trades the long-lived token for a single-use ticket before the upgrade, and
drops live sockets when the token is replaced. Reaching a host from another
machine is an SSH tunnel's or a private network's job, never a bind address
wavex chose on the user's behalf.

`connect/dispatch.rs` is the allowlist, written out by hand on purpose: a host
runs commands and writes to a real checkout, so what it will not do has to be
readable in one file. Anything that draws a window, badges a Dock, switches a
profile, or answers in raw bytes stays off it. A new command is not reachable
over a connection until it is added there.

Neither token belongs in browser storage. The host's own token and the tokens
this client saved for other hosts are written by Rust under the profile or
install directory, and a saved token is read back only at the moment a
connection opens.

A browser client has no Rust to hold a token for it, so it holds none. It pastes
the connection code once, the host spends it for an `HttpOnly` cookie, and the
page's own scripts can never read that cookie back — which is what the rule
above is protecting against, so this is the rule kept rather than an exception
to it. The session lives in the host process only: it never reaches disk, it
goes when the token is rotated, and it goes when the host stops.

The cookie counts only when the request came from a page this host served: the
host reads `Sec-Fetch-Site` when a browser sends it, and falls back to matching
`Origin`. A read that carries neither is allowed, because a same-origin `GET`
sends neither and a reloaded tab has to be able to ask whether it is still
paired; a cross-origin `GET` a page could make arrives tagged and is refused,
and anything that spends the session is refused outright when it is untagged. A
bearer, which no browser attaches on its own, stays origin-agnostic. A token in
a URL is never an option — it would land in history, in a referrer, and in every
proxy log.

The host serves the frontend it already embeds, over the same loopback HTTP, so
reaching a wavex instance from a browser needs nothing installed. That route is
read-only over embedded assets, resolves no filesystem path, and answers with no
CORS headers. Every request is refused unless it was addressed to a loopback
name, which is what stops a hostile page pointing a name it owns at 127.0.0.1
and calling this host its own origin.

`src/lib/clientRuntime.ts` says whether the machine drawing this window has a
native shell at all, and `src/lib/native.ts` is where everything that belongs to
that machine goes: dialogs, the file picker, the window, the webview's own drag
and drop, opening a URL. A browser client gets the browser's equivalent where
there is one and nothing where there is not. Absent is the requirement — the
menu bar popover, the Dock badge, vibrancy, window transfer, the updater, and
profile switching must be missing in a tab, never broken in it.

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
