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
  harnessErrorMessage,
  isLiveHarness,
  sendHarnessTurn,
  stopStreaming,
  type HarnessEvent,
} from "../harness";
import { cancelScheduledFlush, scheduleHarnessFlush, type ScheduledFlush } from "../harness/flush";
import {
  GENERATED_IMAGE_MIME,
  buildImagePrompt,
  extractGeneratedSvg,
  generatedImageName,
} from "../harness/imageGeneration";
import { writeGeneratedImage } from "../fs";
import type { ApprovalDecision } from "../harness/types";
import { respondHarnessApproval, respondHarnessQuestion } from "../harness/registry";
import type { UserQuestionReply } from "../userQuestion";
import { preferredModelSettings, resolveModel } from "../models";
import {
  canFlushQueue,
  EMPTY_QUEUES,
  enqueuePrompt,
  isEditingQueuedHead,
  queuedFor,
  queuedHead,
  removeQueuedPrompt,
  takeNextPrompt,
  updateQueuedPrompt,
  type PromptQueues,
  type QueuedPrompt,
} from "../promptQueue";
import { sessionNeedsInput, type Attachment, type HarnessId, type Session } from "../session";
import {
  deleteSession,
  getSession,
  listSessionsByScope,
  setSessionArchived,
  setSessionPinned,
  upsertSession,
} from "./sessionStore";
import type { SessionSummary } from "./sessionStore";
import {
  addChatToFolder,
  applyWorkChatDrop,
  createWorkChatFolder,
  deleteFolder,
  folderPromptForChat,
  injectFolderPrompt,
  loadWorkChatFolders,
  pruneWorkChatFolders,
  removeChatFromFolders,
  renameFolder,
  saveWorkChatFolders,
  setFolderCollapsed,
  setFolderPrompt,
  type WorkChatDropTarget,
  type WorkChatFolder,
} from "./workChatFolders";
import {
  canReplaceWorkChatTitle,
  forgetWorkChatOrder,
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
  /** Projects: named groups of chats, each with a shared brief. */
  folders: WorkChatFolder[];
  activeId: string | null;
  /** Directory the harness child runs in. Empty until Rust answers. */
  dir: string;
  loading: boolean;
  error: string | null;
  /** Prompts written while a turn was running, per chat. Never persisted. */
  queues: PromptQueues;
};

const EMPTY: WorkChatState = {
  chats: [],
  summaries: [],
  folders: [],
  activeId: null,
  dir: "",
  loading: false,
  error: null,
  queues: EMPTY_QUEUES,
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
  stoppedChats.clear();
  editingChats.clear();
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

/** Retry after a failed load without allowing concurrent duplicate loads. */
export function reloadWorkChats(): Promise<void> {
  if (state.loading) return loaded ?? Promise.resolve();
  loaded = null;
  return loadWorkChats();
}

async function loadOnce(): Promise<void> {
  set({ loading: true, error: null });
  try {
    const [dir, summaries] = await Promise.all([workChatDir(), listSessionsByScope("work")]);
    // Projects live in localStorage; a chat deleted while the app was closed
    // leaves a stale member id behind, so membership is reconciled here. The
    // project itself is kept even when that empties it — it holds the brief.
    const folders = pruneWorkChatFolders(
      loadWorkChatFolders(),
      new Set(summaries.map((row) => row.id)),
    );
    set({ dir, summaries, folders, loading: false });
    saveWorkChatFolders(folders);
    const first = summaries.find((row) => !row.archived);
    if (!state.activeId && first) await selectWorkChat(first.id);
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

export async function createWorkChat(
  harness?: HarnessId,
  model?: string,
  folderId?: string,
): Promise<string> {
  const dir = state.dir || (await workChatDir().catch(() => "~"));
  const chat = newWorkChat(dir, harness, model);
  set({ dir, chats: [...state.chats, chat], activeId: chat.id });
  if (folderId) commitFolders(addChatToFolder(state.folders, folderId, chat.id));
  return chat.id;
}

/* -------------------------------------------------------------------------- */
/* Projects                                                                   */
/* -------------------------------------------------------------------------- */

function commitFolders(folders: WorkChatFolder[]): void {
  if (folders === state.folders) return;
  set({ folders });
  saveWorkChatFolders(folders);
}

export function createChatFolder(name?: string): string {
  const { folders, id } = createWorkChatFolder(state.folders, name);
  commitFolders(folders);
  return id;
}

export function renameChatFolder(folderId: string, name: string): void {
  commitFolders(renameFolder(state.folders, folderId, name));
}

/** Removes the project. Its chats survive and fall back to the flat list. */
export function deleteChatFolder(folderId: string): void {
  commitFolders(deleteFolder(state.folders, folderId));
}

export function setChatFolderPrompt(folderId: string, prompt: string): void {
  commitFolders(setFolderPrompt(state.folders, folderId, prompt));
}

export function setChatFolderCollapsed(folderId: string, collapsed: boolean): void {
  commitFolders(setFolderCollapsed(state.folders, folderId, collapsed));
}

export function moveChatToFolder(chatId: string, folderId: string | null): void {
  commitFolders(
    folderId
      ? addChatToFolder(state.folders, folderId, chatId)
      : removeChatFromFolders(state.folders, chatId),
  );
}

/** Result of a drag in the chat list. Returns a project it had to create. */
export function dropChatOnTarget(
  draggedId: string,
  target: WorkChatDropTarget,
): string | undefined {
  const { folders, createdId } = applyWorkChatDrop(state.folders, draggedId, target);
  commitFolders(folders);
  return createdId;
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
  // Persist first. If SQLite rejects the mutation, the visible chat and its
  // provider thread stay intact so the user can retry without losing context.
  await deleteSession(id);

  // Drop the provider thread too: the transcript is going away, so resuming it
  // later would answer against a conversation the user cannot see. A chat the
  // user never opened still has one, so its harness has to be looked up.
  const harness = findWorkChat(id)?.harness ?? summaryHarness(id);
  if (harness) await forgetHarnessSession(harness, id).catch(() => undefined);
  bumpTurn(id);
  queued.delete(id);
  stoppedChats.delete(id);
  editingChats.delete(id);
  const chats = state.chats.filter((row) => row.id !== id);
  const summaries = state.summaries.filter((row) => row.id !== id);
  const activeId =
    state.activeId === id
      ? (chats[chats.length - 1]?.id ?? summaries.find((row) => !row.archived)?.id ?? null)
      : state.activeId;
  set({ chats, summaries, activeId });
  // The project stays even if that was its last chat.
  commitFolders(removeChatFromFolders(state.folders, id));
  forgetWorkChatOrder([id]);
}

export async function setWorkChatPinned(id: string, pinned: boolean): Promise<void> {
  if (!state.summaries.some((row) => row.id === id)) return;
  set({
    summaries: state.summaries.map((row) => (row.id === id ? { ...row, pinned } : row)),
  });
  await setSessionPinned(id, pinned).catch(() => undefined);
}

/**
 * Archiving hides the chat from the list, so the transcript cannot keep
 * showing it — selection falls back the same way a delete does.
 */
export async function setWorkChatArchived(id: string, archived: boolean): Promise<void> {
  if (!state.summaries.some((row) => row.id === id)) return;
  const summaries = state.summaries.map((row) => (row.id === id ? { ...row, archived } : row));
  const activeId =
    archived && state.activeId === id
      ? (summaries.find((row) => !row.archived)?.id ?? null)
      : state.activeId;
  set({ summaries, activeId });
  await setSessionArchived(id, archived).catch(() => undefined);
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

export type SendWorkChatOptions = {
  /** Ask the harness for an image instead of an answer. */
  image?: boolean;
};

export async function sendWorkChatTurn(
  id: string,
  text: string,
  attachments: Attachment[] = [],
  options: SendWorkChatOptions = {},
): Promise<void> {
  const chat = findWorkChat(id);
  if (!chat) return;
  if (!text.trim() && attachments.length === 0) return;
  // A follow-up written mid-turn used to be dropped here without a trace.
  // It waits in the queue instead, visible above the composer, and goes out
  // when the turn ends on its own.
  if (chat.busy) {
    set({
      queues: enqueuePrompt(state.queues, id, {
        id: crypto.randomUUID(),
        text,
        attachments,
        queuedAt: Date.now(),
        ...(options.image ? { image: true } : {}),
      }),
    });
    return;
  }
  // A stop applies to everything queued behind it, so a fresh prompt does not
  // release the queue. Only sending a chip does, and only once it is empty.
  if (queuedFor(state.queues, id).length === 0) stoppedChats.delete(id);
  // The transcript shows what the user asked for; the harness gets the
  // output-shape instructions wrapped around it, and the project brief in
  // front of the whole thing so every chat in a project knows what it is
  // working on. `appendUser` below is still handed the bare `text`.
  const project = folderPromptForChat(state.folders, id);
  const shaped = options.image ? buildImagePrompt(text) : text;
  const harnessText = project ? injectFolderPrompt(shaped, project) : shaped;

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

  patchChat(id, (current) => {
    const next = appendUser({ ...current, title: titled }, text, visible);
    if (!options.image) return next;
    const blocks = next.blocks.slice();
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], imageRequest: true };
    return { ...next, blocks };
  });
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
      text: harnessText,
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
      message: harnessErrorMessage(error, chat.harness),
    });
  } finally {
    if (turnGeneration.get(id) === generation) {
      flushEvents();
      patchChat(id, stopStreaming);
      if (options.image) await collectGeneratedImage(id, text);
      await persist(id);
      flushWorkChatQueue(id);
    }
  }
}

/** Chats whose current turn the user stopped. Their queue waits for a real send. */
const stoppedChats = new Set<string>();

/** Open queue-row edits, per chat. Only the head row holds auto-dispatch. */
const editingChats = new Map<string, string>();

/** The queue waits for a deliberate resume after the user stopped the turn. */
export function isWorkChatQueuePaused(id: string): boolean {
  return stoppedChats.has(id);
}

export function setWorkChatQueuedEditing(id: string, promptId?: string): void {
  if (promptId == null) editingChats.delete(id);
  else editingChats.set(id, promptId);
}

export function workChatQueue(id: string | null): QueuedPrompt[] {
  return id ? queuedFor(state.queues, id) : [];
}

export function removeWorkChatQueuedPrompt(id: string, promptId: string): void {
  set({ queues: removeQueuedPrompt(state.queues, id, promptId) });
}

export function updateWorkChatQueuedPrompt(id: string, promptId: string, text: string): void {
  set({ queues: updateQueuedPrompt(state.queues, id, promptId, text) });
  editingChats.delete(id);
}

/**
 * Resume a paused queue: the head goes out now, the rest follows turn by
 * turn. A no-op when the chat is busy or nothing is left waiting.
 */
export function resumeWorkChatQueue(id: string): void {
  const chat = findWorkChat(id);
  if (!chat || chat.busy || !stoppedChats.has(id)) return;
  if (queuedFor(state.queues, id).length === 0) {
    stoppedChats.delete(id);
    return;
  }
  stoppedChats.delete(id);
  flushWorkChatQueue(id);
}

/**
 * Send one queued prompt now. This is the deliberate send a stopped turn waits
 * for, so it also releases the rest of that chat's queue.
 */
export function sendWorkChatQueuedPrompt(id: string, promptId: string): void {
  const prompt = queuedFor(state.queues, id).find((entry) => entry.id === promptId);
  if (!prompt) return;
  stoppedChats.delete(id);
  set({ queues: removeQueuedPrompt(state.queues, id, promptId) });
  void sendWorkChatTurn(id, prompt.text, prompt.attachments, { image: prompt.image === true });
}

/** One prompt per turn boundary. Sending it schedules the next the same way. */
function flushWorkChatQueue(id: string): void {
  const chat = findWorkChat(id);
  if (!chat) return;
  // An edit two rows down must not block the head from going out.
  if (isEditingQueuedHead(state.queues, id, editingChats.get(id))) return;
  const flushable = canFlushQueue({
    busy: !!chat.busy,
    needsInput: sessionNeedsInput(chat),
    stopped: stoppedChats.has(id),
  });
  if (!flushable) return;
  const head = queuedHead(state.queues, id);
  const taken = takeNextPrompt(state.queues, id);
  if (!taken.prompt || !head || taken.prompt.id !== head.id) return;
  set({ queues: taken.queues });
  void sendWorkChatTurn(id, taken.prompt.text, taken.prompt.attachments, {
    image: taken.prompt.image === true,
  });
}

/**
 * Turn the SVG the agent just wrote into an image block.
 *
 * The markup is written to app data first, so the stored transcript keeps a
 * file reference rather than the payload and the picture survives a restart.
 * A reply that is not an image is left alone — the user still sees whatever
 * the harness said, which is how they find out it refused.
 */
async function collectGeneratedImage(id: string, request: string): Promise<void> {
  const chat = findWorkChat(id);
  const last = chat?.blocks[chat.blocks.length - 1];
  if (!last || last.role !== "assistant") return;
  const svg = extractGeneratedSvg(last.text);
  if (!svg) return;

  const name = generatedImageName(request);
  const data = btoa(unescape(encodeURIComponent(svg)));
  const path = await writeGeneratedImage(name, data).catch(() => null);
  if (!path) return;

  patchChat(id, (current) => ({
    ...current,
    blocks: current.blocks.map((block) =>
      block.id === last.id
        ? {
            ...block,
            text: "",
            attachments: [
              {
                id: crypto.randomUUID(),
                name,
                mimeType: GENERATED_IMAGE_MIME,
                kind: "image" as const,
                size: svg.length,
                path,
                data,
              },
            ],
          }
        : block,
    ),
  }));
}

export async function stopWorkChat(id: string): Promise<void> {
  const chat = findWorkChat(id);
  if (!chat) return;
  // Stopping rejects this turn; anything queued behind it stays put.
  stoppedChats.add(id);
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
  // An image turn has to be resent as an image turn, or regenerating a picture
  // answers with prose.
  await sendWorkChatTurn(id, prompt, attachments, { image: source.imageRequest === true });
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
