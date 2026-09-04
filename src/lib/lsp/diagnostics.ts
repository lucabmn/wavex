/**
 * Server diagnostics, keyed by file.
 *
 * `textDocument/publishDiagnostics` arrives whenever the server feels like it
 * — after a keystroke, after a build, after indexing finishes — so the results
 * live in one external store the editor and the tab strip both read, rather
 * than in the component that happened to ask.
 */

import { pathKey } from "../paths";
import type { LspDiagnostic } from "./types";

type Entry = { path: string; diagnostics: LspDiagnostic[] };

const byPath = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

const EMPTY: LspDiagnostic[] = [];

export function publishDiagnostics(path: string, diagnostics: LspDiagnostic[]): void {
  const key = pathKey(path);
  const previous = byPath.get(key);
  if (previous && sameDiagnostics(previous.diagnostics, diagnostics)) return;
  // An empty list is still an answer, and it is stored as one. "The server says
  // this file is clean" and "no server has looked at this file" have to stay
  // distinguishable, or a clean file would fall back to syntax diagnostics.
  byPath.set(key, { path, diagnostics });
  notify(key);
}

/** Whether a server has answered for this file at all. */
export function hasPublishedDiagnostics(path: string): boolean {
  return byPath.has(pathKey(path));
}

/** A file whose last editor closed: its diagnostics are no longer authoritative. */
export function clearDiagnosticsFor(path: string): void {
  const key = pathKey(path);
  if (!byPath.delete(key)) return;
  notify(key);
}

export function diagnosticsFor(path: string): LspDiagnostic[] {
  return byPath.get(pathKey(path))?.diagnostics ?? EMPTY;
}

export function subscribeDiagnostics(path: string, listener: () => void): () => void {
  const key = pathKey(path);
  const set = listeners.get(key) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/** Nothing survives a profile switch: another profile's servers own the files. */
export function resetDiagnostics(): void {
  const keys = [...byPath.keys()];
  byPath.clear();
  for (const key of keys) {
    for (const listener of listeners.get(key) ?? []) listener();
  }
}

function notify(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

/**
 * Servers republish an unchanged list on every save and on every build. A
 * cheap identity check keeps that from repainting the editor decoration.
 */
function sameDiagnostics(before: LspDiagnostic[], after: LspDiagnostic[]): boolean {
  if (before.length !== after.length) return false;
  return before.every((diagnostic, index) => {
    const other = after[index];
    return (
      diagnostic.message === other.message &&
      diagnostic.severity === other.severity &&
      diagnostic.range.start.line === other.range.start.line &&
      diagnostic.range.start.character === other.range.start.character &&
      diagnostic.range.end.line === other.range.end.line &&
      diagnostic.range.end.character === other.range.end.character
    );
  });
}
