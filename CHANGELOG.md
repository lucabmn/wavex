# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

- Float the work as an inset, rounded sheet on the window's own ground, with
  the sidebar sitting directly on that ground rather than behind a rule.
- Give the window one header instead of five. The title bar spans the whole
  window above both columns and is the only thing that holds the macOS traffic
  lights out of the way; the project rail, the workspace panel, Work's two
  columns and every overlay surface lose the 40px strip each used to open
  with, along with the back arrow and sidebar toggle each drew again.
- Open in two columns rather than three. The project rail is closed by default
  — the sidebar's header carries the project switcher and every destination it
  held — and the sidebar itself has one header row instead of three. A lone
  open tab reads as the title of what is on screen rather than as a chip in an
  otherwise empty strip.
- Redesign the whole interface. The project rail and the workspace panel are
  one sidebar with a single header band rather than two panels each with a
  header of its own; the window is nearly colourless, separated by planes and
  space instead of a rule around every box; tabs are flush and named by a rule
  under the live one; and the accent appears only on the icon of the selected
  row, a primary button, focus, and links. Nothing in the chrome uses a
  gradient and nothing glows. Transparent mode keeps working throughout.
- Every hairline, hover and selected state in the app resolves to one shared
  token, and the type scale steps up so the hierarchy is carried by size and
  weight rather than by borders.
- Read the transcript as prose. It ran monospace throughout, which made a
  conversation read as a log; it now runs in the interface face at a larger
  size with real space between turns, and only the parts that are genuinely
  code keep monospace metrics. Links take the accent instead of a hard-coded
  blue.
- Add two appearance rules: Depth, which sets how far raised surfaces stand off
  the ones behind them, and Separators, which sets how strongly every hairline
  in the app is drawn.

## [0.13.0] - 2026-09-08

- Schedule recurring agent tasks from the new Automations surface. Each run
  produces an ordinary persisted session and inherits the harness's normal
  approval behaviour.
- Browse in a sandboxed page inside the project panel, alongside terminals,
  files, and the working tree. Pages that refuse framing open in the real
  browser instead.
- Pick the workspace model from Settings.
- Swap the Nord and wavex appearance themes and replace the empty-sessions
  artwork with the new 8-bit logo.

## [0.12.0] - 2026-09-08

- Manage installed project skills from Settings and include relevant Git
  writing skills in generated commit, PR, and branch prompts.
- Choose the provider and model used for Git writings, with live model catalogs
  and searchable model lists.
- Rebuild Settings into focused pages, including expanded appearance controls,
  profiles, language servers, archive, and provider settings.
- Open projects in installed editors and terminals, with platform-aware
  application detection and icons.
- Improve workspace mode transitions and surface motion.

## [0.11.1] - 2026-09-08

- Start a race from the composer's send control instead of a separate dialog.
- Rebuild the activity board: one set of lanes across projects, the view switch
  in the header, and a card that can only be parked once its turn has finished.
- Stop drawing a second set of window buttons over the activity page on macOS.
- Keep one full-window page open at a time, so opening Usage no longer leaves
  Activity splitting the window with it.
- End a host's HTTP answer with a close Windows survives, so a browser client
  reads the reply instead of a reset connection.

## [0.11.0] - 2026-09-07

- Add a kanban activity board for tracking project work across sessions.
- Route prompts with awareness of provider quota and plan limits.

## [0.10.0] - 2026-09-07

- Race one prompt across two or three installed agents at once. The runners
  share the session's checkout, their answers sit side by side for comparison,
  and the winner is kept per hunk. Each runner snapshots its own baseline
  first, so accepting or undoing one never touches your commits or another
  runner's work.
- Collapse the working agents section in the rail.
- Keep long transcripts responsive while streaming. Settled turns no longer
  re-render for every token, and a user message resolves its line height once
  instead of on every reflow.
- Keep the project name readable beside the diff stat in the rail. Counts are
  shown compact in the chip, with the exact numbers in the tooltip and the
  accessible label.
- Show the changes-tab diff stat only while there are uncommitted changes.
- Show the update entry in the sidebar only when an update is available.
- Set the bundle identifier in the Windows configuration.

## [0.9.0] - 2026-09-07

- Add a custom installer icon and sidebar image to the Windows bundle.
- Improve chat message wrapping and styling for single-line and overflowing
  user messages.

## [0.8.0] - 2026-09-07

- Connect to a wavex host on another machine through an authenticated loopback
  host or browser client, with remote projects, sessions, and host-owned agents.
- Show subagent transcripts inline or in a dedicated pane.
- Add language-server support for diagnostics, navigation, completion, hover,
  formatting, rename, and references in the coding view.
- Improve cross-platform host routing, browser command behavior, and workspace
  state handling.

## [0.7.0] - 2026-09-04

- Queue follow-ups in a stacked card above the composer with edit, steer, and
  remove per row. A Follow-up behavior setting (Queue by default, Steer
  opt-in) controls it, and stopping pauses the queue until Resume continues
  the turn first.
- Drive dialogs, tabs, and resize handles from the keyboard: shared dialog
  focus handling, arrow-key tab navigation, and visible focus states.
- Scope the command palette with a prefix: `>` commands, `@` files, `#`
  search, `?` every documented shortcut.
- Meet first-run installs with a short, skippable setup wizard.
- Confirm profile switches while agents are in flight, naming the sessions
  that would pause.
- Confirm chat and project deletes, retry failed loads and deletes, and keep
  a chat visible when its deletion fails.
- Filter the Activity view by All, Needs-you, Working, and Done.
- Rename Work and Coding to Chat and Workspace across labels and shortcuts.

## [0.6.0] - 2026-09-04

- Run any app command by name from a command palette on `Cmd+K`; Search moves
  to `Cmd+F`, where the editor's find bar still wins while an editor has focus.
- Queue a prompt written while a turn is running. It waits above the composer,
  where it can be sent or removed, and goes out when the turn ends on its own.
  Work chats used to drop such a message without a trace.
- Open Work with an empty chat from anywhere with a global
  `Cmd+Shift+Space`.
- Add Activity, a surface listing every agent running in this install —
  across windows, projects, and worktrees — with the project it works in, how
  long it has run, what it is waiting on, and a stop button.
- Review a diff without the mouse: `j`/`k` walk hunks, `n`/`p` walk files, `s`
  stages the hunk or file, `u` unstages, and `d` discards behind a
  confirmation.
- Unstage a file directly from the working-tree diff.
- List every shortcut the app answers to on the Keybindings page, including
  Settings and the Work/Coding switch, which were missing.

## [0.5.0] - 2026-09-03

- Add custom prompt templates saved to projects, accessible from the Composer
  picker, and editable from the composer chrome.
- Show a persistent footer in the Work sidebar matching the Coding view's
  context display.
- Add profile-switch overlay in the app header for quick profile navigation.
- Improve skill picker search and rendering for better category visibility.
- Enhance live-agent monitoring and session state tracking.
- Improve menu bar context menu and approval toast behavior.

## [0.4.0] - 2026-09-03

- Run wavex on Linux and Windows with native terminals, cross-platform CLI
  discovery, stable path handling, hidden child-process consoles, and native
  installers and updater bundles for all three desktop platforms.
- Add Chrome-style profiles that isolate projects, chats, agents, workspaces,
  and preferences, while keeping repositories and worktrees untouched.
- Add a unified diff view for working-tree and pull-request changes, with
  syntax highlighting, sticky file headers, line numbers, and per-line staging.
- Add a Git history graph with commit lanes and read-only commit diffs, plus a
  control to discard all unstaged changes while preserving staged work.
- Open raster images in a read-only viewer with zoom, dimensions, and file size;
  SVG files also gain a rendered preview beside their source.
- Render images and videos from GitHub and Linear issues and pull requests
  inline, with safe authenticated media fetching.
- Add quick actions to close other tabs, mark inbox items as read, and copy
  Markdown code blocks.
- Show the model and harness in turn status, and make Escape stop the focused
  agent turn without affecting the workspace while Work is in front.

## [0.3.0] - 2026-09-03

- Add Work, a chat surface for questions that do not belong to any project, with
  its own sidebar and a switch between Work and Coding.
- Sort work chats into projects, and pin or archive them from the chat list.
- Render images a turn returns inline in the transcript.
- Restore the last top-level mode, so wavex reopens where it was left.

## [0.2.0] - 2026-09-02

- Create, remove, and switch Git worktrees from the project sidebar, so several
  agents can hold one repository open at once.
- Report token usage, cost, and subscription plan limits per provider from the
  installed CLIs' own transcripts.
- Sign, notarize, staple, and Gatekeeper-check macOS releases before publication.
- Publish signed updater bundles and a verified `latest.json` feed.

## [0.1.0] - 2026-09-02

- First release of this base.
