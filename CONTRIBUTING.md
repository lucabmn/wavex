# Contributing

## Prerequisites

- Node.js 22 or newer
- pnpm 11
- Rust stable
- Your platform's native toolchain: the Xcode Command Line Tools on macOS, the
  MSVC build tools and WebView2 on Windows, or the WebKitGTK development
  packages on Linux (`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev
libxdo-dev patchelf`)

## Setup

```sh
pnpm install
pnpm tauri dev
```

Run `pnpm check` before opening a pull request. It runs the formatter, linter, TypeScript checks, tests, Vite build, and Rust checks.

Keep commits and pull requests small and focused. Use clear imperative commit messages and avoid mixing unrelated changes.
