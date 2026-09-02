---
name: react-composition
description: Design or refactor reusable React component APIs in wavex. Use when a public component has combinatorial modes, prop drilling, duplicated chrome, unclear ownership, or needs a compound/context-based interface; do not load for routine local state.
---

# React composition in wavex

Use composition to simplify a demonstrated interface problem, not to impose a
component-library architecture on ordinary application code.

## Defaults

- Reuse primitives in `src/chrome/` before adding another modal, popover, menu,
  tab shell, icon wrapper, or surface control.
- Keep one-off feature composition close to its surface. Extract only when the
  interface becomes clearer or reuse is real.
- A boolean that represents actual state (`busy`, `selected`, `disabled`,
  `focused`) is fine. Replace booleans only when independent mode flags create
  invalid combinations or a hard-to-understand public API.
- Prefer explicit variants for genuinely different behavior, not for every
  visual state.
- Use children for layout composition. Use render callbacks only when the child
  needs state or actions controlled by the parent.
- Use context for a cohesive subtree with several cooperating parts. Do not use
  it to hide unrelated global state or avoid a small number of clear props.
- Keep transient interaction state local. Use the repository's existing
  `useSyncExternalStore` pattern for shared external state; do not add a state
  library.

## React 19

The repository uses React 19, but existing ref and context patterns remain valid.
Do not mechanically replace `forwardRef`, `useContext`, or stable component APIs
because a newer API exists. Change them only when the local interface improves
and the installed React version supports the replacement.

## Procedure

1. Write down the states and actions consumers actually need.
2. Identify invalid combinations and ownership boundaries.
3. Compare the smallest alternatives: plain props, explicit variants,
   children, lifted state, or a compound component with context.
4. Preserve keyboard behavior, focus, ARIA relationships, and portal/layer
   semantics from the existing primitive.
5. Keep styling in the established Tailwind/token vocabulary.
6. Extract pure state or normalization logic for tests under the mirrored
   `tests/unit/` path.

The best refactor should reduce consumer knowledge without making a simple
component harder to trace.
