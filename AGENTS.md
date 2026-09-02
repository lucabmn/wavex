# wavex development guide

wavex is a macOS-only Tauri 2 desktop application for installed coding-agent
CLIs. The frontend is React 19 + TypeScript and the backend is Rust.

## Structure

`src/lib/` holds the shared domain vocabulary — `session.ts`, `fs.ts`,
`paths.ts`, `recents.ts`, `models.ts`, `platform.ts` and the small utilities.
These stay at the root because a wide fan-in is what makes them shared; putting
them behind a feature folder would make most imports cross a boundary that does
not mean anything.

Cohesive clusters live in their own directory beneath it:

- `src/lib/harness/`: provider adapters and wire protocols
- `src/lib/sessions/`: session list, history, filters, persistence
- `src/lib/workspace/`: tabs, panes, splits, snapshots
- `src/lib/terminal/`: PTY plumbing and the terminal dock
- `src/lib/editor/`: editor document, git gutter, lint, search
- `src/lib/files/`: file index, tree, mentions, watching
- `src/lib/inbox/`: GitHub issues and pull requests
- `src/lib/updates/`: updater and release notes
- `src/lib/project/`: project logos, mascots, metadata
- `src/lib/worktrees/`: git worktrees, their folders, and the repository they
  belong to

`src/chrome/` is application chrome and reusable controls, `src/surfaces/` the
main views, `src/hooks/` React hooks, and `src-tauri/src/` the Rust backend.
`tests/unit/` mirrors `src/` and imports through the `@/` alias.

Note the pair: `src/lib/session.ts` is the domain type, `src/lib/sessions/` is
the machinery around collections of them.

## Required checks

Run `pnpm check` before every pull request. It runs oxlint, oxfmt, both
TypeScript projects, Vitest, the Vite build, rustfmt, Clippy, and Rust tests.

The Vite build is part of the gate on purpose: `index.html` references
`/src/main.tsx` as plain HTML, and no typechecker validates that path.

## Conventions

Use oxlint and oxfmt rather than ESLint or a Prettier script.

Tests run in the Node environment and cover extracted logic. Component files
have `.test.ts` siblings that test their logic, not their rendering. Do not add
jsdom or React Testing Library without a separate architecture decision.

For shared state, follow the existing `useSyncExternalStore` pattern rather
than adding Zustand, Jotai, Redux, or another state-management package.

Harnesses register through `src/lib/harness/registry.ts`. Reach a provider
through the registry, never by importing its module directly — the barrel
deliberately exposes only the generic surface.

Comments explain why, not what. The existing ones are load-bearing; leave them
alone unless the reasoning they record has actually changed.
