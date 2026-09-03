import { invoke } from "@tauri-apps/api/core";
import type { ApprovalDecision } from "./harness";
import { IS_MAC } from "./platform";
import type { LiveAgent } from "./liveAgents";

export const MENU_BAR_AGENTS_CHANGED = "menu_bar_agents_changed";
export const MENU_BAR_FOCUS_SESSION = "focus_session_from_menu_bar";
export const MENU_BAR_ANSWER_APPROVAL = "answer_approval_from_menu_bar";

/** An approval answered in the popover, routed back to the window that owns it. */
export type MenuBarApprovalAnswer = {
  sessionId: string;
  requestId: number;
  decision: ApprovalDecision;
};

let lastSnapshot = "";

/** Publish only meaningful row changes, not every streamed transcript token. */
export function publishMenuBarAgents(agents: LiveAgent[]): void {
  if (!IS_MAC) return;
  const snapshot = JSON.stringify(agents);
  if (snapshot === lastSnapshot) return;
  lastSnapshot = snapshot;
  void invoke("menu_bar_update_agents", { agents }).catch(() => {
    // The menu-bar integration is optional at runtime; the main app must keep
    // working if the native status item could not be installed.
  });
}

/** Sessions blocked on the user, newest request last, in the popover's order. */
export function pendingApprovalAgents(agents: LiveAgent[]): LiveAgent[] {
  return agents.filter((agent) => agent.approval != null);
}

export function workingAgents(agents: LiveAgent[]): LiveAgent[] {
  return agents.filter((agent) => agent.approval == null);
}

/** Identity of one request, stable across republished snapshots. */
export function approvalKey(agent: LiveAgent): string {
  return `${agent.id}:${agent.approval?.requestId ?? "none"}`;
}

/** The popover header's one-line state. Mirrors the tray tooltip's wording. */
export function menuBarStatusLabel(agents: LiveAgent[]): string {
  const waiting = pendingApprovalAgents(agents).length;
  if (waiting > 0) return waiting === 1 ? "1 needs you" : `${waiting} need you`;
  const working = agents.filter((agent) => !agent.done).length;
  return working > 0 ? `${working} working` : "All quiet";
}

/**
 * Answer in the window that owns the session. Resolves false when no window
 * claims it any more — a transferred or closed session can only be answered by
 * opening it.
 */
export async function answerMenuBarApproval(
  agent: LiveAgent,
  decision: ApprovalDecision,
): Promise<boolean> {
  const approval = agent.approval;
  if (!approval) return false;
  try {
    await invoke("menu_bar_answer_approval", {
      sessionId: agent.id,
      requestId: approval.requestId,
      decision,
    });
    return true;
  } catch {
    return false;
  }
}

export function focusMenuBarAgent(sessionId: string): void {
  void invoke("menu_bar_focus_agent", { sessionId }).catch(() => {});
}
