import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  bindHarnessSession,
  forgetHarnessSession,
  isLiveHarness,
  killAllChildren,
} from "./harness";
import {
  hasInFlightSessions,
  inFlightRefs,
  isInFlightSession,
  markTurnInterrupted,
  markTurnKeptRunning,
  quitWhileBusyMessage,
  wasTurnInterrupted,
  workspaceFromResumed,
  type ResumedWorkspace,
} from "./inFlight";
import { leafIds, type WorkspaceTab } from "./workspace/layout";
import { killPty } from "./terminal/pty";
import { projectTerminalFileIds, type ProjectTerminalDock } from "./terminal/projectTerminal";
import { sessionWorkCwd, type Session } from "./session";
import { restoreSessionCheckout } from "./fs";
import { sessionChildHarnesses } from "./handoff";
import {
  getSession,
  listInFlightSessions,
  listSessionsByProject,
  loadWorkspaceSnapshot,
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
  shouldPersistSession,
  upsertSession,
  type SessionSummary,
} from "./sessions/sessionStore";
import { getWorkChatState } from "./sessions/workChatStore";
import { isWorkChat } from "./sessions/workChats";
import type { AppMode } from "./workspace/appMode";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
  parseWorkspaceSnapshot,
} from "./workspace/workspaceSnapshot";
import { loadWindowTransfer } from "./windowTransferBootstrap";
import type { WindowTransferPayload } from "./windowTransfer";
import { lastProjectPath, normalizeProjectPath, sameProjectPath } from "./recents";

export type { ResumedWorkspace };
export { hasInFlightSessions };

/**
 * `unload` is a webview reload that must not wipe a restored snapshot.
 * `switch-keep` is a profile switch whose agents were left running, which is a
 * quit for this webview but not for the children it started.
 */
export type PersistMode = "quit" | "unload" | "switch-keep";

export type BootWorkspace = {
  windowTransfer: WindowTransferPayload | null;
  resumed: ResumedWorkspace | null;
  /** Sidebar rows listed before first paint, so the rail is not empty. */
  history: SessionSummary[];
  historyCwd: string | null;
};

let resumedPromise: Promise<ResumedWorkspace | null> | null = null;
let bootPromise: Promise<BootWorkspace> | null = null;
let quitting = false;
let switchingProfile = false;
let quitDialogOpen = false;
let bootingResumed: ResumedWorkspace | null = null;
let liveWorkspace: {
  sessions: () => Session[];
  tabs: () => WorkspaceTab[];
  activeTabId: () => string;
  projectCwd: () => string;
  projectTerminals: () => ProjectTerminalDock[];
  appMode: () => AppMode;
  flush: () => void;
} | null = null;

export function isAppQuitting(): boolean {
  return quitting;
}

/**
 * True once this window has handed its workspace to the profile it is leaving.
 * The native stores swap under it from that moment, so nothing may persist
 * again until the reload lands.
 */
export function isProfileSwitching(): boolean {
  return switchingProfile;
}

export function beginProfileSwitch() {
  switchingProfile = true;
}

export function setQuitWorkspace(
  sessions: () => Session[],
  tabs: () => WorkspaceTab[],
  activeTabId: () => string,
  projectCwd: () => string,
  projectTerminals: () => ProjectTerminalDock[],
  flush: () => void,
  appMode: () => AppMode = () => "coding",
): () => void {
  liveWorkspace = {
    sessions,
    tabs,
    activeTabId,
    projectCwd,
    projectTerminals,
    appMode,
    flush,
  };
  bootingResumed = null;
  return () => {
    if (liveWorkspace?.sessions === sessions) liveWorkspace = null;
  };
}

export async function handleQuitRequested(): Promise<void> {
  if (liveWorkspace) {
    liveWorkspace.flush();
    await confirmQuitAndExit(
      liveWorkspace.sessions(),
      liveWorkspace.tabs(),
      liveWorkspace.activeTabId(),
      liveWorkspace.projectCwd(),
      liveWorkspace.projectTerminals(),
      liveWorkspace.appMode(),
    );
    return;
  }
  const { resumed } = await loadBootWorkspace();
  const pending = resumed ?? bootingResumed;
  if (pending) {
    quitting = true;
    try {
      await persistBootingResume(pending);
      await invoke("confirm_quit");
    } catch {
      quitting = false;
    }
    return;
  }
  await invoke("confirm_quit");
}

export function loadResumedWorkspace(): Promise<ResumedWorkspace | null> {
  if (!resumedPromise) resumedPromise = loadResumedWorkspaceOnce();
  return resumedPromise;
}

/** Transfer and restore run once; callers share the same promise. */
export function loadBootWorkspace(): Promise<BootWorkspace> {
  if (!bootPromise) {
    bootPromise = (async () => {
      const hintedCwd = lastProjectPath();
      const historyHint = listProjectHistory(hintedCwd);
      const windowTransfer = await loadWindowTransfer();
      if (windowTransfer) {
        const listed = await historyForCwd(windowTransfer.projectCwd, hintedCwd, historyHint);
        return {
          windowTransfer,
          resumed: null,
          history: listed?.rows ?? [],
          historyCwd: listed?.cwd ?? null,
        };
      }
      const [resumed, hinted] = await Promise.all([loadResumedWorkspace(), historyHint]);
      const listed = await historyForCwd(
        resumed?.projectCwd ?? hintedCwd,
        hintedCwd,
        Promise.resolve(hinted),
      );
      return {
        windowTransfer: null,
        resumed,
        history: listed?.rows ?? [],
        historyCwd: listed?.cwd ?? null,
      };
    })();
  }
  return bootPromise;
}

async function listProjectHistory(
  cwd: string | null | undefined,
): Promise<{ cwd: string; rows: SessionSummary[] } | null> {
  if (!cwd || cwd === "~") return null;
  try {
    const rows = await listSessionsByProject(cwd);
    return { cwd: normalizeProjectPath(cwd), rows };
  } catch {
    return null;
  }
}

async function historyForCwd(
  cwd: string | null | undefined,
  hintedCwd: string | null | undefined,
  hinted: Promise<{ cwd: string; rows: SessionSummary[] } | null>,
): Promise<{ cwd: string; rows: SessionSummary[] } | null> {
  if (!cwd || cwd === "~") return null;
  if (hintedCwd && sameProjectPath(cwd, hintedCwd)) return hinted;
  return listProjectHistory(cwd);
}

async function loadResumedWorkspaceOnce(): Promise<ResumedWorkspace | null> {
  const [snapshotRaw, refs] = await Promise.all([
    loadWorkspaceSnapshot().catch(() => null),
    listInFlightSessions().catch(() => []),
  ]);
  const interrupted = new Set(refs.map((ref) => ref.sessionId));
  const snapshot = parseWorkspaceSnapshot(snapshotRaw);

  const ids = new Set<string>();
  if (snapshot) {
    for (const stub of snapshot.sessions) ids.add(stub.id);
    for (const tab of snapshot.tabs) {
      for (const id of leafIds(tab.layout)) ids.add(id);
    }
  }
  for (const ref of refs) ids.add(ref.sessionId);

  const loaded = new Map<string, Session>();
  await Promise.all(
    [...ids].map(async (id) => {
      const record = await getSession(id).catch(() => null);
      // A work chat has no tab. If a stale row ever names one, restoring it
      // here would open a coding tab on the chat's scratch directory.
      if (record && !isWorkChat(record)) loaded.set(id, record);
    }),
  );

  let workspace = snapshot ? hydrateWorkspaceSnapshot(snapshot, loaded, interrupted) : null;
  if (!workspace && refs.length > 0) {
    const sessions: Session[] = [];
    for (const ref of refs) {
      const record = loaded.get(ref.sessionId);
      if (!record) continue;
      sessions.push(markTurnInterrupted(record));
    }
    workspace = workspaceFromResumed(sessions);
  }

  if (workspace) {
    workspace = {
      ...workspace,
      sessions: await Promise.all(
        workspace.sessions.map((session) => restoreSessionCheckout(session)),
      ),
    };
  }

  bootingResumed = workspace;
  if (workspace) {
    await Promise.all(
      workspace.sessions
        .filter(shouldPersistSession)
        .map((session) => upsertSession(session).catch(() => null)),
    );
  }
  return workspace;
}

export function bindResumedSessions(sessions: Session[]): void {
  for (const session of sessions) {
    if (!session.providerSessionId || !isLiveHarness(session.harness)) continue;
    bindHarnessSession(
      session.harness,
      session.id,
      session.providerSessionId,
      sessionWorkCwd(session),
    );
  }
}

export async function hideCurrentWindow(): Promise<void> {
  await invoke("hide_window");
}

export async function closeCurrentWindow(): Promise<void> {
  await invoke("destroy_window");
}

export async function persistLiveTranscripts(sessions: Session[]): Promise<void> {
  await Promise.all(
    sessions
      .filter(shouldPersistSession)
      .map((session) => upsertSession(session).catch(() => null)),
  );
}

/**
 * Busy work chats. They live in their own store rather than in the workspace,
 * so the quit path has to ask for them: without this a chat mid-answer would
 * be lost with no warning and no note in its transcript.
 */
function inFlightWorkChats(): Session[] {
  return getWorkChatState().chats.filter(isInFlightSession);
}

export async function persistQuitState(
  sessions: Session[],
  tabs: WorkspaceTab[],
  activeTabId: string,
  projectCwd: string,
  mode: PersistMode = "quit",
  projectTerminals: ProjectTerminalDock[] = [],
  appMode: AppMode = "coding",
): Promise<void> {
  const refs = inFlightRefs(sessions, tabs);
  const interrupted = new Set(refs.map((ref) => ref.sessionId));
  const busyWorkChats = new Set(inFlightWorkChats().map((chat) => chat.id));
  // A profile switch that leaves the agents running did not cut the turn, so
  // the note in the transcript must not claim it did.
  const seal = mode === "switch-keep" ? markTurnKeptRunning : markTurnInterrupted;
  await Promise.all(
    [...sessions, ...getWorkChatState().chats].map(async (session) => {
      if (!shouldPersistSession(session)) return;
      const cut = interrupted.has(session.id) || busyWorkChats.has(session.id);
      await upsertSession(cut ? seal(session) : session).catch(() => null);
    }),
  );
  await saveWorkspaceSnapshot(
    collectWorkspaceSnapshot(tabs, sessions, activeTabId, projectCwd, projectTerminals, appMode),
  ).catch(() => undefined);
  // Work chats are deliberately absent from `refs`: that table decides which
  // tabs a restored workspace reopens, and a chat has no tab. Its interrupt
  // note is already in the transcript above.
  //
  // Vite/webview reload must not wipe a restored snapshot: those chats are idle
  // in this process until Continue runs.
  if (mode !== "unload" || refs.length > 0) {
    await replaceInFlightSessions(refs).catch(() => undefined);
  }
}

async function persistBootingResume(workspace: ResumedWorkspace): Promise<void> {
  await Promise.all(
    workspace.sessions
      .filter(shouldPersistSession)
      .map((session) => upsertSession(session).catch(() => null)),
  );
  await saveWorkspaceSnapshot(
    collectWorkspaceSnapshot(
      workspace.tabs,
      workspace.sessions,
      workspace.activeTabId,
      workspace.projectCwd,
      workspace.projectTerminals ?? [],
      workspace.mode,
    ),
  ).catch(() => undefined);
  await replaceInFlightSessions(
    workspace.sessions.filter(wasTurnInterrupted).map((session) => ({
      sessionId: session.id,
      cwd: session.cwd,
    })),
  ).catch(() => undefined);
}

async function confirmQuitAndExit(
  sessions: Session[],
  tabs: WorkspaceTab[],
  activeTabId: string,
  projectCwd: string,
  projectTerminals: ProjectTerminalDock[] = [],
  appMode: AppMode = "coding",
): Promise<void> {
  if (quitDialogOpen) return;
  quitDialogOpen = true;
  try {
    const busy = inFlightRefs(sessions, tabs).length + inFlightWorkChats().length;
    if (busy > 0) {
      const ok = await ask(quitWhileBusyMessage(busy), {
        title: "wavex",
        kind: "warning",
        okLabel: "Quit",
      });
      if (!ok) return;
    }
    quitting = true;
    try {
      await persistQuitState(
        sessions,
        tabs,
        activeTabId,
        projectCwd,
        "quit",
        projectTerminals,
        appMode,
      );
      await invoke("confirm_quit");
    } catch {
      quitting = false;
    }
  } finally {
    quitDialogOpen = false;
  }
}

export async function reapWindowRuntime(
  sessions: Session[],
  tabs: WorkspaceTab[],
  projectTerminals: ProjectTerminalDock[] = [],
): Promise<void> {
  await Promise.all(
    sessions.map((session) =>
      Promise.all(
        sessionChildHarnesses(session).map((harness) => forgetHarnessSession(harness, session.id)),
      ),
    ),
  );
  await Promise.all(
    [...terminalFileIds(tabs), ...projectTerminalFileIds(projectTerminals)].map((id) =>
      killPty(id),
    ),
  );
  // Catalog probes, title generators, and usage scrapers are not session
  // children. Drop them so an unused Pi/Codex probe cannot outlive the window.
  await killAllChildren().catch(() => undefined);
}

function terminalFileIds(tabs: WorkspaceTab[]): string[] {
  const ids: string[] = [];
  for (const tab of tabs) {
    for (const pane of [...tab.editorPanes, ...(tab.terminalPanes ?? [])]) {
      for (const file of pane.files) {
        if (file.terminal) ids.push(file.id);
      }
    }
  }
  return ids;
}
