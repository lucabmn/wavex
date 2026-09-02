import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/session";
import type { SessionSummary } from "@/lib/sessions/sessionStore";
import {
  NEW_WORK_CHAT_TITLE,
  canReplaceWorkChatTitle,
  filterWorkChats,
  isWorkChat,
  newWorkChat,
  normalizeWorkChatTitle,
  workChatListItems,
  workChatTitleFromPrompt,
} from "@/lib/sessions/workChats";

function summary(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    cwd: "/tmp/work-chats",
    harness: "cursor",
    model: "gpt-5",
    runtimeMode: "supervised",
    title: "Chat",
    createdAt: 1,
    updatedAt: 1,
    scope: "work",
    ...overrides,
  };
}

describe("newWorkChat", () => {
  it("carries the work scope and stays supervised", () => {
    const chat = newWorkChat("/tmp/work-chats", "claude");
    expect(chat.scope).toBe("work");
    expect(isWorkChat(chat)).toBe(true);
    expect(chat.runtimeMode).toBe("supervised");
    expect(chat.cwd).toBe("/tmp/work-chats");
    expect(chat.title).toBe(NEW_WORK_CHAT_TITLE);
    expect(chat.blocks).toEqual([]);
  });

  it("does not treat a coding session as a work chat", () => {
    expect(isWorkChat({ scope: undefined })).toBe(false);
    expect(isWorkChat({ scope: "coding" })).toBe(false);
  });
});

describe("workChatTitleFromPrompt", () => {
  it("uses the first line without a harness prefix", () => {
    expect(workChatTitleFromPrompt("Draft a changelog entry\nmore detail")).toBe(
      "Draft a changelog entry",
    );
  });

  it("falls back to attachment names when the prompt is empty", () => {
    const title = workChatTitleFromPrompt("  ", [
      { id: "1", name: "chart.png", mimeType: "image/png", kind: "image", size: 10 },
      { id: "2", name: "notes.md", mimeType: "text/markdown", kind: "file", size: 10 },
    ]);
    expect(title).toBe("chart.png, notes.md");
  });

  it("falls back to the placeholder with nothing to derive from", () => {
    expect(workChatTitleFromPrompt("")).toBe(NEW_WORK_CHAT_TITLE);
  });

  it("truncates a long first line", () => {
    const title = workChatTitleFromPrompt("x".repeat(200));
    expect(title).toHaveLength(72);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("canReplaceWorkChatTitle", () => {
  it("replaces a placeholder or the derived seed", () => {
    expect(canReplaceWorkChatTitle(NEW_WORK_CHAT_TITLE, "Draft a changelog")).toBe(true);
    expect(canReplaceWorkChatTitle("Draft a changelog", "Draft a changelog")).toBe(true);
    expect(canReplaceWorkChatTitle("", "Draft a changelog")).toBe(true);
  });

  it("keeps a title the user typed", () => {
    expect(canReplaceWorkChatTitle("Launch copy", "Draft a changelog")).toBe(false);
  });
});

describe("normalizeWorkChatTitle", () => {
  it("collapses whitespace and falls back to the placeholder", () => {
    expect(normalizeWorkChatTitle("  Launch   copy \n")).toBe("Launch copy");
    expect(normalizeWorkChatTitle("   ")).toBe(NEW_WORK_CHAT_TITLE);
  });

  it("truncates an overlong rename", () => {
    expect(normalizeWorkChatTitle("y".repeat(200))).toHaveLength(72);
  });
});

describe("workChatListItems", () => {
  it("orders by most recently updated", () => {
    const items = workChatListItems([
      summary({ id: "a", title: "Older", updatedAt: 10 }),
      summary({ id: "b", title: "Newer", updatedAt: 20 }),
    ]);
    expect(items.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("prefers the open chat's live title over the stored row", () => {
    const open = { ...newWorkChat("/tmp/work-chats", "claude"), id: "a", title: "Renamed" };
    const items = workChatListItems(
      [summary({ id: "a", title: "Stored", updatedAt: 10 })],
      [open as Session],
    );
    expect(items).toEqual([{ id: "a", title: "Renamed", updatedAt: 10 }]);
  });

  it("ignores open coding sessions", () => {
    const coding = { ...newWorkChat("/tmp/work-chats", "claude"), id: "c", scope: undefined };
    const items = workChatListItems([], [coding as Session]);
    expect(items).toEqual([]);
  });
});

describe("workChatListItems ordering key", () => {
  /**
   * A chat with no stored row still needs a sort key. Reading the clock on
   * every call would change it on every streamed batch and defeat the list's
   * memo, so the first-seen stamp has to stick.
   */
  it("keeps a new chat's position stable across renders", () => {
    const chat = { ...newWorkChat("/tmp/work-chats", "claude"), id: "new" };
    const first = workChatListItems([], [chat as Session]);
    const second = workChatListItems([], [{ ...chat, title: "Renamed" } as Session]);
    expect(second[0].updatedAt).toBe(first[0].updatedAt);
    expect(second[0].title).toBe("Renamed");
  });

  it("prefers the stored row's timestamp once the chat is saved", () => {
    const chat = { ...newWorkChat("/tmp/work-chats", "claude"), id: "saved" };
    workChatListItems([], [chat as Session]);
    const items = workChatListItems([summary({ id: "saved", updatedAt: 99 })], [chat as Session]);
    expect(items[0].updatedAt).toBe(99);
  });
});

describe("filterWorkChats", () => {
  const items = [
    { id: "a", title: "Draft a changelog", updatedAt: 2 },
    { id: "b", title: "Summarise the RFC", updatedAt: 1 },
  ];

  it("returns everything for a blank query", () => {
    expect(filterWorkChats(items, "  ")).toEqual(items);
  });

  it("matches on the title", () => {
    expect(filterWorkChats(items, "changelog").map((item) => item.id)).toEqual(["a"]);
    expect(filterWorkChats(items, "summarise").map((item) => item.id)).toEqual(["b"]);
  });

  it("drops chats that do not match at all", () => {
    expect(filterWorkChats(items, "zzz")).toEqual([]);
  });

  it("ranks the stronger match first", () => {
    expect(filterWorkChats(items, "draft")[0].id).toBe("a");
  });
});
