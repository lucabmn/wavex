import { describe, expect, it } from "vitest";
import {
  conversationTitle,
  isBlankSession,
  isBlankWorkspaceTab,
  openSessionIds,
  titleTabsEqual,
  toTitleTab,
  type TitleTab,
} from "@/lib/workspace/titleTab";
import { newFileTab, newTab, openEditorTab } from "@/lib/workspace/layout";
import type { Block, Session } from "@/lib/session";

function block(overrides: Partial<Block> & Pick<Block, "id" | "role">): Block {
  return { text: "", ...overrides };
}

function session(overrides: Partial<Session> & Pick<Session, "id">): Session {
  return {
    harness: "claude",
    model: "",
    modelSettings: {},
    runtimeMode: "local",
    title: "claude",
    cwd: "/tmp/web",
    blocks: [],
    ...overrides,
  } as Session;
}

const emptyTitleTab: TitleTab = {
  id: "t1",
  project: "web",
  title: "",
  more: [],
  sessionCount: 1,
  harnesses: [],
  busyHarnesses: [],
  files: [],
};

describe("conversationTitle", () => {
  it("blanks a session that still carries its harness placeholder", () => {
    expect(conversationTitle(session({ id: "s1", title: "claude" }))).toBe("");
  });

  it("keeps a real title", () => {
    expect(conversationTitle(session({ id: "s1", title: "Fix the parser" }))).toBe(
      "Fix the parser",
    );
  });
});

describe("isBlankSession", () => {
  it("is true before the first user turn", () => {
    expect(isBlankSession(session({ id: "s1" }))).toBe(true);
  });

  it("is false once the user has said something", () => {
    expect(isBlankSession(session({ id: "s1", blocks: [block({ id: "b1", role: "user" })] }))).toBe(
      false,
    );
  });

  it("is false while a turn is in flight, even with no user block", () => {
    expect(isBlankSession(session({ id: "s1", busy: true }))).toBe(false);
  });

  it("is false for a missing session", () => {
    expect(isBlankSession(undefined)).toBe(false);
  });
});

describe("isBlankWorkspaceTab", () => {
  it("is true for a fresh single-pane tab", () => {
    const s = session({ id: "s1" });
    expect(isBlankWorkspaceTab(newTab("s1"), [s])).toBe(true);
  });

  it("is false once a file is open in the tab", () => {
    const tab = openEditorTab(newTab("s1"), newFileTab("/tmp/web/a.ts", "/tmp/web"));
    expect(isBlankWorkspaceTab(tab, [session({ id: "s1" })])).toBe(false);
  });
});

describe("openSessionIds", () => {
  it("collects the leaves of every tab", () => {
    expect(openSessionIds([newTab("s1"), newTab("s2")])).toEqual(new Set(["s1", "s2"]));
  });
});

describe("titleTabsEqual", () => {
  it("is true for structurally identical tabs", () => {
    expect(titleTabsEqual([emptyTitleTab], [{ ...emptyTitleTab }])).toBe(true);
  });

  it("sees a changed title", () => {
    expect(titleTabsEqual([emptyTitleTab], [{ ...emptyTitleTab, title: "x" }])).toBe(false);
  });

  it("sees a changed harness list", () => {
    expect(titleTabsEqual([emptyTitleTab], [{ ...emptyTitleTab, harnesses: ["claude"] }])).toBe(
      false,
    );
  });

  it("sees a different length", () => {
    expect(titleTabsEqual([emptyTitleTab], [])).toBe(false);
  });
});

describe("toTitleTab", () => {
  it("names the project from the focused session's cwd", () => {
    const view = toTitleTab(newTab("s1"), [session({ id: "s1" })], new Set());
    expect(view.project).toBe("web");
    expect(view.sessionCount).toBe(1);
    expect(view.harnesses).toEqual(["claude"]);
    expect(view.multiPane).toBe(false);
  });

  it("lists a busy harness separately from the plain one", () => {
    const view = toTitleTab(newTab("s1"), [session({ id: "s1", busy: true })], new Set());
    expect(view.busyHarnesses).toEqual(["claude"]);
    expect(view.harnesses).toEqual(["claude"]);
  });

  it("lists open files by basename", () => {
    const tab = openEditorTab(newTab("s1"), newFileTab("/tmp/web/parser.ts", "/tmp/web"));
    const view = toTitleTab(tab, [session({ id: "s1" })], new Set());
    expect(view.files).toEqual(["parser.ts"]);
  });

  it("marks the tab dirty when an open file has unsaved edits", () => {
    const file = newFileTab("/tmp/web/parser.ts", "/tmp/web");
    const tab = openEditorTab(newTab("s1"), file);
    const view = toTitleTab(tab, [session({ id: "s1" })], new Set([file.id]));
    expect(view.dirty).toBe(true);
  });

  it("falls back to ~ with no session and no file", () => {
    expect(toTitleTab(newTab("s1"), [], new Set()).project).toBe("~");
  });
});
