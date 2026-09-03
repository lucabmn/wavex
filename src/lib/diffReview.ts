import type { DiffViewRow } from "./unifiedDiffWindow";

/** One keystroke of the mouse-free review flow over a unified diff. */
export type DiffReviewCommand =
  | "next-hunk"
  | "prev-hunk"
  | "next-file"
  | "prev-file"
  | "stage"
  | "stage-file"
  | "unstage"
  | "discard"
  | "toggle";

/** A hunk header inside one file's flattened rows, with its offset in that body. */
export type DiffHunkTarget = {
  rowIndex: number;
  offset: number;
  pos?: number;
};

/** Where the review cursor sits: a file, and a hunk inside it. */
export type DiffReviewCursor = {
  fileIndex: number;
  hunkIndex: number;
};

const TYPING_SELECTOR =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], .cm-editor, .wavex-terminal, [data-composer], [data-app-search], [data-command-palette], [data-model-picker], [data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker]";

/**
 * Bare letters drive this flow, so anywhere the user could be typing has to win
 * the key. That includes the pickers, which float above the diff.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  if (!element || typeof element.closest !== "function") return false;
  return !!element.closest(TYPING_SELECTOR);
}

/**
 * `s` stages the hunk under the cursor where hunk staging exists and the whole
 * file otherwise; `S` always means the file. `d` is destructive and the caller
 * confirms it.
 */
export function diffReviewCommand(event: KeyboardEvent): DiffReviewCommand | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return null;
  if (event.defaultPrevented) return null;
  if (isTypingTarget(event.target)) return null;
  switch (event.key) {
    case "j":
      return "next-hunk";
    case "k":
      return "prev-hunk";
    case "n":
      return "next-file";
    case "p":
      return "prev-file";
    case "s":
      return "stage";
    case "S":
      return "stage-file";
    case "u":
      return "unstage";
    case "d":
      return "discard";
    case "Enter":
      return "toggle";
    default:
      return null;
  }
}

/** Hunk headers in render order, each with its pixel offset inside the body. */
export function hunkTargets(rows: readonly DiffViewRow[]): DiffHunkTarget[] {
  const targets: DiffHunkTarget[] = [];
  let offset = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.type === "line" && row.line.kind === "hunk") {
      targets.push({
        rowIndex: index,
        offset,
        ...(row.line.pos != null ? { pos: row.line.pos } : {}),
      });
    }
    offset += row.height;
  }
  return targets;
}

/** Clamp rather than wrap: review runs top to bottom, and wrapping loses the place. */
export function stepIndex(count: number, current: number, delta: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, current + delta));
}

/**
 * Move the cursor. A hunk step that runs off the end of a file carries into the
 * next one, so `j` walks the whole review without a second key.
 */
export function moveCursor(
  cursor: DiffReviewCursor,
  hunkCounts: readonly number[],
  command: "next-hunk" | "prev-hunk" | "next-file" | "prev-file",
): DiffReviewCursor {
  const files = hunkCounts.length;
  if (files === 0) return { fileIndex: 0, hunkIndex: 0 };
  const fileIndex = Math.min(files - 1, Math.max(0, cursor.fileIndex));
  const hunks = hunkCounts[fileIndex] ?? 0;
  const hunkIndex = Math.min(Math.max(0, hunks - 1), Math.max(0, cursor.hunkIndex));

  if (command === "next-file" || command === "prev-file") {
    return {
      fileIndex: stepIndex(files, fileIndex, command === "next-file" ? 1 : -1),
      hunkIndex: 0,
    };
  }

  if (command === "next-hunk") {
    if (hunkIndex + 1 < hunks) return { fileIndex, hunkIndex: hunkIndex + 1 };
    for (let next = fileIndex + 1; next < files; next += 1) {
      if (hunkCounts[next] > 0) return { fileIndex: next, hunkIndex: 0 };
    }
    return { fileIndex, hunkIndex };
  }

  if (hunkIndex > 0) return { fileIndex, hunkIndex: hunkIndex - 1 };
  for (let prev = fileIndex - 1; prev >= 0; prev -= 1) {
    if (hunkCounts[prev] > 0) return { fileIndex: prev, hunkIndex: hunkCounts[prev] - 1 };
  }
  return { fileIndex, hunkIndex };
}
