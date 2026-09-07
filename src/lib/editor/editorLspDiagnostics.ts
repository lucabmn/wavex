/**
 * Server diagnostics inside the editor's lint field.
 *
 * They arrive on the server's schedule, not inside a transaction, so a view
 * plugin subscribes to the store for this one file and re-runs the linter when
 * the answer changes. Nothing repaints while the list stays the same, which is
 * the common case: most servers republish an identical list on every save.
 */

import { forceLinting, type Diagnostic } from "@codemirror/lint";
import type { Extension, Text } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";
import { diagnosticsFor, hasPublishedDiagnostics, subscribeDiagnostics } from "../lsp/diagnostics";
import { rangeToOffsets } from "../lsp/positions";
import type { LspDiagnostic, LspDiagnosticSeverity } from "../lsp/types";
import type { LspSessionRef } from "./editorLspSession";

const SEVERITY: Record<LspDiagnosticSeverity, Diagnostic["severity"]> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "hint",
};

/**
 * The lint source for `path`, or `null` when no server has answered for it.
 *
 * `null` is what hands the file back to the syntax diagnostics; an empty array
 * means the server looked and found nothing.
 */
export function serverDiagnosticsSource(
  path: string,
  session: LspSessionRef,
): (doc: Text) => Diagnostic[] | null {
  return (doc) => {
    if (!session.current) return null;
    if (!hasPublishedDiagnostics(path)) return null;
    return diagnosticsFor(path).map((diagnostic) => toEditorDiagnostic(doc, diagnostic));
  };
}

/** Re-lint when the server publishes a different list for this file. */
export function editorLspDiagnostics(path: string): Extension {
  return ViewPlugin.define((view: EditorView) => {
    const unsubscribe = subscribeDiagnostics(path, () => forceLinting(view));
    return { destroy: unsubscribe };
  });
}

function toEditorDiagnostic(doc: Text, diagnostic: LspDiagnostic): Diagnostic {
  const { from, to } = rangeToOffsets(doc, diagnostic.range);
  return {
    // A zero-width range renders as a marker rather than an underline. Widening
    // by one character reads as "wrong here", but never across a line break.
    ...widen(doc, from, to),
    severity: SEVERITY[diagnostic.severity ?? 1],
    source: diagnosticSource(diagnostic),
    message: diagnostic.message,
  };
}

function widen(doc: Text, from: number, to: number): { from: number; to: number } {
  if (from !== to) return { from, to };
  const line = doc.lineAt(from);
  if (to < line.to) return { from, to: to + 1 };
  if (from > line.from) return { from: from - 1, to };
  return { from, to };
}

function diagnosticSource(diagnostic: LspDiagnostic): string | undefined {
  const code = diagnostic.code === undefined ? "" : String(diagnostic.code);
  if (diagnostic.source && code) return `${diagnostic.source} ${code}`;
  return diagnostic.source ?? (code || undefined);
}
