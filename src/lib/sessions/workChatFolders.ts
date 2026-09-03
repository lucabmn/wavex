/**
 * Projects on the Work surface: named folders that group chats and carry a
 * brief every chat inside them sends ahead of its turn.
 *
 * Unlike `sessionFolders`, a project is *not* deleted when its last chat
 * leaves. The prompt is the point of the folder, so an empty project survives
 * parsing, pruning, and rendering — dropping it would silently discard text
 * the user wrote. That difference is why this is its own module rather than a
 * parameter on the coding-sidebar folders, which are keyed by project path
 * and would all collide on the single work-chat scratch directory.
 */

import type { WorkChatListItem } from "./workChats";

const KEY = "wavex.workChatFolders";

const MAX_NAME = 60;
const MAX_PROMPT = 8000;

export type WorkChatFolder = {
  id: string;
  name: string;
  /** Shared brief prepended to every turn sent from a chat in this folder. */
  prompt: string;
  chatIds: string[];
  collapsed: boolean;
};

export type WorkChatDropTarget =
  | { kind: "folder"; id: string }
  | { kind: "chat"; id: string }
  | { kind: "root" };

export type WorkChatListEntry =
  | { kind: "folder"; folder: WorkChatFolder; chats: WorkChatListItem[] }
  | { kind: "chat"; chat: WorkChatListItem };

type StoredFolder = {
  id?: unknown;
  name?: unknown;
  prompt?: unknown;
  chatIds?: unknown;
  collapsed?: unknown;
};

export function folderContainingChat(
  folders: readonly WorkChatFolder[],
  chatId: string,
): WorkChatFolder | undefined {
  return folders.find((folder) => folder.chatIds.includes(chatId));
}

export function uniqueFolderName(folders: readonly WorkChatFolder[], base = "New project"): string {
  const names = new Set(folders.map((folder) => folder.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!names.has(candidate)) return candidate;
  }
}

export function normalizeFolderName(name: string, folders: readonly WorkChatFolder[]): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return uniqueFolderName(folders);
  return trimmed.length > MAX_NAME ? `${trimmed.slice(0, MAX_NAME - 1)}…` : trimmed;
}

export function createWorkChatFolder(
  folders: WorkChatFolder[],
  name?: string,
  chatIds: string[] = [],
): { folders: WorkChatFolder[]; id: string } {
  const id = crypto.randomUUID();
  const ids = uniqueIds(chatIds);
  const folder: WorkChatFolder = {
    id,
    name: name?.trim() ? normalizeFolderName(name, folders) : uniqueFolderName(folders),
    prompt: "",
    chatIds: ids,
    collapsed: false,
  };
  return { folders: [...withoutChats(folders, ids), folder], id };
}

export function addChatToFolder(
  folders: WorkChatFolder[],
  folderId: string,
  chatId: string,
): WorkChatFolder[] {
  if (!chatId || !folders.some((folder) => folder.id === folderId)) return folders;
  if (folderContainingChat(folders, chatId)?.id === folderId) return folders;
  return folders.map((folder) => {
    if (folder.id === folderId) {
      return { ...folder, chatIds: [...folder.chatIds, chatId], collapsed: false };
    }
    if (!folder.chatIds.includes(chatId)) return folder;
    return { ...folder, chatIds: folder.chatIds.filter((id) => id !== chatId) };
  });
}

export function removeChatFromFolders(folders: WorkChatFolder[], chatId: string): WorkChatFolder[] {
  if (!folderContainingChat(folders, chatId)) return folders;
  return folders.map((folder) =>
    folder.chatIds.includes(chatId)
      ? { ...folder, chatIds: folder.chatIds.filter((id) => id !== chatId) }
      : folder,
  );
}

/** Removes the project itself. Its chats stay, ungrouped. */
export function deleteFolder(folders: WorkChatFolder[], folderId: string): WorkChatFolder[] {
  if (!folders.some((folder) => folder.id === folderId)) return folders;
  return folders.filter((folder) => folder.id !== folderId);
}

export function renameFolder(
  folders: WorkChatFolder[],
  folderId: string,
  name: string,
): WorkChatFolder[] {
  const folder = folders.find((entry) => entry.id === folderId);
  if (!folder) return folders;
  const next = normalizeFolderName(
    name,
    folders.filter((entry) => entry.id !== folderId),
  );
  if (folder.name === next) return folders;
  return folders.map((entry) => (entry.id === folderId ? { ...entry, name: next } : entry));
}

export function setFolderPrompt(
  folders: WorkChatFolder[],
  folderId: string,
  prompt: string,
): WorkChatFolder[] {
  const folder = folders.find((entry) => entry.id === folderId);
  if (!folder) return folders;
  const next = normalizeFolderPrompt(prompt);
  if (folder.prompt === next) return folders;
  return folders.map((entry) => (entry.id === folderId ? { ...entry, prompt: next } : entry));
}

export function setFolderCollapsed(
  folders: WorkChatFolder[],
  folderId: string,
  collapsed: boolean,
): WorkChatFolder[] {
  const folder = folders.find((entry) => entry.id === folderId);
  if (!folder || folder.collapsed === collapsed) return folders;
  return folders.map((entry) => (entry.id === folderId ? { ...entry, collapsed } : entry));
}

/**
 * Dropping on a project (or on a chat already inside one) joins it. Dropping
 * on an ungrouped chat opens a new project around both. Dropping on the empty
 * list area takes the chat out of whatever project it was in.
 */
export function applyWorkChatDrop(
  folders: WorkChatFolder[],
  draggedId: string,
  target: WorkChatDropTarget,
): { folders: WorkChatFolder[]; createdId?: string } {
  if (!draggedId) return { folders };
  if (target.kind === "root") {
    return { folders: removeChatFromFolders(folders, draggedId) };
  }
  if (target.kind === "folder") {
    return { folders: addChatToFolder(folders, target.id, draggedId) };
  }
  if (target.id === draggedId) return { folders };
  const dest = folderContainingChat(folders, target.id);
  if (dest) return { folders: addChatToFolder(folders, dest.id, draggedId) };
  const { folders: next, id } = createWorkChatFolder(folders, undefined, [target.id, draggedId]);
  return { folders: next, createdId: id };
}

/** Drops chats that no longer exist. Projects themselves always survive. */
export function pruneWorkChatFolders(
  folders: WorkChatFolder[],
  knownIds: ReadonlySet<string>,
): WorkChatFolder[] {
  let changed = false;
  const next = folders.map((folder) => {
    const chatIds = folder.chatIds.filter((id) => knownIds.has(id));
    if (chatIds.length === folder.chatIds.length) return folder;
    changed = true;
    return { ...folder, chatIds };
  });
  return changed ? next : folders;
}

/**
 * Projects first, in stored order, then ungrouped chats. An empty project
 * still renders so it can be filled by drag; a search that matches nothing
 * inside it hides it, because there the folder is not a drop target.
 */
export function buildWorkChatList(
  folders: readonly WorkChatFolder[],
  chats: readonly WorkChatListItem[],
  options: { hideEmptyFolders?: boolean } = {},
): WorkChatListEntry[] {
  const folderOf = new Map<string, string>();
  for (const folder of folders) {
    for (const id of folder.chatIds) folderOf.set(id, folder.id);
  }
  // Bucket by walking `chats` rather than `chatIds`, so members keep the
  // caller's order — pinned first, or fuzzy rank during a search.
  const members = new Map<string, WorkChatListItem[]>();
  const ungrouped: WorkChatListItem[] = [];
  for (const chat of chats) {
    const folderId = folderOf.get(chat.id);
    if (folderId == null) {
      ungrouped.push(chat);
      continue;
    }
    const bucket = members.get(folderId);
    if (bucket) bucket.push(chat);
    else members.set(folderId, [chat]);
  }
  const entries: WorkChatListEntry[] = [];
  for (const folder of folders) {
    const inside = members.get(folder.id) ?? [];
    if (inside.length === 0 && options.hideEmptyFolders) continue;
    entries.push({ kind: "folder", folder, chats: inside });
  }
  for (const chat of ungrouped) entries.push({ kind: "chat", chat });
  return entries;
}

export function folderPromptForChat(
  folders: readonly WorkChatFolder[],
  chatId: string,
): { name: string; prompt: string } | null {
  const folder = folderContainingChat(folders, chatId);
  if (!folder) return null;
  const prompt = folder.prompt.trim();
  return prompt ? { name: folder.name, prompt } : null;
}

/**
 * Put the project brief ahead of the turn rather than after it.
 *
 * An image turn wraps the request in output-shape instructions that have to
 * stay outermost, and in an ordinary turn the thing the user just typed reads
 * best last. Both hold if the brief is a preamble.
 */
export function injectFolderPrompt(text: string, folder: { name: string; prompt: string }): string {
  return [`Project "${folder.name}":`, "", folder.prompt.trim(), "", "---", "", text].join("\n");
}

export function normalizeFolderPrompt(prompt: string): string {
  const trimmed = prompt.replace(/\r\n?/g, "\n").trim();
  return trimmed.length > MAX_PROMPT ? trimmed.slice(0, MAX_PROMPT) : trimmed;
}

export function loadWorkChatFolders(): WorkChatFolder[] {
  try {
    return parseFolders(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return [];
  }
}

export function saveWorkChatFolders(folders: readonly WorkChatFolder[]): void {
  try {
    if (folders.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(folders));
  } catch {
    // private mode / quota
  }
}

export function parseFolders(value: unknown): WorkChatFolder[] {
  if (!Array.isArray(value)) return [];
  const out: WorkChatFolder[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const folder = parseFolder(item);
    if (!folder || seen.has(folder.id)) continue;
    seen.add(folder.id);
    out.push(folder);
  }
  return out;
}

function parseFolder(value: unknown): WorkChatFolder | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as StoredFolder;
  if (typeof rec.id !== "string" || !rec.id) return null;
  if (typeof rec.name !== "string") return null;
  const name = rec.name.trim();
  if (!name) return null;
  return {
    id: rec.id,
    name: name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name,
    prompt: typeof rec.prompt === "string" ? normalizeFolderPrompt(rec.prompt) : "",
    chatIds: Array.isArray(rec.chatIds)
      ? uniqueIds(rec.chatIds.filter((id): id is string => typeof id === "string" && !!id))
      : [],
    collapsed: rec.collapsed === true,
  };
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function withoutChats(folders: WorkChatFolder[], chatIds: readonly string[]): WorkChatFolder[] {
  const drop = new Set(chatIds);
  return folders.map((folder) =>
    folder.chatIds.some((id) => drop.has(id))
      ? { ...folder, chatIds: folder.chatIds.filter((id) => !drop.has(id)) }
      : folder,
  );
}

/** Chat ids in the order the list paints them, folders included. */
export function flattenWorkChatList(entries: readonly WorkChatListEntry[]): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "chat") {
      ids.push(entry.chat.id);
      continue;
    }
    if (entry.folder.collapsed) continue;
    for (const chat of entry.chats) ids.push(chat.id);
  }
  return ids;
}
