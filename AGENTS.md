# wavex development guide

wavex is a macOS-only Tauri 2 desktop application for installed coding-agent CLIs.
The frontend is React 19 + TypeScript and the backend is Rust.

## Structure

- `src/lib/`: domain and application logic
- `src/lib/harness/`: provider adapters and wire protocols
- `src/chrome/`: application chrome and reusable controls
- `src/surfaces/`: main views and editor surfaces
- `src/hooks/`: React hooks
- `tests/unit/`: TypeScript logic tests, mirrored from `src/`
- `src-tauri/src/`: Rust backend

## Required checks

Run `pnpm check` before every pull request. It runs oxlint, oxfmt, TypeScript checks, Vitest, the Vite build, rustfmt, Clippy, and Rust tests.

Use oxlint and oxfmt rather than ESLint or a Prettier script. Tests use the Node environment and should test extracted logic; do not add jsdom or React Testing Library without a separate architecture decision.

For shared state, use the existing `useSyncExternalStore` pattern rather than adding Zustand, Jotai, Redux, or another state-management package.
