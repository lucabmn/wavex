import type { HarnessId } from "../session";

/**
 * What went wrong in a harness turn, in words the user can act on.
 *
 * Tauri rejects a command with the raw payload it returned, so a Rust
 * `Err(String)` arrives here as a bare string rather than an `Error`. Testing
 * only for `Error` dropped every host failure — a CLI that would not start, a
 * missing working directory, a child that died before the first write — and
 * left them all reading as the same unexplained "adapter failed".
 */
export function harnessErrorMessage(error: unknown, harness: HarnessId): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return `${harness} adapter failed`;
}
