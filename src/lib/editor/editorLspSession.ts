/**
 * The handle an editor view holds on its language server document.
 *
 * A CodeMirror view is built synchronously; acquiring the document is a round
 * trip through the Rust host. The view therefore gets a reference that is
 * empty at first and filled once the server is ready, and every language
 * server extension reads through it. Before it fills — and after a server
 * fails or stops — the extensions do nothing and the editor behaves exactly as
 * it does without language server support.
 */

import type { DocumentHandle } from "../lsp/manager";

export type LspSessionRef = { current: DocumentHandle | null };

export function newLspSessionRef(): LspSessionRef {
  return { current: null };
}
