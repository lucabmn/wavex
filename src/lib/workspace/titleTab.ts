import { basename } from "../fs";
import { projectName } from "../paths";
import {
  focusedFileTab,
  isFilesystemTab,
  isTerminalTab,
  leafIds,
  type FilePaneTab,
  type WorkspaceTab,
} from "./layout";
import { sessionDisplayTitle, sessionNeedsInput, type HarnessId, type Session } from "../session";
import { terminalTabLabel } from "../terminal/terminalTab";
import { releaseNotesTitle } from "../updates/releaseNotes";

/** What the title bar needs in order to draw one workspace tab. */
export type TitleTab = {
  id: string;
  /** Project folder name, e.g. `agent-terminal`. */
  project: string;
  /** Focused conversation title; empty for a fresh session. */
  title: string;
  /** Other conversation titles in this tab, focused session omitted. */
  more: string[];
  sessionCount: number;
  harnesses: HarnessId[];
  /** Harnesses with an in-flight turn in this tab. */
  busyHarnesses: HarnessId[];
  /** Open file basenames, active files first. */
  files: string[];
  /** Split layout with more than one pane in this tab. */
  multiPane?: boolean;
  /** Focus is on a file/terminal pane rather than a conversation pane. */
  fileFocused?: boolean;
  /** Explicit tab group; absent means ungrouped. */
  groupId?: string;
  dirty?: boolean;
  terminal?: boolean;
};

export function conversationTitle(session: Session): string {
  const title = sessionDisplayTitle(session.title, session.harness);
  return title === "New session" ? "" : title;
}

export function isBlankSession(session: Session | undefined): boolean {
  if (!session || session.busy) return false;
  return !session.blocks.some((block) => block.role === "user");
}

export function isBlankWorkspaceTab(tab: WorkspaceTab, sessions: Session[]): boolean {
  if (tab.editorPanes.some((pane) => pane.files.length > 0)) return false;
  if ((tab.terminalPanes ?? []).some((pane) => pane.files.length > 0)) return false;
  const ids = leafIds(tab.layout);
  if (ids.length !== 1) return false;
  return isBlankSession(sessions.find((entry) => entry.id === ids[0]));
}

export function openSessionIds(tabs: WorkspaceTab[]): Set<string> {
  const ids = new Set<string>();
  for (const tab of tabs) {
    for (const id of leafIds(tab.layout)) ids.add(id);
  }
  return ids;
}

export function titleTabsEqual(a: TitleTab[], b: TitleTab[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tab, index) => {
    const other = b[index];
    return (
      other != null &&
      tab.id === other.id &&
      tab.project === other.project &&
      tab.title === other.title &&
      tab.sessionCount === other.sessionCount &&
      tab.dirty === other.dirty &&
      tab.more.join("\u0000") === other.more.join("\u0000") &&
      tab.harnesses.join("\u0000") === other.harnesses.join("\u0000") &&
      tab.busyHarnesses.join("\u0000") === other.busyHarnesses.join("\u0000") &&
      tab.files.join("\u0000") === other.files.join("\u0000") &&
      tab.multiPane === other.multiPane &&
      tab.fileFocused === other.fileFocused &&
      tab.terminal === other.terminal &&
      tab.groupId === other.groupId
    );
  });
}

export function toTitleTab(
  tab: WorkspaceTab,
  sessions: Session[],
  dirtyFiles: Set<string>,
): TitleTab {
  const paneIds = leafIds(tab.layout);
  const multiPane = paneIds.length > 1;
  const tabSessions = paneIds
    .map((id) => sessions.find((session) => session.id === id))
    .filter((session): session is Session => session != null);
  const sessionFocused = tabSessions.some((session) => session.id === tab.focusedId);
  const fileFocused =
    !sessionFocused &&
    (tab.editorPanes.some((pane) => pane.id === tab.focusedId) ||
      (tab.terminalPanes ?? []).some((pane) => pane.id === tab.focusedId));
  const focused = sessions.find((session) => session.id === tab.focusedId) ?? tabSessions[0];

  const seen = new Set<HarnessId>();
  const harnesses: HarnessId[] = [];
  const busySeen = new Set<HarnessId>();
  const busyHarnesses: HarnessId[] = [];
  const ordered = focused
    ? [focused, ...tabSessions.filter((session) => session.id !== focused.id)]
    : tabSessions;
  for (const session of ordered) {
    if (session.busy && !sessionNeedsInput(session) && !busySeen.has(session.harness)) {
      busySeen.add(session.harness);
      busyHarnesses.push(session.harness);
    }
    if (seen.has(session.harness)) continue;
    seen.add(session.harness);
    harnesses.push(session.harness);
  }

  const files: string[] = [];
  const seenKeys = new Set<string>();
  const pushFile = (file: FilePaneTab) => {
    const key = file.terminal
      ? `terminal:${file.id}`
      : file.plan
        ? `plan:${file.plan.blockId}`
        : file.releaseNotes
          ? `release-notes:${file.releaseNotes.version}`
          : file.path;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    files.push(
      file.plan?.title?.trim() ||
        (file.releaseNotes
          ? releaseNotesTitle(file.releaseNotes.version)
          : file.terminal
            ? terminalTabLabel(file)
            : basename(file.path)),
    );
  };
  const focusedPane =
    tab.editorPanes.find((pane) => pane.id === tab.focusedId) ??
    (tab.terminalPanes ?? []).find((pane) => pane.id === tab.focusedId);
  const otherPanes = [
    ...tab.editorPanes.filter((pane) => pane.id !== focusedPane?.id),
    ...(tab.terminalPanes ?? []).filter((pane) => pane.id !== focusedPane?.id),
  ];
  const panes = focusedPane ? [focusedPane, ...otherPanes] : otherPanes;
  for (const pane of panes) {
    const active = pane.files.find((file) => file.id === pane.activeFileId);
    if (active) pushFile(active);
  }
  for (const pane of panes) {
    for (const file of pane.files) pushFile(file);
  }

  const more = tabSessions
    .filter((session) => session.id !== focused?.id)
    .map(conversationTitle)
    .filter(Boolean);

  const hasTerminal = (tab.terminalPanes ?? []).some((pane) => pane.files.some(isTerminalTab));
  const focusedFile = focusedFileTab(tab);

  return {
    id: tab.id,
    project: focused ? projectName(focused.cwd) : focusedFile ? projectName(focusedFile.cwd) : "~",
    title: focused ? conversationTitle(focused) : "",
    more,
    sessionCount: tabSessions.length,
    harnesses,
    busyHarnesses,
    files,
    multiPane,
    fileFocused,
    dirty: tab.editorPanes.some((pane) =>
      pane.files.some((file) => isFilesystemTab(file) && dirtyFiles.has(file.id)),
    ),
    terminal: hasTerminal && harnesses.length === 0,
    groupId: tab.groupId,
  };
}
