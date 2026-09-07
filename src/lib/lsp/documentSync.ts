/**
 * Turning a CodeMirror change set into `textDocument/didChange` content
 * changes.
 *
 * A server applies content changes in array order, each range addressing the
 * document as the previous change left it. CodeMirror reports every change of
 * a transaction against the document before any of them, so the changes go out
 * last-to-first: an edit later in the document cannot move the offsets of one
 * before it.
 */

import type { ChangeSet, Text } from "@codemirror/state";
import { offsetToPosition } from "./positions";
import type { LspContentChange } from "./types";

/**
 * Past this, a batch of small ranges costs more to serialise and apply than
 * the whole document. A find-and-replace across a large file lands here.
 */
const MAX_INCREMENTAL_CHANGES = 128;

export function incrementalChanges(before: Text, changes: ChangeSet): LspContentChange[] {
  const edits: LspContentChange[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    edits.push({
      range: { start: offsetToPosition(before, fromA), end: offsetToPosition(before, toA) },
      text: inserted.toString(),
    });
  });
  if (edits.length === 0 || edits.length > MAX_INCREMENTAL_CHANGES) return [];
  return edits.reverse();
}

export function fullChange(text: string): LspContentChange[] {
  return [{ text }];
}

/**
 * Content changes for one document update.
 *
 * `syncKind` is what the server advertised: 2 is incremental, 1 is full text,
 * and 0 means the server tracks nothing and wants no notification at all.
 */
export function contentChangesFor(
  syncKind: 0 | 1 | 2,
  before: Text,
  after: Text,
  changes: ChangeSet,
): LspContentChange[] {
  if (syncKind === 0) return [];
  if (syncKind === 1) return fullChange(after.toString());
  const incremental = incrementalChanges(before, changes);
  // A change set too large to send as ranges still has to reach the server, or
  // its copy of the document silently drifts from the buffer.
  return incremental.length > 0 ? incremental : fullChange(after.toString());
}
