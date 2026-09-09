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
- `src/lib/workspace/`: tabs, panes, splits, groups, snapshots, and the
  project dock — the side panel holding the browser, terminals, files, and review
- `src/lib/terminal/`: PTY plumbing and terminal tab state
- `src/lib/transport/`: the host transport seam and its remote connection
- `src/lib/editor/`: editor documents, git gutter, lint, and search
- `src/lib/editor/`: editor documents, git gutter, diagnostics, search, and
  the CodeMirror side of language server support
- `src/lib/lsp/`: the language server protocol, its clients, and their lifecycle
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
- `src/lib/automations/`: scheduled agent tasks, their schedules, and their runs

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

### Language servers

The coding view drives installed language servers. `src-tauri/src/lsp.rs`
supervises the child processes and moves whole `Content-Length` frames across
the boundary; everything above that — the handshake, capabilities, document
sync, and every request — lives in `src/lib/lsp/`. It is a separate host from
`harness.rs` on purpose: that one reads newline-delimited JSON and carries
agent-session semantics a language server does not have.

A server is rooted **per worktree checkout**, never at the shared repository. A
worktree holds a different branch's files, and a server rooted above it would
index — and report diagnostics against — text that is not in the file being
edited. Inside a checkout the outermost root marker wins, so a monorepo or a
Cargo workspace runs one server rather than one per package. The cost is one
server per open checkout, bounded by refcounting documents and stopping a
server that has had nothing open for a while.

A definition may pick its own executable per checkout through `resolve`, because
one language can have more than one engine. TypeScript is the case that forces
it: version 7 is a native binary that speaks the protocol itself, while version
5 ships `tsserver.js`, which is not a server but the back end
`typescript-language-server` drives and has to be told the path of. The
checkout's own TypeScript is preferred over a global one either way, so the
errors in the editor are the ones `tsc` would report.

Diagnostics arrive both ways and land in one store. Most servers push
`publishDiagnostics`; a server advertising `diagnosticProvider` is asked with
`textDocument/diagnostic` instead, debounced after a change and cancelled when
the next one supersedes it. TypeScript 7 needs this — it answers pulls with the
type errors and pushes only project-level ones, keyed to `tsconfig.json`.

wavex never downloads a server, and never starts one on its own: it uses what
the user has installed and quotes the install line for what it does not find.
A server is a long-lived process that indexes a whole checkout, so opening a
file is not consent to run one. The editor offers it once, on the first file
that language covers; the answer is remembered per profile and lives in
Settings. Nothing about the editor changes until the answer is yes. Servers stop on profile switch,
window close, and quit, like agents and terminals. A missing, crashed, or
still-starting server leaves the editor exactly as it behaves without one.

### Automations

An automation is a prompt, a checkout, and a schedule. Every occurrence it
produces is an ordinary persisted session, so a scheduled turn is as
inspectable afterwards as one somebody typed.

Every schedule calculation lives in `src/lib/automations/`, against an IANA
zone through `Intl`. Rust stores the definition, the next instant, and a
bounded run history, and never parses a schedule — implementing weekdays,
zones, and daylight-saving twice would mean testing them once. An interval is
elapsed time from an anchor, so it is immune to a clock jump; a wall time the
spring transition deletes follows the automation's daylight-saving policy, and
an hour the autumn transition repeats fires once.

The tick runs in every window, because it is not what decides anything:
`automation_run_start` claims an occurrence inside a transaction, keyed on the
occurrence rather than the clock, so whichever window asks first runs it. That
is stronger than electing one window, which still double-fires when a window
misses the hand-off. A window driving a run renews its lease each tick, and a
run that stops being renewed is settled as interrupted — a row left marked
going would refuse every later claim and take the automation off the schedule
for good.

Nothing runs while no window is open, because the harness adapters are
TypeScript. That is a fact the surface states rather than works around: an
occurrence that comes due with wavex closed is a missed run, and the
automation's missed-run policy decides what happens to it. A run inherits the
harness's normal approval behaviour and is never granted more; one that stops
on an approval settles as needing attention and waits for a person. A missing
checkout is a failed run, never a checkout wavex repairs.

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

### The design language

`src/index.css` is the whole design system; components spend its tokens rather
than inventing colors, shadows, or corners of their own.

The window is nearly colourless, and that is the point: colour that appears
everywhere stops meaning anything, and in a tool that is mostly text the job of
the surface is to disappear. Four planes come off the one background lightness
the user controls — `--surface-0` sunken, `--surface-1` the page, `--surface-2`
raised, `--surface-3` overlay — as `bg-surface-sunken`, `bg-surface`,
`bg-surface-raised`, `bg-surface-overlay`. The ladder is shallow on purpose:
separating everything by shade leaves the window looking quilted, so most of
the app sits on one plane and a step is spent only on the sidebar behind the
work, a card above the page, and an overlay above everything. Paper climbs the
same way: the sidebar is greyer than the page and a card is whiter than it,
ending at white. Paper has a ceiling graphite does not, so its ladder is built
_downwards_ from `--paper-top` — capped at 100%, four points above the page —
and never upwards from the page. Deriving upwards meant a saved lightness near
100 clamped the two rungs above the page onto it: a card came out the same
colour as the sheet it was supposed to sit on, and an overlay had only its
shadow to stand on. The cap is why a stored 100 now behaves like the default
rather than collapsing the ladder — and stored values do reach production,
because a preset writes both schemes and outlives any change to the defaults.

A shadow on paper is a shadow, not a hole: the alpha that reads as depth over
graphite reads as dirt under a white card, so light carries its own elevations
and relies on the surface step above to do the lifting. Both ends of the Depth
scale are therefore restated for light — the theme block is declared after the
`depth-flat` and `depth-deep` arms and matches their specificity, so without a
light arm of its own the setting would do nothing on paper.

Tailwind's `dark:` is bound to `html:not(.theme-light)` rather than to
`prefers-color-scheme`. Nothing in `src` writes `dark:` itself; the variant
exists for the markdown renderer's vendored classes, which ship syntax colours
as `dark:text-[var(--shiki-dark,…)]` and otherwise paint a dark desktop's
palette onto a white card.

Status has four meanings and one tone each — `danger`, `warn`, `positive`,
`note` — spent as `text-danger`, `bg-warn/15`, `border-danger/30`. Never reach
into Tailwind's palette for a status: a `-400` rung is picked for whichever
theme its author had open, and the shades that read on graphite wash out to
illegible pastel on paper. These carry a value per theme instead, each tuned to
land near the contrast its counterpart does, so one class is right in both.

Text speaks in four strengths — `text-strong`, `text-muted`, `text-faint`,
`text-dim` — never a hand-picked `text-content/N`. Opacity is not symmetric
between the themes: 45% of near-white on graphite is 4.1:1, and the same 45%
of near-black on paper is 2.6:1, which is why light used to read as washed out
however dark its ink. The light rungs are therefore higher than the dark ones,
tuned so each lands on the contrast its counterpart does. `--glass` floors the
window's translucency on paper for the same reason: the desktop behind a light
window is usually darker than it, so the setting that reads as tinted glass
over graphite reads as a smear over paper.

Hairlines are `border-edge` and `border-edge-strong`, never a hand-picked
`border-content/N`: the Separators setting scales all of them through one
`--rule`. Hover is `bg-hover` and selection `bg-selected`, one tone each for
the whole app, so a row in the file tree answers the pointer exactly like a row
in a menu. Nothing in the chrome uses a gradient and nothing glows; shadows
(`shadow-raise`, `shadow-float`, `shadow-cast`) are for things that float.

The accent is not the colour of the app, it is the colour of "this one". It
appears on the icon of the selected row, a primary button, focus, and a link,
and nowhere else. Selection is therefore `ui-row` with `data-selected="true"`:
a flat step and full-strength text, with the accent spent on the row's icon —
one glyph rather than a band of colour, which is what a list of forty can
afford. Exclusive choices are `ui-tab` with the same attribute (flush, named by
a rule along the bottom edge); `ui-segment` is the variant for a boxed track.
`ui-fill` is the one filled action a surface is allowed, `ui-tint` its quieter
sibling. Overlays take `ui-overlay`, cards `ui-pane`, focus `ui-focus`, group
headings `ui-label`, the user's own turn in a transcript `ui-prompt`, and a
seam between two strips of chrome `ui-rule-b` / `ui-rule-r`.

The window is two columns: a sidebar and the work. The project rail is a third
column and is closed by default — the sidebar's own header already carries the
project switcher and every destination the rail holds, so a permanent nav
column bought a third vertical pane before any content. Opened, it keeps its
own right-hand rule: without one the projects list and the sessions list run
together into a single field of rows with no telling where one ends.

One header spans the whole window, above both columns: `TitleBar` mounts at the
App root, not inside the body. It is the only thing that reserves the macOS
traffic-light inset, and it carries the visit arrows, the panel toggles, the
mode switch, what is open, and the window's own actions. Every column used to
open with a 40px strip of its own — the rail's, the panel's, the body's, and
the two Work draws — so the top of the window was a stack of headers rather
than a place. Nothing below the header reserves the traffic lights or draws a
back arrow again; a surface that wants a title draws a title.

The mode switch belongs to the rail whenever the rail is open; the header
carries it only for a collapsed rail. Rendering it in both put it on screen
twice. Nothing that lays out in a narrow column may be dropped into the header
unchanged for the same reason — `DevModeSlot` is a `flex-1` spacer built for
the rail, and in a full-width header it swallowed the row and pushed the tabs
to the far edge.

The toolbar holds one panel toggle, for the sidebar. Showing and hiding the
projects column belongs to the sidebar's own header, in both of its variants:
side by side in the toolbar the two drew the same glyph and read as one control
duplicated.

Every strip of tabs is a 40px band whose tabs are `h-full`, so the rule under
the live one always lands on the bottom edge of the row it belongs to. That
includes the mode switch at the top of the rail _and_ the one Work draws: each
stands beside a strip in the next column, so each gets a band of its own rather
than sitting inside the padded column below it, and a mode switch does not move
when the mode does. A strip sized to its content instead puts two rules at two
heights, and two strips side by side stop reading as one row.

A tab in the header is a chip, not an underlined tab: it sits in a toolbar
rather than on top of the content it selects, so an underline has nothing to
point at. The underline idiom (`ui-tab`) stays where it does point at
something — the sidebar's own strip and the mode switch.

One open session is still a session, and is drawn as the same chip at the same
width as any other. Stretching a lone tab into a heading put two type sizes in
a 40px band and read as a broken title rather than as a tab. The chip is also
deliberately wider than the 11rem its container queries switch on, so a tab at
rest never sits exactly on that boundary and flips its meta line on sub-pixel
rounding.

The window ground is the sunken plane. The sidebar sits directly on it and
needs no rule of its own, and the work floats above it as an inset sheet with
a radius and an edge — the gap is the separation.

Corners, Depth and Separators in Settings scale the language rather than
bolting a second one beside it, which only holds while radius, shadow and rule
strength each stay a single token.

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
