/**
 * Turning one due occurrence into one session.
 *
 * A run is an ordinary session: the same reducer, the same harness registry,
 * the same SQLite store. That is the whole point — a scheduled turn has to be
 * as inspectable afterwards as one somebody typed, with the same transcript,
 * the same tool rows, and the same failure text.
 *
 * It also inherits the harness's normal permission behaviour. Nothing here
 * raises the runtime mode: a run that stops on an approval settles as
 * `needs-attention` and waits for a person, because silently approving
 * filesystem, Git, and process actions on a timer is the one thing a scheduler
 * must not do.
 */

import { isLocalHostId, isRemoteHostId } from "../host";
import { connectionSnapshot } from "../transport";
import { listDir } from "../fs";
import {
  appendUser,
  applyHarnessEvent,
  harnessErrorMessage,
  hasProbedHarnessAvailability,
  harnessUnavailableHint,
  isHarnessAvailable,
  isLiveHarness,
  sendHarnessTurn,
  stopStreaming,
  type HarnessEvent,
} from "../harness";
import { preferredModelSettings, resolveModel } from "../models";
import { formatSessionTitle, sessionNeedsInput, type Session } from "../session";
import { upsertSession } from "../sessions/sessionStore";
import type { Automation, RunStatus } from "./automation";

export type RunResult = {
  status: RunStatus;
  sessionId?: string;
  error?: string;
  summary?: string;
};

/** Enough of the last answer to scan a history row without opening it. */
const SUMMARY_MAX = 400;

/** A failure that happened before a session existed, so there is none to open. */
function preflightFailure(error: string): RunResult {
  return { status: "failed", error };
}

/**
 * Everything that has to be true before an agent is started. Each of these
 * fails visibly and changes nothing: a missing checkout is recorded as a
 * failed run and left exactly as it was, never repaired, reset, or recreated.
 */
async function preflight(automation: Automation): Promise<string | null> {
  if (isRemoteHostId(automation.hostId)) {
    const host = connectionSnapshot(automation.hostId);
    if (host.phase !== "connected") {
      return `${host.name} is not connected, so this run could not start.`;
    }
  }
  if (!isLiveHarness(automation.harness)) {
    return `${automation.harness} cannot run a scheduled task.`;
  }
  if (
    isLocalHostId(automation.hostId) &&
    hasProbedHarnessAvailability() &&
    !isHarnessAvailable(automation.harness)
  ) {
    return harnessUnavailableHint(automation.harness);
  }
  // `resolveModel` substitutes when it cannot find the one asked for, which is
  // right for a person watching a picker and wrong for a timer: the run would
  // quietly use another model and nothing would say so.
  if (
    automation.model &&
    resolveModel(automation.harness, automation.model).id !== automation.model
  ) {
    return `${automation.model} is not available from ${automation.harness} any more. Pick another model for this automation.`;
  }
  try {
    await listDir(automation.cwd, automation.hostId);
  } catch {
    return `${automation.cwd} is not there any more, so this run could not start.`;
  }
  return null;
}

function summarize(session: Session): string | undefined {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.role !== "assistant") continue;
    const text = block.text.trim();
    if (!text) continue;
    return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX).trimEnd()}…` : text;
  }
  return undefined;
}

export type RunHooks = {
  /** Called once the session exists, so the run row can point at it. */
  onSession?: (session: Session) => void;
  /** Called as the transcript grows, for a live "running" row. */
  onProgress?: (session: Session) => void;
};

/**
 * Run one occurrence and report what happened to it.
 *
 * Never throws: every outcome — including the ones that happen before a
 * session exists — is a row in the run history, because an automation whose
 * failures are invisible is worse than one that does not run.
 */
export async function executeAutomationRun(
  automation: Automation,
  hooks: RunHooks = {},
): Promise<RunResult> {
  const blocked = await preflight(automation);
  if (blocked) return preflightFailure(blocked);

  const resolved = resolveModel(automation.harness, automation.model || undefined);
  let session: Session = appendUser(
    {
      id: crypto.randomUUID(),
      harness: automation.harness,
      model: resolved.id,
      modelSettings: preferredModelSettings(resolved),
      runtimeMode: automation.runtimeMode,
      title: formatSessionTitle(automation.harness, automation.name),
      cwd: automation.cwd,
      hostId: automation.hostId,
      blocks: [],
    },
    automation.prompt,
  );
  const sessionId = session.id;
  hooks.onSession?.(session);
  // Persisted before the turn so the run is inspectable while it is going,
  // not only once it ends.
  await upsertSession(session, automation.hostId).catch(() => undefined);

  let failure: string | null = null;
  try {
    await sendHarnessTurn({
      harness: automation.harness,
      sessionId,
      hostId: automation.hostId,
      cwd: automation.cwd,
      model: resolved.id,
      modelSettings: session.modelSettings,
      runtimeMode: automation.runtimeMode,
      text: automation.prompt,
      onEvent: (event: HarnessEvent) => {
        if (event.type === "session.error") failure = event.message;
        session = applyHarnessEvent(session, event);
        hooks.onProgress?.(session);
      },
    });
  } catch (error: unknown) {
    failure = harnessErrorMessage(error, automation.harness);
  }

  session = stopStreaming(session);
  hooks.onProgress?.(session);
  await upsertSession(session, automation.hostId).catch(() => undefined);

  if (failure) return { status: "failed", sessionId, error: failure };
  // An unanswered approval or question is not a failure; it is a run waiting
  // for a person, and it says so rather than being counted against the
  // automation's failure streak.
  if (sessionNeedsInput(session)) {
    return {
      status: "needs-attention",
      sessionId,
      error: "This run stopped to ask for permission.",
    };
  }
  const summary = summarize(session);
  return { status: "success", sessionId, ...(summary ? { summary } : {}) };
}
