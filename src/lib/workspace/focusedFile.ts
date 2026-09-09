/**
 * The file the editor is on, published for code that cannot reach the workspace
 * tree. Prompt preparation runs from a submit handler rather than a component,
 * so it has no props to read the focused pane from, and threading one path
 * through every surface between App and the composer would be a wide change for
 * a single string.
 */
let focusedPath: string | null = null;

export function setFocusedEditorPath(path: string | null): void {
  focusedPath = path;
}

export function peekFocusedEditorPath(): string | null {
  return focusedPath;
}
