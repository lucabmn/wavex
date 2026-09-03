import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkChatListItem } from "@/lib/sessions/workChats";
import {
  addChatToFolder,
  applyWorkChatDrop,
  buildWorkChatList,
  createWorkChatFolder,
  deleteFolder,
  flattenWorkChatList,
  folderContainingChat,
  folderPromptForChat,
  injectFolderPrompt,
  loadWorkChatFolders,
  pruneWorkChatFolders,
  removeChatFromFolders,
  renameFolder,
  saveWorkChatFolders,
  setFolderCollapsed,
  setFolderPrompt,
  uniqueFolderName,
  type WorkChatFolder,
} from "@/lib/sessions/workChatFolders";

function folder(
  id: string,
  chatIds: string[] = [],
  overrides: Partial<WorkChatFolder> = {},
): WorkChatFolder {
  return { id, name: id, prompt: "", chatIds, collapsed: false, ...overrides };
}

function chat(id: string, overrides: Partial<WorkChatListItem> = {}): WorkChatListItem {
  return { id, title: id, updatedAt: 0, pinned: false, archived: false, ...overrides };
}

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
      clear: () => {
        data.clear();
      },
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
    configurable: true,
  });
}

beforeEach(mockLocalStorage);

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

describe("uniqueFolderName", () => {
  it("uses New project, then numbers", () => {
    expect(uniqueFolderName([])).toBe("New project");
    expect(uniqueFolderName([folder("a", [], { name: "New project" })])).toBe("New project 2");
  });
});

describe("createWorkChatFolder", () => {
  it("creates an empty project", () => {
    const { folders, id } = createWorkChatFolder([]);
    expect(folders).toHaveLength(1);
    expect(folders[0].id).toBe(id);
    expect(folders[0].chatIds).toEqual([]);
    expect(folders[0].prompt).toBe("");
  });

  it("moves seeded chats out of the projects they were in", () => {
    const existing = [folder("f1", ["a", "b"])];
    const { folders } = createWorkChatFolder(existing, "Redesign", ["a"]);
    expect(folders[0].chatIds).toEqual(["b"]);
    expect(folders[1].name).toBe("Redesign");
    expect(folders[1].chatIds).toEqual(["a"]);
  });
});

describe("membership", () => {
  it("moves a chat between projects and expands the destination", () => {
    const folders = addChatToFolder(
      [folder("f1", ["a"]), folder("f2", [], { collapsed: true })],
      "f2",
      "a",
    );
    expect(folders[0].chatIds).toEqual([]);
    expect(folders[1].chatIds).toEqual(["a"]);
    expect(folders[1].collapsed).toBe(false);
  });

  it("keeps an emptied project", () => {
    const folders = removeChatFromFolders([folder("f1", ["a"])], "a");
    expect(folders).toHaveLength(1);
    expect(folders[0].chatIds).toEqual([]);
  });

  it("is a no-op when the chat is already there", () => {
    const before = [folder("f1", ["a"])];
    expect(addChatToFolder(before, "f1", "a")).toBe(before);
  });

  it("deleting a project keeps its chats out of every other project", () => {
    const folders = deleteFolder([folder("f1", ["a"]), folder("f2", ["b"])], "f1");
    expect(folders.map((entry) => entry.id)).toEqual(["f2"]);
    expect(folderContainingChat(folders, "a")).toBeUndefined();
  });
});

describe("renameFolder and setFolderPrompt", () => {
  it("falls back to a generated name when the rename is blank", () => {
    const folders = renameFolder([folder("f1", [], { name: "Old" })], "f1", "   ");
    expect(folders[0].name).toBe("New project");
  });

  it("stores a trimmed prompt", () => {
    const folders = setFolderPrompt([folder("f1")], "f1", "  Ship the redesign.\n\n ");
    expect(folders[0].prompt).toBe("Ship the redesign.");
  });

  it("returns the same array when nothing changed", () => {
    const before = [folder("f1", [], { collapsed: true })];
    expect(setFolderCollapsed(before, "f1", true)).toBe(before);
  });
});

describe("applyWorkChatDrop", () => {
  it("joins the project the drop landed on", () => {
    const { folders } = applyWorkChatDrop([folder("f1")], "a", { kind: "folder", id: "f1" });
    expect(folders[0].chatIds).toEqual(["a"]);
  });

  it("joins the project of the chat it landed on", () => {
    const { folders } = applyWorkChatDrop([folder("f1", ["b"])], "a", { kind: "chat", id: "b" });
    expect(folders[0].chatIds).toEqual(["b", "a"]);
  });

  it("opens a new project around two ungrouped chats", () => {
    const { folders, createdId } = applyWorkChatDrop([], "a", { kind: "chat", id: "b" });
    expect(createdId).toBeTruthy();
    expect(folders[0].chatIds).toEqual(["b", "a"]);
  });

  it("dropping on the list background leaves the project", () => {
    const { folders } = applyWorkChatDrop([folder("f1", ["a"])], "a", { kind: "root" });
    expect(folders[0].chatIds).toEqual([]);
  });

  it("ignores a drop on itself", () => {
    const before = [folder("f1", ["a"])];
    expect(applyWorkChatDrop(before, "a", { kind: "chat", id: "a" }).folders).toBe(before);
  });
});

describe("pruneWorkChatFolders", () => {
  it("drops unknown chats but keeps the project that empties", () => {
    const folders = pruneWorkChatFolders([folder("f1", ["a", "gone"])], new Set(["a"]));
    expect(folders[0].chatIds).toEqual(["a"]);
    expect(pruneWorkChatFolders([folder("f1", ["gone"])], new Set())).toEqual([folder("f1", [])]);
  });
});

describe("buildWorkChatList", () => {
  it("puts projects first and keeps the caller's chat order inside them", () => {
    const entries = buildWorkChatList(
      [folder("f1", ["b", "a"])],
      [chat("a"), chat("b"), chat("c")],
    );
    expect(entries[0]).toMatchObject({ kind: "folder" });
    expect(entries[0].kind === "folder" && entries[0].chats.map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
    expect(entries[1]).toMatchObject({ kind: "chat", chat: { id: "c" } });
  });

  it("still paints an empty project, unless the list is a search result", () => {
    expect(buildWorkChatList([folder("f1")], [])).toHaveLength(1);
    expect(buildWorkChatList([folder("f1")], [], { hideEmptyFolders: true })).toHaveLength(0);
  });

  it("flattens to the painted order, skipping collapsed projects", () => {
    const folders = [folder("f1", ["a"]), folder("f2", ["b"], { collapsed: true })];
    const entries = buildWorkChatList(folders, [chat("a"), chat("b"), chat("c")]);
    expect(flattenWorkChatList(entries)).toEqual(["a", "c"]);
  });
});

describe("folderPromptForChat", () => {
  it("is null without a project or without a brief", () => {
    expect(folderPromptForChat([], "a")).toBeNull();
    expect(folderPromptForChat([folder("f1", ["a"])], "a")).toBeNull();
  });

  it("returns the project name and brief", () => {
    const folders = [folder("f1", ["a"], { name: "Redesign", prompt: "Ship it." })];
    expect(folderPromptForChat(folders, "a")).toEqual({ name: "Redesign", prompt: "Ship it." });
  });
});

describe("injectFolderPrompt", () => {
  it("puts the brief ahead of the turn", () => {
    const text = injectFolderPrompt("Draft the copy.", { name: "Redesign", prompt: "Ship it." });
    expect(text.startsWith('Project "Redesign":')).toBe(true);
    expect(text.endsWith("Draft the copy.")).toBe(true);
  });
});

describe("persistence", () => {
  it("round-trips an empty project with its brief", () => {
    saveWorkChatFolders([folder("f1", [], { name: "Redesign", prompt: "Ship it." })]);
    expect(loadWorkChatFolders()).toEqual([
      { id: "f1", name: "Redesign", prompt: "Ship it.", chatIds: [], collapsed: false },
    ]);
  });

  it("clears storage when the last project goes", () => {
    saveWorkChatFolders([folder("f1")]);
    saveWorkChatFolders([]);
    expect(localStorage.getItem("wavex.workChatFolders")).toBeNull();
    expect(loadWorkChatFolders()).toEqual([]);
  });

  it("skips malformed and duplicated rows", () => {
    localStorage.setItem(
      "wavex.workChatFolders",
      JSON.stringify([
        { id: "f1", name: "One", chatIds: ["a", "a"] },
        { id: "f1", name: "Duplicate" },
        { id: "", name: "No id" },
        { id: "f2", name: "  " },
        "nonsense",
      ]),
    );
    expect(loadWorkChatFolders()).toEqual([
      { id: "f1", name: "One", prompt: "", chatIds: ["a"], collapsed: false },
    ]);
  });
});
