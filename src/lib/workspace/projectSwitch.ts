import { focusedFileTab, type WorkspaceTab } from "./layout";
import { isBlankSession } from "./titleTab";
import { findTabForProject } from "./workspaceTabGroups";
import type { HostId } from "../host";
import { sameProjectPath } from "../recents";
import type { Session } from "../session";
import { compareSessionSummaries } from "../sessions/sessionHistory";
import type { SessionSummary } from "../sessions/sessionStore";

export type ProjectSwitchPlan =
  | { kind: "stay" }
  | { kind: "focusTab"; tabId: string }
  | { kind: "openSession"; sessionId: string; hostId: HostId }
  | { kind: "retargetBlank"; sessionId: string }
  | { kind: "createSession" };

/**
 * The session a project switch should land on: what the sidebar puts at the
 * top of its list, which is pinned first and most recently used after that.
 * Archived rows are excluded because the list hides them by default, so
 * landing on one would open a conversation the user cannot see.
 */
export function topProjectSession(
  rows: SessionSummary[],
  path: string,
): SessionSummary | undefined {
  return rows
    .filter((row) => !row.archived && sameProjectPath(row.cwd, path))
    .sort(compareSessionSummaries)[0];
}

/**
 * Decide where switching to `path` should land. A project that already has
 * work — an open tab, or a persisted conversation — is entered at that work;
 * a new session is created only for a project that has none, so switching
 * projects does not leave a trail of empty tabs behind.
 */
export function planProjectSwitch({
  tabs,
  sessions,
  activeTabId,
  rows,
  path,
}: {
  tabs: WorkspaceTab[];
  sessions: Session[];
  activeTabId: string | null;
  rows: SessionSummary[];
  path: string;
}): ProjectSwitchPlan {
  const activeWorkspace = tabs.find((entry) => entry.id === activeTabId);
  const current = activeWorkspace
    ? sessions.find((session) => session.id === activeWorkspace.focusedId)
    : undefined;
  const currentCwd =
    current?.cwd ?? (activeWorkspace ? focusedFileTab(activeWorkspace)?.cwd : undefined);
  if (currentCwd && sameProjectPath(currentCwd, path)) return { kind: "stay" };

  const match = findTabForProject(tabs, sessions, path);
  if (match) return { kind: "focusTab", tabId: match.id };

  // A persisted conversation outranks retargeting the blank session in hand:
  // the blank one is reused as the pane that conversation opens into, so
  // nothing is stranded either way.
  const top = topProjectSession(rows, path);
  if (top) return { kind: "openSession", sessionId: top.id, hostId: top.hostId };

  if (current && isBlankSession(current)) return { kind: "retargetBlank", sessionId: current.id };

  return { kind: "createSession" };
}
