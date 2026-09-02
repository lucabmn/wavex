import {
  captureSessionCheckpoint,
  notifyReviewChanged,
  syncSessionCheckpoint,
} from "../checkpoint";
import { invalidateProjectFiles } from "../files/fileIndex";
import { notifyDirsChanged } from "../files/fileTree";
import { nudgeWatchedFiles } from "../files/fileWatch";
import { notifyGitChanged } from "../fs";
import { isEditTool } from "../harness/preview";
import type { HarnessEvent } from "../harness";
import { resolveWorkspacePath } from "../paths";
import {
  firstLeafId,
  isFilesystemTab,
  removePane,
  siblingLeafId,
  type EditorPane,
  type WorkspaceTab,
} from "./layout";

export function dropOpenFiles(
  tab: WorkspaceTab,
  shouldDrop: (path: string) => boolean,
): WorkspaceTab {
  let layout = tab.layout;
  let focusedId = tab.focusedId;
  const editorPanes: EditorPane[] = [];
  for (const pane of tab.editorPanes) {
    const files = pane.files.filter((file) => !isFilesystemTab(file) || !shouldDrop(file.path));
    if (files.length === 0) {
      const sibling = siblingLeafId(layout, pane.id);
      const withoutPane = removePane(layout, pane.id);
      if (withoutPane) {
        layout = withoutPane;
        if (focusedId === pane.id) focusedId = sibling ?? firstLeafId(withoutPane);
      }
      continue;
    }
    editorPanes.push({
      ...pane,
      files,
      activeFileId: files.some((file) => file.id === pane.activeFileId)
        ? pane.activeFileId
        : files[0].id,
    });
  }
  return { ...tab, layout, focusedId, editorPanes };
}

export function trackSessionEdits(sessionId: string, cwd: string, event: HarnessEvent) {
  if (event.type !== "tool.updated") return;
  const completed = event.status === "completed" || event.status === "success";
  if (!completed) return;
  const kind = event.kind?.trim().toLowerCase();
  if (kind === "execute" || event.preview?.kind === "shell") {
    void syncSessionCheckpoint(sessionId, cwd)
      .catch(() => undefined)
      .then(() => notifyReviewChanged(sessionId));
    return;
  }
  if (!isEditTool(event.kind, event.title, event.preview)) return;
  const path = event.preview?.path;
  if (path && cwd !== "~") {
    void captureSessionCheckpoint(sessionId, cwd, [path])
      .catch(() => undefined)
      .then(() => notifyReviewChanged(sessionId));
    return;
  }
  notifyReviewChanged(sessionId);
}

export function nudgeWorkspace(cwd?: string) {
  invalidateProjectFiles(cwd);
  notifyDirsChanged();
}

export function nudgeOpenEditors(event: HarnessEvent, cwd: string) {
  if (event.type !== "tool.updated") return;
  const completed = event.status === "completed" || event.status === "success";

  const kind = event.kind?.trim().toLowerCase();
  if (kind === "execute" || event.preview?.kind === "shell") {
    if (!completed) return;
    nudgeWatchedFiles();
    window.setTimeout(() => nudgeWatchedFiles(), 150);
    notifyGitChanged();
    nudgeWorkspace(cwd);
    window.setTimeout(() => nudgeWorkspace(cwd), 150);
    return;
  }

  if (!isEditTool(event.kind, event.title, event.preview)) return;
  const raw = event.preview?.path;
  const resolved = raw ? (resolveWorkspacePath(raw, cwd) ?? raw) : undefined;
  if (resolved) {
    nudgeWatchedFiles([resolved]);
  } else if (completed) {
    nudgeWatchedFiles();
  }
  if (completed) {
    window.setTimeout(() => nudgeWatchedFiles(), 150);
    notifyGitChanged();
    nudgeWorkspace(cwd);
  }
}
