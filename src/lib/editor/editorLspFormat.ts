/**
 * Formatting on save, through the server where the project has one.
 *
 * The server is asked first because it formats with the project's own
 * configuration — rustfmt's `rustfmt.toml`, gofmt, the TypeScript server's
 * settings. Prettier stays the fallback for everything else, and for a server
 * that declines to format the file.
 */

import { isCancelled } from "../lsp/connection";
import { applyTextEdits } from "../lsp/workspaceEdit";
import type { LspSessionRef } from "./editorLspSession";

export type FormatOptions = { tabSize: number; insertSpaces: boolean };

/**
 * The formatted document, or `null` when the server cannot or will not format
 * it — in which case the caller falls through to Prettier.
 */
export async function formatWithServer(
  path: string,
  session: LspSessionRef,
  source: string,
  options: FormatOptions,
): Promise<string | null> {
  const client = session.current?.client;
  if (!client?.canFormat) return null;

  let edits;
  try {
    edits = await client.formatting(path, options);
  } catch (error) {
    if (isCancelled(error)) return null;
    throw error;
  }
  if (!edits?.length) return null;

  const formatted = applyTextEdits(source, edits);
  // Overlapping edits mean the server's answer no longer matches this text —
  // usually because the document changed under an in-flight request.
  return formatted === source ? null : formatted;
}
