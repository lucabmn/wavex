---
name: harness-adapters
description: Add, change, or debug a wavex coding-agent CLI integration. Use for provider adapters, wire protocols, executable discovery, model catalogs, approvals, questions, streaming events, session resume, or harness lifecycle behavior.
---

# Harness adapters

A harness converts one provider CLI into wavex's generic session and event
model. Provider differences belong at this boundary, not in `App.tsx`, chrome,
or shared session logic.

## Read first

- `src/lib/session.ts` for provider and session vocabulary
- `src/lib/harness/types.ts` for generic events and turn inputs
- `src/lib/harness/registry.ts` for the adapter contract and lifecycle
- `src/lib/harness/register.ts` for builtin registration
- an existing protocol/adapter pair closest to the provider being changed
- matching tests under `tests/unit/lib/harness/`
- `src-tauri/src/harness.rs` only when process or transport support must change

## Design rules

- Parse provider wire data in pure protocol helpers where possible.
- Translate provider events once into generic `HarnessEvent` values.
- Keep provider session IDs distinct from wavex session/thread IDs.
- Route consumers through the registry; never add provider switches throughout
  the UI.
- The registry's public barrel is deliberate even though direct imports can be
  preferable elsewhere.
- Keep the Rust host generic: spawn, write, kill, HTTP, SSE, and executable
  resolution. Provider product behavior stays in TypeScript.
- Normalize optional capabilities through adapter methods: steering, approvals,
  user questions, title/commit/PR/branch generation, and model refresh.
- Preserve stop versus forget semantics. Stop parks a child while keeping resume
  state; forget drops resume state and kills the child.
- Preserve cleanup on cancellation, window destruction, quit, and idle park.

## Adding a provider

Walk every applicable layer:

1. Add the `HarnessId` vocabulary and user-facing title/icon assets.
2. Add executable discovery in the generic host only if existing discovery
   cannot represent the CLI.
3. Implement sanitized protocol parsing and adapter registration.
4. Map model IDs and availability through the shared catalog surface.
5. Handle streaming, completion, failures, cancellation, resume, approvals, and
   questions supported by the CLI.
6. Add focused protocol and lifecycle tests using sanitized fixtures.
7. Update provider documentation and distribution verification when the CLI or
   asset is part of the shipped surface.

## Tests

Test malformed frames, unknown event variants, partial streams, duplicate or
late terminal events, missing session IDs, and cancellation where applicable.
Avoid tests that merely assert callback wiring. Never commit real prompts,
tokens, home paths, or provider account data as fixtures.
