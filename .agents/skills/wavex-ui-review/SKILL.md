---
name: wavex-ui-review
description: Review wavex React UI for desktop UX, accessibility, keyboard behavior, visual consistency, responsive window sizing, and rendering cost. Use when asked to review UI/UX, accessibility, chrome, dialogs, menus, surfaces, or a visual change.
---

# wavex UI review

Review wavex as a macOS desktop application rendered in a Tauri WebView, not as
a generic marketing website.

## Read before reviewing

- the requested component or surface;
- the reusable primitive it builds on in `src/chrome/`;
- relevant tokens, glass styles, layers, and reduced-motion rules in
  `src/index.css`;
- matching extracted logic or server-rendered markup tests under `tests/unit/`.

Do not fetch a moving external checklist. Do not launch browser/computer-use
verification unless the user asks.

## Checklist

### Interaction and accessibility

- Native buttons and inputs are used when possible.
- Icon-only actions have concise accessible names and decorative icons are
  hidden from assistive technology.
- Dialogs are named, modal, Escape-closeable, focus intentionally on open, and
  restore or preserve a sensible focus path on close.
- Menus, tabs, listboxes, radio groups, switches, and splitters expose matching
  roles, state, and keyboard behavior.
- Hover-only actions remain discoverable by keyboard and focus styles are
  visible.
- Live streaming status uses restrained `aria-live`; token-by-token updates must
  not spam announcements.

### Desktop behavior

- The control works at the minimum configured window size (800 × 520), not only
  at the default 1280 × 800.
- Drag regions do not swallow interactive controls.
- Popovers, menus, selection toolbars, and dialogs use the shared layer and
  portal conventions instead of arbitrary z-index values.
- Scrolling, overscroll locking, text selection, terminal input, editor focus,
  and global shortcuts do not conflict.
- Destructive Git, file, session, and worktree actions communicate scope and
  preserve a cancel path.

### Visual system

- Reuse custom primitives and Tailwind 4 theme tokens; wavex is not a shadcn
  project.
- Import icons from `src/chrome/icons.tsx` and match the established stroke and
  sizing conventions.
- Check dark, light, transparent/glass, active, hover, focus, disabled, loading,
  empty, and error states that apply.
- Respect `prefers-reduced-motion` and avoid continuously repainting decoration.
- Keep dense desktop chrome compact without making targets or text illegible.

### Performance

- Long transcripts, sessions, files, issues, and worktrees do not render or
  recompute without a bound.
- Streaming updates do not cause the full app or hidden surfaces to rerender.
- Global listeners, observers, and timers are deduplicated and cleaned up.

## Output

Report findings by severity with `path:line`, the user impact, and the smallest
fix. Separate verified defects from suggestions. If no issues are found, state
what was reviewed and any verification not performed.
