/**
 * Positions on both sides of the protocol.
 *
 * A language server counts lines from zero and characters in UTF-16 code
 * units; CodeMirror counts lines from one and addresses text by offset.
 * JavaScript strings are UTF-16, so a character index maps straight onto a
 * within-line offset — which is exactly why the client negotiates the UTF-16
 * encoding and refuses to guess when a server answers with another one.
 */

import type { Text } from "@codemirror/state";
import type { LspPosition, LspRange } from "./types";

/** Document offset for a protocol position, clamped into the document. */
export function positionToOffset(doc: Text, position: LspPosition): number {
  const lineNumber = Math.min(Math.max(1, position.line + 1), doc.lines);
  const line = doc.line(lineNumber);
  const character = Math.max(0, position.character);
  return Math.min(line.from + character, line.to);
}

/** Protocol position for a document offset, clamped into the document. */
export function offsetToPosition(doc: Text, offset: number): LspPosition {
  const clamped = Math.min(Math.max(0, offset), doc.length);
  const line = doc.lineAt(clamped);
  return { line: line.number - 1, character: clamped - line.from };
}

/** Offsets for a protocol range, ordered so `from` never exceeds `to`. */
export function rangeToOffsets(doc: Text, range: LspRange): { from: number; to: number } {
  const start = positionToOffset(doc, range.start);
  const end = positionToOffset(doc, range.end);
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

/**
 * A protocol position as the 1-based line and column the workspace uses.
 *
 * Every surface that opens a server result — a definition, a reference, a
 * symbol — goes through here, so the off-by-one lives in one place.
 */
export function positionToLineColumn(position: LspPosition): { line: number; column: number } {
  return { line: position.line + 1, column: position.character + 1 };
}
