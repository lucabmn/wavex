/**
 * Work chats: sessions with no project, cwd, or worktree binding.
 *
 * They are ordinary `Session` records carrying `scope: "work"`, so the
 * transcript machinery, the harness registry, and SQLite persistence are
 * shared with coding sessions. What differs is the absence of a workspace:
 * nothing here resolves a checkout, a branch, or a diff.
 */

import { invoke } from "@tauri-apps/api/core";
import { fuzzyMatch } from "../fuzzy";
import {
  defaultSessionChoice,
  preferredModelId,
  preferredModelSettings,
  resolveModel,
} from "../models";
import type { Attachment, HarnessId, Session } from "../session";
import type { SessionSummary } from "./sessionStore";

/** Placeholder title until the first turn names the chat. */
export const NEW_WORK_CHAT_TITLE = "New chat";

const MAX_TITLE = 72;

/**
 * A work chat still spawns a provider CLI, and a CLI child needs a directory
 * to run in. Rust hands back an app-owned scratch folder so a chat never
 * borrows the user's checkout — nothing the agent does there can touch a
 * project.
 */
let workChatDirPromise: Promise<string> | null = null;

export function workChatDir(): Promise<string> {
  workChatDirPromise ??= invoke<string>("work_chat_dir");
  return workChatDirPromise;
}

/** Test seam. */
export function resetWorkChatDir(): void {
  workChatDirPromise = null;
}

export function isWorkChat(session: { scope?: string }): boolean {
  return session.scope === "work";
}

export function newWorkChat(
  cwd: string,
  harness?: HarnessId,
  model?: string,
  modelSettings?: Record<string, string>,
): Session {
  const choice = harness
    ? { harness, model: model ?? preferredModelId(harness) }
    : defaultSessionChoice();
  const resolved = resolveModel(choice.harness, model ?? choice.model);
  return {
    id: crypto.randomUUID(),
    scope: "work",
    harness: choice.harness,
    model: resolved.id,
    modelSettings: preferredModelSettings(resolved, modelSettings),
    // A chat has no checkout to guard, but the agent is still a coding CLI
    // with shell and file tools. Supervised keeps the approval prompts on.
    runtimeMode: "supervised",
    title: NEW_WORK_CHAT_TITLE,
    cwd,
    blocks: [],
  };
}

/**
 * First line of the opening prompt. Unlike a coding session there is no
 * harness prefix — the chat list is about what was said, not which CLI said
 * it.
 */
export function workChatTitleFromPrompt(prompt: string, attachments: Attachment[] = []): string {
  const line = prompt.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const fromFiles =
    !line && attachments.length > 0
      ? attachments
          .map((file) => file.name)
          .filter(Boolean)
          .slice(0, 3)
          .join(", ")
      : "";
  const seed = line || fromFiles;
  if (!seed) return NEW_WORK_CHAT_TITLE;
  return seed.length > MAX_TITLE ? `${seed.slice(0, MAX_TITLE - 1)}…` : seed;
}

/**
 * True while the title is still something wavex derived, so a generated or
 * derived title may replace it. A rename types over this and sticks.
 */
export function canReplaceWorkChatTitle(current: string, seed: string): boolean {
  const trimmed = current.trim();
  return !trimmed || trimmed === NEW_WORK_CHAT_TITLE || trimmed === seed.trim();
}

export function workChatDisplayTitle(title: string): string {
  return title.trim() || NEW_WORK_CHAT_TITLE;
}

/** A rename that collapses to nothing falls back to the placeholder. */
export function normalizeWorkChatTitle(title: string): string {
  const trimmed = title.trim().replace(/\s+/g, " ");
  if (!trimmed) return NEW_WORK_CHAT_TITLE;
  return trimmed.length > MAX_TITLE ? `${trimmed.slice(0, MAX_TITLE - 1)}…` : trimmed;
}

export type WorkChatListItem = {
  id: string;
  title: string;
  updatedAt: number;
};

export function workChatListItems(
  summaries: SessionSummary[],
  open: Session[] = [],
): WorkChatListItem[] {
  const items = new Map<string, WorkChatListItem>();
  for (const summary of summaries) {
    items.set(summary.id, {
      id: summary.id,
      title: workChatDisplayTitle(summary.title),
      updatedAt: summary.updatedAt,
    });
  }
  // An open chat outranks its stored row: the title may have just changed and
  // a brand-new chat has no row at all yet.
  for (const session of open) {
    if (!isWorkChat(session)) continue;
    items.set(session.id, {
      id: session.id,
      title: workChatDisplayTitle(session.title),
      updatedAt: items.get(session.id)?.updatedAt ?? Date.now(),
    });
  }
  return [...items.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Fuzzy, like the note and project pickers, and ranked before recency. */
export function filterWorkChats(items: WorkChatListItem[], query: string): WorkChatListItem[] {
  const needle = query.trim();
  if (!needle) return items;
  const scored: { item: WorkChatListItem; score: number }[] = [];
  for (const item of items) {
    const hit = fuzzyMatch(needle, item.title);
    if (hit) scored.push({ item, score: hit.score });
  }
  scored.sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt);
  return scored.map((entry) => entry.item);
}
