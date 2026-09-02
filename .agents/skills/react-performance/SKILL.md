---
name: react-performance
description: Review or improve React and TypeScript performance in wavex's Vite/Tauri client. Use for slow transcripts, streaming updates, large file/session lists, expensive rendering, bundle growth, event-listener churn, or repeated derived work; excludes Next.js, SSR, and server-component advice.
---

# React performance in wavex

Optimize measured or structurally obvious hot paths. wavex is a long-lived
desktop client with streaming transcripts, large repositories, terminals, and
several external stores; it is not a Next.js application.

## Priority order

1. **Bound work:** window or defer long lists, preserve the existing transcript
   `content-visibility` strategy, and avoid scanning full histories on each
   render or token.
2. **Narrow subscriptions:** subscribe to the smallest stable external-store
   snapshot needed by a component. Do not duplicate the same global listener in
   every row.
3. **Move work out of render:** cache expensive parsing/indexing at the owning
   module, derive simple values during render, and avoid effect-driven derived
   state.
4. **Stabilize hot updates:** use functional state updates and refs for transient
   high-frequency values when rendering them is unnecessary.
5. **Parallelize independent I/O:** start independent Tauri/provider requests
   together, while preserving cancellation and error semantics.
6. **Control the bundle:** dynamically load genuinely heavy optional surfaces.
   Import application icons through `src/chrome/icons.tsx`, whose upstream
   Hugeicons imports are intentionally deep.

## Rules of judgment

- Do not add `memo`, `useMemo`, or `useCallback` reflexively. Use them when they
  avoid meaningful work or stabilize a dependency/child boundary.
- Do not replace a clear multi-pass transformation with a complex loop unless
  profiling or input size justifies it.
- Clean up global listeners, observers, timers, PTY subscriptions, and async
  callbacks. Account for React Strict Mode in development.
- Use passive listeners only when `preventDefault()` is not needed.
- Keep effect dependencies primitive and honest; move user-triggered behavior
  into the event handler that caused it.
- Existing domain barrels, especially the generic harness surface, are
  architectural boundaries. Do not bypass them for a theoretical micro-gain.
- Ignore RSC, hydration, server action, SWR, and API-route recommendations.

## Review output

For each finding, state the hot path, why work repeats or grows, expected impact,
and the smallest safe change. Prefer a focused test or timing measurement before
and after. Run the relevant Vitest file and `pnpm run check:web`; use
`pnpm check` before a pull request.
