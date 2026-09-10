import { type WorkspaceTab } from "./layout";
import { filterTabsForProject, workspaceTabCwd } from "./workspaceTabGroups";
import type { Session } from "../session";

/**
 * The tabs the strip shows, keyed on the project of the tab that is active
 * rather than on the project the rail is pointing at. The two can disagree —
 * focusing a session from the inbox, search, or an approval moves the active
 * tab without moving the project — and a strip keyed on the project would then
 * list another project's tabs with none of them marked active.
 */
export function deckTabsForActive({
  tabs,
  sessions,
  activeTabId,
  projectCwd,
}: {
  tabs: WorkspaceTab[];
  sessions: Session[];
  activeTabId: string | null;
  projectCwd: string;
}): WorkspaceTab[] {
  const active = tabs.find((tab) => tab.id === activeTabId);
  const cwd = active ? workspaceTabCwd(active, sessions) : null;
  // A projectless session belongs to no project, so it stands on its own
  // rather than trailing the last project's tabs.
  if (active && !cwd) return [active];
  return filterTabsForProject(tabs, sessions, cwd ?? projectCwd);
}
