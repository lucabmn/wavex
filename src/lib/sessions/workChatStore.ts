/**
 * Shared state for the Work surface.
 *
 * Work chats are sessions, so everything below reuses the session transcript
 * reducer, the harness registry, and the SQLite session store. What this file
 * owns is the chat *collection*: which chats exist, which one is in front, and
 * the turn lifecycle for a surface that has no tabs, panes, or project.
 *
 * A `useSyncExternalStore` store rather than a React context because the
 * transcript streams: turns arrive outside React and are batched into one
 * paint per frame, the same way `App.tsx` batches coding sessions.
 */

import { displayAttachments, prepareAttachments } from "../attachments";
import {
  applyHarnessEvent,
  appendUser,
  cancelHarnessTurn,
  forgetHarnessSession,
  generateHarnessTitle,
  isLiveHarness,
  sendHarnessTurn,
  stopStreaming,
  type HarnessEvent,
} from "../harness";
import { cancelScheduledFlush, scheduleHarnessFlush, type ScheduledFlush } from "../harness/flush";
import type { ApprovalDecision } from "../harness/types";
import { respondHarnessApproval, respondHarnessQuestion } from "../harness/registry";
import type { UserQuestionReply } from "../userQuestion";
import { preferredModelSettings, resolveModel } from "../models";
import type { Attachment, HarnessId, Session } from "../session";
import { deleteSession, getSession, listSessionsByScope, upsertSession } from "./sessionStore";
import type { SessionSummary } from "./sessionStore";
import {
  canReplaceWorkChatTitle,
  newWorkChat,
  normalizeWorkChatTitle,
  workChatDir,
  workChatTitleFromPrompt,
} from "./workChats";

export type WorkChatState = {
  /** Chats loaded into memory. Persisted chats are hydrated on selection. */
  chats: Session[];
  /** Stored chat rows, for the list. */
  summaries: SessionSummary[];
  activeId: string | null;
  /** Directory the harness child runs in. Empty until Rust answers. */
  dir: string;
  loading: boolean;
  error: string | null;
};

const EMPTY: WorkChatState = {
  chats: [],
  summaries: [],
  activeId: null,
  dir: "",
  loading: false,
  error: null,
};

let state: WorkChatState = EMPTY;
const listeners = new Set<() => void>();

export function subscribeWorkChats(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWorkChatState(): WorkChatState {
  return state;
}

/** Test seam. */
export function resetWorkChatStore(): void {
  cancelScheduledFlush(flush);
  flush = null;
  queued.clear();
  turnGeneration.clear();
  state = EMPTY;
  loaded = null;
  emit();
}

function set(next: Partial<WorkChatState>): void {
  state = { ...state, ...next };
  emit();
}

function emit(): void {
  for (const listener of listeners) listener();
}

function patchChat(id: string, update: (chat: Session) => Session): void {
  let changed = false;
  const chats = state.chats.map((chat) => {
    if (chat.id !== id) return chat;
    const next = update(chat);
    if (next !== chat) changed = true;
    return next;
  });
  if (!changed) return;
  set({ chats });
}

export function findWorkChat(id: string | null): Session | null {
  if (!id) return null;
  return state.chats.find((chat) => chat.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

let loaded: Promise<void> | null = null;

/** Idempotent: the surface mounts and unmounts as the user switches modes. */
export function loadWorkChats(): Promise<void> {
  loaded ??= loadOnce();
  return loaded;
}

async function loadOnce(): Promise<void> {
  set({ loading: true, error: null });
  try {
    const [dir, summaries] = await Promise.all([workChatDir(), listSessionsByScope("work")]);
    set({ dir, summaries, loading: false });
    if (!state.activeId && summaries[0]) await selectWorkChat(summaries[0].id);
  } catch (error: unknown) {
    set({
      loading: false,
      error: error instanceof Error ? error.message : "Could not load chats.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Chat lifecycle                                                             */
/* -------------------------------------------------------------------------- */

export async function createWorkChat(harness?: HarnessId, model?: string): Promise<string> {
  const dir = state.dir || (await workChatDir().catch(() => "~"));
  const chat = newWorkChat(dir, harness, model);
  set({ dir, chats: [...state.chats, chat], activeId: chat.id });
  return chat.id;
}

/** Load a stored chat into memory. A second caller reuses the first result. */
async function hydrate(id: string): Promise<Session | null> {
  const open = findWorkChat(id);
  if (open) return open;
  const record = await getSession(id).catch(() => null);
  if (!record) return null;
  // Loading can race a second click; the first one in wins.
  const raced = findWorkChat(id);
  if (raced) return raced;
  const chat: Session = { ...record, scope: "work", busy: false };
  set({ chats: [...state.chats, chat] });
  return chat;
}

function summaryHarness(id: string): HarnessId | undefined {
  return state.summaries.find((row) => row.id === id)?.harness;
}

export async function selectWorkChat(id: string): Promise<void> {
  set({ activeId: id });
  await hydrate(id);
}

export async function renameWorkChat(id: string, title: string): Promise<void> {
  const next = normalizeWorkChatTitle(title);
  set({
    summaries: state.summaries.map((row) => (row.id === id ? { ...row, title: next } : row)),
  });
  // Only the chats the user has opened are in memory. Renaming one that is
  // still just a list row has to load it, or the new title never reaches
  // SQLite and the old one comes back on restart.
  const chat = findWorkChat(id) ?? (await hydrate(id));
  if (!chat) return;
  patchChat(id, (current) => (current.title === next ? current : { ...current, title: next }));
  await upsertSession(findWorkChat(id) ?? { ...chat, title: next }).catch(() => null);
}

export async function deleteWorkChat(id: string): Promise<void> {
  // Drop the provider thread too: the transcript is going away, so resuming it
  // later would answer against a conversation the user cannot see. A chat the
  // user never opened still has one, so its harness has to be looked up.
  const harness = findWorkChat(id)?.harness ?? summaryHarness(id);
  if (harness) await forgetHarnessSession(harness, id).catch(() => undefined);
  bumpTurn(id);
  queued.delete(id);
  const chats = state.chats.filter((row) => row.id !== id);
  const summaries = state.summaries.filter((row) => row.id !== id);
  const activeId =
    state.activeId === id
      ? (chats[chats.length - 1]?.id ?? summaries[0]?.id ?? null)
      : state.activeId;
  set({ chats, summaries, activeId });
  await deleteSession(id).catch(() => undefined);
}

export function setWorkChatModel(id: string, harness: HarnessId, model: string): void {
  patchChat(id, (chat) => {
    if (chat.harness === harness && chat.model === model) return chat;
    const resolved = resolveModel(harness, model);
    // Switching provider mid-chat starts a new provider thread; there is no
    // handoff brief on this surface, so drop the stale resume id.
    const sameHarness = chat.harness === harness;
    return {
      ...chat,
      harness,
      model: resolved.id,
      modelSettings: preferredModelSettings(resolved, sameHarness ? chat.modelSettings : {}),
      ...(sameHarness ? {} : { providerSessionId: undefined }),
    };
  });
  void persist(id);
}

export function setWorkChatModelSettings(id: string, settings: Record<string, string>): void {
  patchChat(id, (chat) => ({ ...chat, modelSettings: settings }));
  void persist(id);
}

/* -------------------------------------------------------------------------- */
/* Turns                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Streamed deltas arrive far faster than a useful repaint. Queue them and
 * apply one batch per frame, matching how coding sessions are flushed.
 */
const queued = new Map<string, HarnessEvent[]>();
let flush: ScheduledFlush | null = null;

function flushEvents(): void {
  flush = null;
  if (queued.size === 0) return;
  const chats = state.chats.map((chat) => {
    const events = queued.get(chat.id);
    if (!events?.length) return chat;
    return events.reduce(applyHarnessEvent, chat);
  });
  queued.clear();
  set({ chats });
}

function enqueue(id: string, event: HarnessEvent): void {
  // Approvals and questions are interactive: showing them a frame late is
  // fine, but they must never be dropped behind a cancelled flush.
  const events = queued.get(id);
  if (events) events.push(event);
  else queued.set(id, [event]);
  flush ??= scheduleHarnessFlush(flushEvents);
}

/**
 * A cancelled or superseded turn must not keep writing into the transcript.
 * Bumping the generation makes every in-flight callback for that chat a no-op.
 */
const turnGeneration = new Map<string, number>();

function bumpTurn(id: string): number {
  const next = (turnGeneration.get(id) ?? 0) + 1;
  turnGeneration.set(id, next);
  return next;
}

async function persist(id: string): Promise<void> {
  const chat = findWorkChat(id);
  if (!chat) return;
  const summary = await upsertSession(chat).catch(() => null);
  if (!summary) return;
  const summaries = state.summaries.some((row) => row.id === id)
    ? state.summaries.map((row) => (row.id === id ? summary : row))
    : [summary, ...state.summaries];
  set({ summaries });
}

export async function sendWorkChatTurn(
  id: string,
  text: string,
  attachments: Attachment[] = [],
): Promise<void> {
  const chat = findWorkChat(id);
  if (!chat || chat.busy) return;
  if (!text.trim() && attachments.length === 0) return;

  const visible = displayAttachments(attachments);
  const seed = workChatTitleFromPrompt(text, visible);
  const firstTurn = chat.blocks.every((block) => block.role !== "user");
  const titled = canReplaceWorkChatTitle(chat.title, seed) ? seed : chat.title;

  if (!isLiveHarness(chat.harness)) {
    patchChat(id, (current) => ({
      ...current,
      title: titled,
      blocks: [
        ...current.blocks,
        {
          id: crypto.randomUUID(),
          role: "user",
          text,
          ...(visible.length ? { attachments: visible } : {}),
        },
        {
          id: crypto.randomUUID(),
          role: "system",
          text: `${current.harness} is not connected yet — install and sign in to that provider, then retry.`,
        },
      ],
    }));
    await persist(id);
    return;
  }

  patchChat(id, (current) => appendUser({ ...current, title: titled }, text, visible));
  const generation = bumpTurn(id);

  if (firstTurn && titled === seed) {
    void generateHarnessTitle(chat.harness, { sessionId: id, cwd: chat.cwd, message: text })
      .then((generated) => {
        if (!generated) return;
        patchChat(id, (current) =>
          canReplaceWorkChatTitle(current.title, seed) ? { ...current, title: generated } : current,
        );
        void persist(id);
      })
      .catch(() => undefined);
  }

  try {
    const prepared = await prepareAttachments(attachments);
    if (turnGeneration.get(id) !== generation) return;
    await sendHarnessTurn({
      harness: chat.harness,
      sessionId: id,
      cwd: chat.cwd,
      model: chat.model,
      modelSettings: chat.modelSettings,
      runtimeMode: chat.runtimeMode,
      text,
      attachments: prepared,
      onEvent: (event) => {
        if (turnGeneration.get(id) !== generation) return;
        enqueue(id, event);
      },
    });
  } catch (error: unknown) {
    if (turnGeneration.get(id) !== generation) return;
    enqueue(id, {
      type: "session.error",
      message: error instanceof Error ? error.message : `${chat.harness} adapter failed`,
    });
  } finally {
    if (turnGeneration.get(id) === generation) {
      flushEvents();
      patchChat(id, stopStreaming);
      await persist(id);
    }
  }
}

export async function stopWorkChat(id: string): Promise<void> {
  const chat = findWorkChat(id);
  if (!chat) return;
  bumpTurn(id);
  flushEvents();
  patchChat(id, stopStreaming);
  await cancelHarnessTurn(chat.harness, id).catch(() => undefined);
  await persist(id);
}

export function respondWorkChatApproval(
  id: string,
  requestId: number,
  decision: ApprovalDecision,
): void {
  const chat = findWorkChat(id);
  if (!chat) return;
  respondHarnessApproval(chat.harness, id, requestId, decision);
}

export function respondWorkChatQuestion(
  id: string,
  requestId: number,
  reply: UserQuestionReply,
): void {
  const chat = findWorkChat(id);
  if (!chat) return;
  respondHarnessQuestion(chat.harness, id, requestId, reply);
}

/**
 * Resend a user turn, optionally with edited text.
 *
 * The transcript is truncated at that turn so the chat reads as if the newer
 * exchange never happened. The provider thread is *not* rewound — no installed
 * CLI exposes that — so the model still remembers what it already answered.
 * That is why the prompt is sent again in full rather than as a bare "retry".
 */
export async function resendWorkChatTurn(
  id: string,
  blockId: string,
  text?: string,
): Promise<void> {
  const chat = findWorkChat(id);
  if (!chat || chat.busy) return;
  const index = chat.blocks.findIndex((block) => block.id === blockId && block.role === "user");
  if (index < 0) return;
  const source = chat.blocks[index];
  const prompt = text ?? source.text;
  const attachments = source.attachments ?? [];
  if (!prompt.trim() && attachments.length === 0) return;

  patchChat(id, (current) => ({ ...current, blocks: current.blocks.slice(0, index) }));
  await sendWorkChatTurn(id, prompt, attachments);
}

/** Regenerate the assistant reply to the user turn that produced `blockId`. */
export async function regenerateWorkChatTurn(id: string, blockId: string): Promise<void> {
  const chat = findWorkChat(id);
  if (!chat) return;
  const index = chat.blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return;
  for (let i = index; i >= 0; i--) {
    if (chat.blocks[i].role === "user") {
      await resendWorkChatTurn(id, chat.blocks[i].id);
      return;
    }
  }
}
