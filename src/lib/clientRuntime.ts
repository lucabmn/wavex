/**
 * What the machine drawing this window can do for itself.
 *
 * The desktop app runs inside a WebView that carries Tauri's IPC bridge; a
 * browser tab served by a host carries nothing. Everything that reaches this
 * client's own operating system — the Dock badge, vibrancy, the menu bar
 * popover, window transfer, the updater, native dialogs, profile switching —
 * exists only in the first case, and must be absent in the second rather than
 * failing halfway through a render.
 *
 * This is deliberately not `platform.ts`: that answers "which operating
 * system", which both clients can. This answers "is there a native shell
 * behind this document at all".
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

/**
 * A document with no Tauri bridge: a browser tab talking to a host it did not
 * install.
 *
 * Read once. The bridge is injected before the document's first script runs
 * and never appears later, so a value that could change mid-session would only
 * invite call sites to re-check something that cannot move.
 *
 * Code running with no document at all is not a browser client — that is
 * Vitest, which runs in Node and exercises the desktop's paths. Testing for
 * the browser rather than for Tauri is what keeps those tests describing the
 * client they are about.
 */
export const IS_BROWSER_CLIENT: boolean =
  typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__ === "undefined";

/** This client has a native shell behind the document it draws into. */
export const IS_TAURI = !IS_BROWSER_CLIENT;

/** Thrown by the local transport for work only a native shell can do. */
export class LocalOnlyError extends Error {
  constructor(what: string) {
    super(`${what} needs the wavex app on this machine.`);
    this.name = "LocalOnlyError";
  }
}

export function isLocalOnlyError(error: unknown): boolean {
  return error instanceof LocalOnlyError;
}
