import type { HandoffComposerCard } from "./handoff";
import type { InboxComposerCard } from "./inbox/githubTasks";
import type { NoteComposerCard } from "./notes";
import type { Attachment } from "./session";
import type { FollowUpBehavior } from "./settings";

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
  /** Coding-session chips folded into the turn when this prompt goes out. */
  noteCard?: NoteComposerCard;
  handoffCard?: HandoffComposerCard;
  inboxCard?: InboxComposerCard;
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

/** Rewrite the text of one queued prompt, keeping its place in line. */
export function updateQueuedPrompt(
  queues: PromptQueues,
  sessionId: string,
  promptId: string,
  text: string,
): PromptQueues {
  const list = queuedFor(queues, sessionId);
  if (!list.some((prompt) => prompt.id === promptId)) return queues;
  return setQueue(
    queues,
    sessionId,
    list.map((prompt) => (prompt.id === promptId ? { ...prompt, text } : prompt)),
  );
}

/** The oldest prompt: the one auto-dispatch sends first. */
export function queuedHead(queues: PromptQueues, sessionId: string): QueuedPrompt | undefined {
  return queuedFor(queues, sessionId)[0];
}

/**
 * Hold auto-dispatch only while the item about to send is being edited. An
 * edit two rows down must not block the head from going out.
 */
export function isEditingQueuedHead(
  queues: PromptQueues,
  sessionId: string,
  editingPromptId?: string,
): boolean {
  if (!editingPromptId) return false;
  return queuedHead(queues, sessionId)?.id === editingPromptId;
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
 * True when an idle session may send its queued head as a new turn. A busy
 * turn, a pending approval or question, a stop, a preparing handoff, and an
 * open edit on the head row itself all wait.
 */
export function canDispatchQueuedHead(state: {
  busy: boolean;
  needsInput: boolean;
  stopped: boolean;
  resuming: boolean;
  hasHead: boolean;
  editingHead: boolean;
  preparingHandoff: boolean;
}): boolean {
  if (state.busy) return false;
  if (state.needsInput) return false;
  if (state.stopped) return false;
  if (state.resuming) return false;
  if (!state.hasHead) return false;
  if (state.editingHead) return false;
  if (state.preparingHandoff) return false;
  return true;
}

/**
 * Resolve a queued prompt for sending. Auto-dispatch only ever takes the
 * idle head; an explicit steer may target any remaining row, including while
 * a turn is running or the queue is paused — the row stays queued until the
 * steer actually starts, so a harness that cannot take it swallows nothing.
 */
export function queuedPromptForSubmit(
  queues: PromptQueues,
  sessionId: string,
  promptId: string,
  mode: "dispatch" | "steer",
): QueuedPrompt | undefined {
  const prompt = queuedFor(queues, sessionId).find((entry) => entry.id === promptId);
  if (!prompt) return undefined;
  if (mode === "steer") return prompt;
  return queuedHead(queues, sessionId)?.id === promptId ? prompt : undefined;
}

/**
 * One rule for every composer: a prompt written while a turn runs waits in the
 * queue, where it stays visible and removable — unless follow-ups steer.
 *
 * Steer is the default: on a harness that can take a follow-up mid-turn the
 * prompt joins the running turn instead of waiting behind it. ⌥Enter forces
 * a steer attempt even when the setting says queue. Whenever steering is
 * asked for but impossible the prompt is queued anyway, because the
 * alternative was dropping it.
 */
export function shouldQueuePrompt(state: {
  steerRequested: boolean;
  busy: boolean;
  canSteer: boolean;
  followUpBehavior?: FollowUpBehavior;
}): boolean {
  if (!state.busy) return false;
  if (state.steerRequested) return !state.canSteer;
  if ((state.followUpBehavior ?? "queue") === "queue") return true;
  return !state.canSteer;
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
