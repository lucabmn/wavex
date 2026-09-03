import { leafIds, newTab, type WorkspaceTab } from "./workspace/layout";
import type { ProjectTerminalDock } from "./terminal/projectTerminal";
import type { AppMode } from "./workspace/appMode";
import { sessionNeedsInput, type Session } from "./session";
import { stopStreaming } from "./harness/apply";

export const INTERRUPT_MESSAGE = "Turn interrupted when wavex quit.";

/**
 * The turn was not cut: the agent kept working while the user was in another
 * profile. wavex could not render it — the adapter holding the turn died with
 * the profile switch — so the transcript stops here and Continue picks the
 * thread up from the provider's own session.
 */
export const KEPT_RUNNING_MESSAGE =
  "Kept running in the background while you were in another profile.";

/** The notes that end a turn wavex stopped following. */
const CUT_MESSAGES: readonly string[] = [INTERRUPT_MESSAGE, KEPT_RUNNING_MESSAGE];

export const CONTINUE_PROMPT = "Continue from where you left off.";

export type InFlightRef = {
  sessionId: string;
  cwd: string;
};

export type ResumedWorkspace = {
  sessions: Session[];
  tabs: WorkspaceTab[];
  activeTabId: string;
  projectCwd: string;
  projectTerminals?: ProjectTerminalDock[];
  /** Top-level surface to restore. Absent on a pre-Work snapshot. */
  mode?: AppMode;
};

/** A turn or approval that would be lost if this webview died. */
export function isInFlightSession(session: Session): boolean {
  return !!session.busy || sessionNeedsInput(session);
}

export function hasInFlightSessions(sessions: Session[]): boolean {
  return sessions.some(isInFlightSession);
}

/**
 * Busy chats in tab order, then parked ones still running after their tab closed.
 * Only persistable sessions can come back after a real quit.
 */
export function inFlightRefs(sessions: Session[], tabs: WorkspaceTab[]): InFlightRef[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const seen = new Set<string>();
  const refs: InFlightRef[] = [];

  const push = (session: Session | undefined) => {
    if (!session || seen.has(session.id)) return;
    if (!isInFlightSession(session) || !canResumeAfterQuit(session)) return;
    seen.add(session.id);
    refs.push({ sessionId: session.id, cwd: session.cwd });
  };

  for (const tab of tabs) {
    for (const id of leafIds(tab.layout)) push(byId.get(id));
  }
  for (const session of sessions) push(session);
  return refs;
}

export function profileSwitchWhileBusyMessage(count: number): string {
  if (count === 1) {
    return "1 chat is still running in this profile.";
  }
  return `${count} chats are still running in this profile.`;
}

export function quitWhileBusyMessage(count: number): string {
  if (count === 1) {
    return "1 chat is still running. Quit anyway? It will resume when you reopen wavex.";
  }
  return `${count} chats are still running. Quit anyway? They will resume when you reopen wavex.`;
}

/**
 * Seal streams/tools and record that a real quit cut the turn short.
 * Idempotent for the current turn only — a later turn after Continue still
 * gets a fresh note. Matching any interrupt in the transcript would skip
 * resume on the second quit.
 */
export function markTurnInterrupted(session: Session): Session {
  return sealTurn(session, INTERRUPT_MESSAGE);
}

/**
 * Same seal, different truth: the child was left alive across a profile
 * switch and kept going. Continue resumes the provider thread the work
 * actually landed in.
 */
export function markTurnKeptRunning(session: Session): Session {
  return sealTurn(session, KEPT_RUNNING_MESSAGE);
}

function sealTurn(session: Session, note: string): Session {
  const sealed = { ...sealOpenWork(stopStreaming(session)), busy: false };
  if (lastBlockIsCut(sealed)) return sealed;
  return {
    ...sealed,
    blocks: [
      ...sealed.blocks,
      {
        id: crypto.randomUUID(),
        role: "system",
        text: note,
      },
    ],
  };
}

export function workspaceFromResumed(sessions: Session[]): ResumedWorkspace | null {
  if (sessions.length === 0) return null;
  const tabs = sessions.map((session) => newTab(session.id));
  return {
    sessions,
    tabs,
    activeTabId: tabs[0].id,
    projectCwd: sessions[0].cwd,
  };
}

export function wasTurnInterrupted(session: Session): boolean {
  return lastBlockIsCut(session);
}

/**
 * Provider thread exists and the quit note is still the last block.
 * A Continue (or any later user turn) appends after it, so this stays one-shot.
 */
export function canAutoContinue(session: Session): boolean {
  return !!session.providerSessionId && !session.busy && lastBlockIsCut(session);
}

function lastBlockIsCut(session: Session): boolean {
  const last = session.blocks[session.blocks.length - 1];
  return last?.role === "system" && CUT_MESSAGES.includes(last.text ?? "");
}

export function inFlightSnapshotKey(refs: InFlightRef[]): string {
  return refs.map((ref) => ref.sessionId).join("\n");
}

/**
 * Skip the first idle paint after boot so a restored snapshot is not wiped
 * before the turn is marked busy again. Once this process has seen a live
 * in-flight chat, an empty list is a real "turn finished" and should clear.
 */
export function shouldWriteInFlightSnapshot(
  key: string,
  refs: InFlightRef[],
  previousKey: string | null,
  sawInFlight: boolean,
): boolean {
  if (previousKey === key) return false;
  if (refs.length === 0 && !sawInFlight) return false;
  return true;
}

function canResumeAfterQuit(session: Session): boolean {
  return session.cwd !== "~" && session.blocks.some((block) => block.role === "user");
}

function sealOpenWork(session: Session): Session {
  return {
    ...session,
    busy: false,
    blocks: session.blocks.flatMap((block) => {
      if (block.role === "approval" && !block.approval?.decided) return [];
      if (!shouldCancelTool(block)) return [block];
      const { approval, ...rest } = block;
      return [
        {
          ...rest,
          streaming: false,
          tool: block.tool ? { ...block.tool, status: "cancelled" } : block.tool,
          ...(approval?.decided ? { approval } : {}),
        },
      ];
    }),
  };
}

function shouldCancelTool(block: Session["blocks"][number]): boolean {
  if (block.approval && !block.approval.decided) return true;
  if (!block.tool) return false;
  if (block.streaming) return true;
  const status = block.tool.status?.toLowerCase() ?? "";
  return status === "in_progress" || status === "pending" || status === "running";
}
