import { leafIds, type WorkspaceTab } from "./workspace/layout";
import type { Block, Session } from "./session";
import { toolCallLabel } from "../surfaces/transcriptActivity";

export type PendingApprovalNotice = {
  sessionId: string;
  requestId: number;
  label: string;
  kind: "approval" | "question";
  block?: Block;
};

/**
 * Every undecided request in a session, in transcript order. A clarifying
 * question parks the whole turn, so it is the only outstanding request while
 * it lasts.
 */
export function pendingApprovalsForSession(session: Session): PendingApprovalNotice[] {
  if (session.pendingQuestion) {
    return [
      {
        sessionId: session.id,
        requestId: session.pendingQuestion.requestId,
        label:
          session.pendingQuestion.title ||
          session.pendingQuestion.questions[0]?.prompt ||
          "Question",
        kind: "question",
      },
    ];
  }
  return session.blocks.flatMap((block) => {
    const approval = block.approval;
    if (!approval || approval.decided) return [];
    return [
      {
        sessionId: session.id,
        requestId: approval.requestId,
        label: toolCallLabel(block, session.cwd),
        kind: "approval" as const,
        block,
      },
    ];
  });
}

/** Latest undecided approval or clarifying question in a session, if any. */
export function pendingApprovalForSession(session: Session): PendingApprovalNotice | null {
  const pending = pendingApprovalsForSession(session);
  return pending[pending.length - 1] ?? null;
}

/** True when the conversation pane for this session is focused and active. */
export function isSessionConversationFocused(
  sessionId: string,
  activeTabId: string,
  tabs: WorkspaceTab[],
  composerFocused: boolean,
): boolean {
  const tab = tabs.find((entry) => entry.id === activeTabId);
  if (!tab) return false;
  if (!leafIds(tab.layout).includes(sessionId)) return false;
  if (tab.focusedId !== sessionId) return false;
  return composerFocused;
}

export function hiddenApprovalNotices(
  sessions: Session[],
  activeTabId: string,
  tabs: WorkspaceTab[],
  composerFocused: boolean,
): Array<PendingApprovalNotice & { session: Session }> {
  const notices: Array<PendingApprovalNotice & { session: Session }> = [];
  for (const session of sessions) {
    const pending = pendingApprovalForSession(session);
    if (!pending) continue;
    if (isSessionConversationFocused(session.id, activeTabId, tabs, composerFocused)) {
      continue;
    }
    notices.push({ ...pending, session });
  }
  return notices;
}
