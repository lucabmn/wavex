import type { HostId } from "../host";
import type { HarnessId } from "../session";
import type { PrContent } from "../gitText";
import { hasLiveCatalog } from "../models";
import type { UserQuestionReply } from "../userQuestion";
import type { ApprovalDecision, SendTurnInput, SteerTurnInput } from "./types";

export type TitleInput = {
  sessionId: string;
  cwd: string;
  message: string;
  hostId?: HostId;
};

/**
 * Lifecycle contract for a live harness adapter.
 * App.tsx dispatches through the registry instead of harness-specific branches.
 *
 * Which machine a call routes to is the adapter's own live state, not a
 * parameter on every method. `sendTurn` and `bindSession` carry the host and
 * record it next to the child they started; `cancelTurn`, `respondApproval`,
 * and `respondQuestion` read it back. Two reasons, both about being wrong
 * safely: the host that spawned a child is the only one that can kill it, so
 * reading it from where the child was recorded beats trusting a caller to
 * repeat it — a caller passing a different host kills nothing, or worse, kills
 * on the wrong machine. And the idle-park timer in this file fires with no
 * caller at all, so a host parameter would have to be remembered here anyway.
 */
export type HarnessAdapter = {
  id: HarnessId;
  /** True when this adapter can run live turns. */
  live: boolean;
  /** False when the harness cannot accept a follow-up while a turn is running. Default: same as live. */
  canSteer?: boolean;
  sendTurn(input: SendTurnInput): Promise<void>;
  steerTurn(input: SteerTurnInput): Promise<void>;
  cancelTurn(sessionId: string): Promise<void>;
  respondApproval(sessionId: string, requestId: number, decision: ApprovalDecision): void;
  respondQuestion?(sessionId: string, requestId: number, reply: UserQuestionReply): void;
  /**
   * Kill the child but keep resume state for later rebind. `hostId` is a
   * fallback for the one case the adapter's own state cannot answer: a child
   * still running on a host that this client has no live or resume record for.
   */
  stopSession(sessionId: string, hostId?: HostId): Promise<void>;
  /** Drop resume state and kill the child (delete, harness switch, idle detach). */
  forgetSession(sessionId: string, hostId?: HostId): Promise<void>;
  /** Seed resume state from a restored wavex session. */
  bindSession(threadId: string, providerSessionId: string, cwd: string, hostId?: HostId): void;
  /** Refresh the model catalog overlay when supported. */
  refreshCatalog?(hostId?: HostId): Promise<void>;
  /** Optional LLM tab title for the first turn. */
  generateTitle?(input: TitleInput): Promise<string | null>;
  /** Optional LLM commit message from staged changes. */
  generateCommitMessage?(cwd: string, hostId?: HostId): Promise<string>;
  /** Optional LLM pull request title/body from branch diff context. */
  generatePrContent?(
    cwd: string,
    hostId?: HostId,
  ): Promise<(PrContent & { base: string; head: string }) | null>;
  /** Optional LLM branch name from a user message. */
  generateBranchName?(cwd: string, message: string, hostId?: HostId): Promise<string | null>;
  /** Optional warmup for text-generation backends. */
  warmupText?(cwd: string, hostId?: HostId): Promise<void>;
};

const adapters = new Map<HarnessId, HarnessAdapter>();

/**
 * After a turn settles, keep the child warm for follow-ups, then park it.
 * Resume state stays, so the next prompt respawns instead of starting over.
 */
export const HARNESS_IDLE_PARK_MS = 5 * 60_000;
const idleParkTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelIdlePark(sessionId: string): void {
  const timer = idleParkTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  idleParkTimers.delete(sessionId);
}

function scheduleIdlePark(harness: HarnessId, sessionId: string): void {
  cancelIdlePark(sessionId);
  idleParkTimers.set(
    sessionId,
    setTimeout(() => {
      idleParkTimers.delete(sessionId);
      void stopHarnessSession(harness, sessionId);
    }, HARNESS_IDLE_PARK_MS),
  );
}

/** Test seam. */
export function resetHarnessIdlePark(): void {
  for (const timer of idleParkTimers.values()) clearTimeout(timer);
  idleParkTimers.clear();
}

export function registerHarness(adapter: HarnessAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getHarness(id: HarnessId): HarnessAdapter | undefined {
  return adapters.get(id);
}

export function requireHarness(id: HarnessId): HarnessAdapter {
  const adapter = adapters.get(id);
  if (!adapter) {
    throw new Error(`No harness adapter registered for "${id}"`);
  }
  return adapter;
}

export function isLiveHarness(id: HarnessId): boolean {
  return adapters.get(id)?.live === true;
}

export function listHarnesses(): HarnessAdapter[] {
  return [...adapters.values()];
}

export async function sendHarnessTurn(input: SendTurnInput & { harness: HarnessId }) {
  const adapter = requireHarness(input.harness);
  if (!adapter.live) {
    throw new Error(`${input.harness} is not connected yet`);
  }
  cancelIdlePark(input.sessionId);
  try {
    await adapter.sendTurn(input);
  } finally {
    scheduleIdlePark(input.harness, input.sessionId);
  }
}

export function canSteerHarness(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  if (!adapter?.live) return false;
  return adapter.canSteer !== false;
}

export async function steerHarnessTurn(
  input: SteerTurnInput & { harness: HarnessId },
): Promise<void> {
  const adapter = requireHarness(input.harness);
  if (!adapter.live) {
    throw new Error(`${input.harness} is not connected yet`);
  }
  cancelIdlePark(input.sessionId);
  await adapter.steerTurn(input);
}

export async function cancelHarnessTurn(harness: HarnessId, sessionId: string): Promise<void> {
  const adapter = getHarness(harness);
  if (!adapter?.live) return;
  cancelIdlePark(sessionId);
  await adapter.cancelTurn(sessionId);
  scheduleIdlePark(harness, sessionId);
}

export function respondHarnessApproval(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
): void {
  getHarness(harness)?.respondApproval(sessionId, requestId, decision);
}

export function respondHarnessQuestion(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): void {
  getHarness(harness)?.respondQuestion?.(sessionId, requestId, reply);
}

export async function stopHarnessSession(
  harness: HarnessId,
  sessionId: string,
  hostId?: HostId,
): Promise<void> {
  cancelIdlePark(sessionId);
  const adapter = getHarness(harness);
  if (!adapter?.live) return;
  await adapter.stopSession(sessionId, hostId);
}

export async function forgetHarnessSession(
  harness: HarnessId,
  sessionId: string,
  hostId?: HostId,
): Promise<void> {
  cancelIdlePark(sessionId);
  const adapter = getHarness(harness);
  if (!adapter) return;
  await adapter.forgetSession(sessionId, hostId);
}

export function bindHarnessSession(
  harness: HarnessId,
  threadId: string,
  providerSessionId: string,
  cwd: string,
  hostId?: HostId,
): void {
  getHarness(harness)?.bindSession(threadId, providerSessionId, cwd, hostId);
}

/**
 * Probe model lists only for the harnesses the caller actually needs.
 * Boot used to refresh every adapter; that spawned unused CLIs (Pi with
 * extensions can sit at ~1GB) even when the workspace never touched them.
 */
export async function refreshHarnessCatalogs(
  ids: Iterable<HarnessId>,
  hostId?: HostId,
): Promise<void> {
  const wanted = new Set(ids);
  if (wanted.size === 0) return;
  await Promise.all(
    [...adapters.values()]
      .filter((adapter) => wanted.has(adapter.id))
      .map(async (adapter) => {
        if (!adapter.refreshCatalog || hasLiveCatalog(adapter.id)) return;
        await adapter.refreshCatalog(hostId).catch((error: unknown) => {
          console.debug(`[wavex] ${adapter.id} catalog`, error);
        });
      }),
  );
}

export async function generateHarnessTitle(
  harness: HarnessId,
  input: TitleInput,
): Promise<string | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generateTitle) return null;
  return adapter.generateTitle(input);
}

export async function generateHarnessCommitMessage(
  harness: HarnessId,
  cwd: string,
  hostId?: HostId,
): Promise<string> {
  const adapter = requireHarness(harness);
  if (!adapter.generateCommitMessage) {
    throw new Error(`${harness} does not support commit message generation`);
  }
  return adapter.generateCommitMessage(cwd, hostId);
}

export async function generateHarnessPrContent(
  harness: HarnessId,
  cwd: string,
  hostId?: HostId,
): Promise<(PrContent & { base: string; head: string }) | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generatePrContent) return null;
  return adapter.generatePrContent(cwd, hostId);
}

export async function generateHarnessBranchName(
  harness: HarnessId,
  cwd: string,
  message: string,
  hostId?: HostId,
): Promise<string | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generateBranchName) return null;
  return adapter.generateBranchName(cwd, message, hostId);
}

export async function warmupHarnessText(
  harness: HarnessId,
  cwd: string,
  hostId?: HostId,
): Promise<void> {
  await getHarness(harness)?.warmupText?.(cwd, hostId);
}
