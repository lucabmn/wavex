/**
 * Which surface the window is showing. Workspace is the project workspace —
 * tabs, panes, file tree, source control, terminals. Chat is a plain chat
 * surface with none of that.
 *
 * The mode is workspace presentation, not session state: a chat exists
 * whether or not the window is currently showing it.
 */

export type AppMode = "coding" | "work";

export const DEFAULT_APP_MODE: AppMode = "coding";

export const APP_MODE_LABEL: Record<AppMode, string> = {
  coding: "Workspace",
  work: "Chat",
};

export const APP_MODE_DESCRIPTION: Record<AppMode, string> = {
  coding: "Project workspace — tabs, panes, files, source control, terminals",
  work: "Plain chat — no project, files, or terminals",
};

/**
 * Anything unrecognised reads as coding. Snapshots written before work chats
 * existed have no mode at all, and they must still open the workspace.
 */
export function sanitizeAppMode(raw: unknown): AppMode {
  return raw === "work" ? "work" : DEFAULT_APP_MODE;
}

export function otherAppMode(mode: AppMode): AppMode {
  return mode === "work" ? "coding" : "work";
}
