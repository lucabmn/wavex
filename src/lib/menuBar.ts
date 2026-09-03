import { invoke } from "@tauri-apps/api/core";
import type { ApprovalDecision } from "./harness";
import type { LiveAgent, LiveApproval } from "./liveAgents";

export const MENU_BAR_AGENTS_CHANGED = "menu_bar_agents_changed";
export const MENU_BAR_FOCUS_SESSION = "focus_session_from_menu_bar";
export const MENU_BAR_ANSWER_APPROVAL = "answer_approval_from_menu_bar";
export const ACTIVITY_STOP_SESSION = "stop_session_from_activity";

/** An approval answered in the popover, routed back to the window that owns it. */
export type MenuBarApprovalAnswer = {
  sessionId: string;
  requestId: number;
  decision: ApprovalDecision;
};

/** One outstanding request, with the session it belongs to. */
export type MenuBarRequest = {
  agent: LiveAgent;
  approval: LiveApproval;
};

let lastSnapshot = "";

/**
 * Publish only meaningful row changes, not every streamed transcript token.
 *
 * Not macOS-only any more: the native store is what makes the list
 * cross-window, and the Activity surface reads it on every platform. The tray
 * icon it also feeds simply does not exist off macOS.
 */
export function publishMenuBarAgents(agents: LiveAgent[]): void {
  const snapshot = JSON.stringify(agents);
  if (snapshot === lastSnapshot) return;
  lastSnapshot = snapshot;
  void invoke("menu_bar_update_agents", { agents }).catch(() => {
    // The menu-bar integration is optional at runtime; the main app must keep
    // working if the native status item could not be installed.
  });
}

/** Everything blocked on the user, in the order the agents asked. */
export function pendingRequests(agents: LiveAgent[]): MenuBarRequest[] {
  return agents.flatMap((agent) =>
    (agent.approvals ?? []).map((approval) => ({ agent, approval })),
  );
}

/** Sessions that are not blocked on the user: they only need a way back in. */
export function unblockedAgents(agents: LiveAgent[]): LiveAgent[] {
  return agents.filter((agent) => !agent.approvals?.length);
}

/** Identity of one request, so a session moving on remounts its card. */
export function requestKey(request: MenuBarRequest): string {
  return `${request.agent.id}:${request.approval.requestId}`;
}

/** The popover header's one-line state, waiting requests ahead of busy ones. */
export function menuBarStatusLabel(agents: LiveAgent[]): string {
  const waiting = pendingRequests(agents).length;
  if (waiting > 0) return waiting === 1 ? "1 needs you" : `${waiting} need you`;
  const working = agents.filter((agent) => !agent.done).length;
  return working > 0 ? `${working} working` : "All quiet";
}

/**
 * Answer in the window that owns the session. Resolves false when the host
 * would not route it — no window claims the session any more — in which case
 * opening it is the only honest answer left.
 */
export async function answerMenuBarApproval(
  request: MenuBarRequest,
  decision: ApprovalDecision,
): Promise<boolean> {
  try {
    await invoke("menu_bar_answer_approval", {
      sessionId: request.agent.id,
      requestId: request.approval.requestId,
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

/**
 * Stop a turn from Activity. Resolves false when no window claims the session
 * any more, which is the only case where the row cannot be acted on.
 */
export async function stopMenuBarAgent(sessionId: string): Promise<boolean> {
  try {
    await invoke("menu_bar_stop_agent", { sessionId });
    return true;
  } catch {
    return false;
  }
}
