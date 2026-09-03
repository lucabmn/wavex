# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
