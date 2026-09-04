/**
 * Planning a rename before any file is written.
 *
 * A rename edits files across the project, and the edits address them as they
 * are on disk. The whole plan is built in memory first: a file with unsaved
 * changes, or an edit that no longer applies, stops the rename before a single
 * write, rather than leaving the project half renamed.
 */

import { basename } from "../fs";
import { pathKey } from "../paths";
import type { LspWorkspaceEdit } from "./types";
import { applyTextEdits, hasResourceOperations, workspaceEditFiles } from "./workspaceEdit";

export type RenamePlan =
  | { ok: true; files: Array<{ path: string; text: string }> }
  | { ok: false; reason: string };

/**
 * The files a rename would rewrite, with their new contents.
 *
 * `readFile` resolves to `null` for a file that cannot be read, which stops the
 * plan the same way an unappliable edit does.
 */
export async function planRename(
  symbol: string,
  edit: LspWorkspaceEdit | null,
  dirtyPaths: ReadonlySet<string>,
  readFile: (path: string) => Promise<string | null>,
): Promise<RenamePlan> {
  if (hasResourceOperations(edit)) {
    return {
      ok: false,
      reason: `Renaming ${symbol} would also move or delete files, which wavex can’t do yet`,
    };
  }

  const byFile = workspaceEditFiles(edit);
  if (byFile.size === 0) return { ok: true, files: [] };

  const blocked = [...byFile.keys()].filter((path) => dirtyPaths.has(pathKey(path)));
  if (blocked.length > 0) {
    const names = blocked.map((path) => basename(path)).join(", ");
    return { ok: false, reason: `Save ${names} before renaming ${symbol}` };
  }

  const files: Array<{ path: string; text: string }> = [];
  for (const [path, edits] of byFile) {
    const source = await readFile(path);
    const next = source === null ? null : applyTextEdits(source, edits);
    if (next === null)
      return { ok: false, reason: `Couldn’t rename ${symbol} in ${basename(path)}` };
    if (next !== source) files.push({ path, text: next });
  }
  return { ok: true, files };
}
