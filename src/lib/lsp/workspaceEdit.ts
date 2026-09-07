/**
 * Applying a server's edits to text.
 *
 * A rename comes back as edits against files, not as a new document. The
 * ranges all address the file as it is on disk now, so they are applied from
 * the end backwards: an edit earlier in the file would otherwise shift every
 * range after it.
 */

import { Text } from "@codemirror/state";
import { rangeToOffsets } from "./positions";
import type { LspTextEdit, LspWorkspaceEdit } from "./types";
import { uriToPath } from "./uri";

/**
 * Whether a workspace edit also creates, renames, or deletes files.
 *
 * rust-analyzer answers a module rename this way. wavex applies text edits and
 * nothing else, so an edit carrying one of these has to be refused rather than
 * partly applied — dropping the file operation would rename every reference to
 * a module whose file never moved.
 */
export function hasResourceOperations(edit: LspWorkspaceEdit | null): boolean {
  return (edit?.documentChanges ?? []).some((change) => "kind" in change);
}

/** The edits of a workspace edit, grouped by file path. */
export function workspaceEditFiles(edit: LspWorkspaceEdit | null): Map<string, LspTextEdit[]> {
  const files = new Map<string, LspTextEdit[]>();
  if (!edit) return files;

  const add = (uri: string, edits: LspTextEdit[] | undefined) => {
    const path = uriToPath(uri);
    if (!path || !edits?.length) return;
    files.set(path, [...(files.get(path) ?? []), ...edits]);
  };

  // `documentChanges` is the versioned form and wins where a server sends both.
  if (edit.documentChanges?.length) {
    for (const change of edit.documentChanges) {
      if (change.textDocument?.uri) add(change.textDocument.uri, change.edits);
    }
    return files;
  }
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) add(uri, edits);
  return files;
}

/** `source` with `edits` applied. Overlapping edits are refused, not guessed. */
export function applyTextEdits(source: string, edits: LspTextEdit[]): string | null {
  if (edits.length === 0) return source;
  const doc = Text.of(source.split("\n"));
  const resolved = edits
    .map((edit) => ({ ...rangeToOffsets(doc, edit.range), text: edit.newText }))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  for (let index = 1; index < resolved.length; index += 1) {
    if (resolved[index].from < resolved[index - 1].to) return null;
  }

  let result = source;
  for (let index = resolved.length - 1; index >= 0; index -= 1) {
    const edit = resolved[index];
    result = result.slice(0, edit.from) + edit.text + result.slice(edit.to);
  }
  return result;
}
