/**
 * Server answers about "where", flattened into one shape the workspace can
 * open.
 *
 * `textDocument/definition` alone may answer with a single location, a list of
 * them, or a list of location links — and every one of those carries a URI the
 * tab strip cannot use. Normalising once here keeps the `file://` boundary and
 * the shape juggling out of the surfaces.
 */

import { positionToLineColumn } from "./positions";
import type { LspLocation, LspLocationLink, LspRange } from "./types";
import { uriToPath } from "./uri";

export type CodeTarget = {
  path: string;
  line: number;
  column: number;
  /** Full range of the symbol, for previewing the result. */
  range: LspRange;
};

export function toCodeTargets(
  answer: LspLocation | LspLocation[] | LspLocationLink[] | null,
): CodeTarget[] {
  if (!answer) return [];
  const list = Array.isArray(answer) ? answer : [answer];
  const targets: CodeTarget[] = [];
  for (const entry of list) {
    const target = toCodeTarget(entry);
    if (target) targets.push(target);
  }
  return targets;
}

function toCodeTarget(entry: LspLocation | LspLocationLink): CodeTarget | null {
  const uri = "uri" in entry ? entry.uri : entry.targetUri;
  const path = uriToPath(uri);
  if (!path) return null;
  // A link's selection range is the symbol itself; its target range is the
  // whole declaration, which would put the cursor on the doc comment.
  const range = "uri" in entry ? entry.range : (entry.targetSelectionRange ?? entry.targetRange);
  return { path, ...positionToLineColumn(range.start), range };
}
