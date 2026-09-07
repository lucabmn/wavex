/**
 * Server prose, flattened to text.
 *
 * Hover contents, completion documentation, and signature documentation all
 * arrive as any of three shapes. wavex renders them as plain text: the content
 * is arbitrary Markdown from the project's own dependencies, and no tooltip is
 * worth an HTML sanitiser in the surface that shows a file an agent may just
 * have written.
 */

import type { LspMarkedString, LspMarkupContent } from "./types";

export function markupText(value: string | LspMarkupContent | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : value.value;
}

export function markedText(value: LspMarkedString): string {
  return typeof value === "string" ? value : value.value;
}
