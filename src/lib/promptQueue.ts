import type { Attachment } from "./session";

/** A prompt the user wrote while a turn was still running. */
export type QueuedPrompt = {
  id: string;
  text: string;
  attachments: Attachment[];
  queuedAt: number;
  /**
   * Work's image-generation mode, carried so a queued prompt is sent the way it
   * was written rather than the way the toggle happens to sit later.
   */
  image?: boolean;
};

/** Queues per session. Never persisted: a queued prompt is not a session block. */
export type PromptQueues = ReadonlyMap<string, QueuedPrompt[]>;

export const EMPTY_QUEUES: PromptQueues = new Map();

/**
 * One shared empty list. `SessionPane` compares props shallowly, so handing it
 * a fresh `[]` per render would re-render every pane on every keystroke.
 */
const NO_PROMPTS: QueuedPrompt[] = [];

export function queuedFor(queues: PromptQueues, sessionId: string): QueuedPrompt[] {
  return queues.get(sessionId) ?? NO_PROMPTS;
}

export function enqueuePrompt(
  queues: PromptQueues,
  sessionId: string,
  prompt: QueuedPrompt,
): PromptQueues {
  const next = new Map(queues);
  next.set(sessionId, [...queuedFor(queues, sessionId), prompt]);
  return next;
}

/** The oldest prompt, and the queues without it. Order is send order. */
export function takeNextPrompt(
  queues: PromptQueues,
  sessionId: string,
): { prompt: QueuedPrompt | null; queues: PromptQueues } {
  const list = queuedFor(queues, sessionId);
  if (list.length === 0) return { prompt: null, queues };
  const [prompt, ...rest] = list;
  return { prompt, queues: setQueue(queues, sessionId, rest) };
}

export function removeQueuedPrompt(
  queues: PromptQueues,
  sessionId: string,
  promptId: string,
): PromptQueues {
  const list = queuedFor(queues, sessionId);
  if (list.length === 0) return queues;
  return setQueue(
    queues,
    sessionId,
    list.filter((prompt) => prompt.id !== promptId),
  );
}

export function clearQueue(queues: PromptQueues, sessionId: string): PromptQueues {
  if (!queues.has(sessionId)) return queues;
  return setQueue(queues, sessionId, []);
}

/** Drop the queues of sessions that no longer exist, so closing a tab frees them. */
export function pruneQueues(
  queues: PromptQueues,
  liveSessionIds: ReadonlySet<string>,
): PromptQueues {
  let changed = false;
  const next = new Map<string, QueuedPrompt[]>();
  for (const [sessionId, list] of queues) {
    if (liveSessionIds.has(sessionId)) next.set(sessionId, list);
    else changed = true;
  }
  return changed ? next : queues;
}

/**
 * A queued prompt goes out when the turn it was waiting on ended on its own.
 *
 * Stopping is the user saying "not this" — auto-sending the next prompt into a
 * real checkout right after would be a write they did not ask for. The chips
 * stay on screen instead, so the prompt is one click away but never a surprise.
 */
export function canFlushQueue(state: {
  busy: boolean;
  needsInput: boolean;
  stopped: boolean;
}): boolean {
  return !state.busy && !state.needsInput && !state.stopped;
}

/**
 * One rule for every composer: a prompt written while a turn runs waits in the
 * queue, where it stays visible and removable.
 *
 * ⌥Enter is the escape hatch for harnesses that can take a follow-up mid-turn
 * — it steers the running turn instead. On a harness that cannot steer the
 * prompt is queued anyway, because the alternative was dropping it.
 */
export function shouldQueuePrompt(state: {
  steerRequested: boolean;
  busy: boolean;
  canSteer: boolean;
}): boolean {
  if (!state.busy) return false;
  return !(state.steerRequested && state.canSteer);
}

export function queueSummary(count: number): string {
  return count === 1 ? "1 queued prompt" : `${count} queued prompts`;
}

function setQueue(queues: PromptQueues, sessionId: string, list: QueuedPrompt[]): PromptQueues {
  const next = new Map(queues);
  if (list.length === 0) next.delete(sessionId);
  else next.set(sessionId, list);
  return next;
}
