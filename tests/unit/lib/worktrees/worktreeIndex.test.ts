import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetWorktree,
  isWorktreePath,
  loadWorktreeIndex,
  rememberWorktree,
  rememberWorktrees,
  worktreeRepo,
} from "@/lib/worktrees/worktreeIndex";

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
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
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

beforeEach(() => {
  mockLocalStorage();
});

describe("rememberWorktrees", () => {
  it("maps every worktree back to its repository", () => {
    rememberWorktrees("/code/app", ["/trees/app/one", "/trees/app/two"]);
    expect(worktreeRepo("/trees/app/one")).toBe("/code/app");
    expect(isWorktreePath("/trees/app/two")).toBe(true);
    expect(isWorktreePath("/code/app")).toBe(false);
  });

  it("replaces what was known about that repository only", () => {
    rememberWorktrees("/code/app", ["/trees/app/one"]);
    rememberWorktrees("/code/other", ["/trees/other/one"]);
    rememberWorktrees("/code/app", ["/trees/app/two"]);

    expect(worktreeRepo("/trees/app/one")).toBeNull();
    expect(worktreeRepo("/trees/app/two")).toBe("/code/app");
    expect(worktreeRepo("/trees/other/one")).toBe("/code/other");
  });

  it("never files a repository as its own worktree", () => {
    rememberWorktrees("/code/app", ["/code/app", "/trees/app/one"]);
    expect(worktreeRepo("/code/app")).toBeNull();
  });

  it("keys on the normalized path", () => {
    rememberWorktrees("/code/app/", ["/trees/app/one/"]);
    expect(worktreeRepo("/trees/app/one")).toBe("/code/app");
  });
});

describe("rememberWorktree", () => {
  it("adds one worktree without dropping its siblings", () => {
    rememberWorktrees("/code/app", ["/trees/app/one"]);
    rememberWorktree("/code/app", "/trees/app/two");
    expect(Object.keys(loadWorktreeIndex())).toEqual(["/trees/app/one", "/trees/app/two"]);
  });
});

describe("forgetWorktree", () => {
  it("drops a removed worktree", () => {
    rememberWorktrees("/code/app", ["/trees/app/one", "/trees/app/two"]);
    forgetWorktree("/trees/app/one");
    expect(worktreeRepo("/trees/app/one")).toBeNull();
    expect(worktreeRepo("/trees/app/two")).toBe("/code/app");
  });
});

describe("loadWorktreeIndex", () => {
  it("survives a corrupted entry", () => {
    localStorage.setItem("wavex.worktreeIndex", "not json");
    expect(loadWorktreeIndex()).toEqual({});

    localStorage.setItem("wavex.worktreeIndex", JSON.stringify({ "/trees/one": 5 }));
    expect(loadWorktreeIndex()).toEqual({});
  });
});
