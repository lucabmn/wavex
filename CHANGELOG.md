# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
