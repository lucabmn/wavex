import { describe, expect, it } from "vitest";
import {
  leaf,
  leafIds,
  newFileTab,
  newPlanTab,
  newTab,
  openEditorTab,
  type WorkspaceTab,
} from "@/lib/workspace/layout";
import { newSession, type Session } from "@/lib/session";
import {
  removeSessionFromWorkspace,
  type SessionWorkspaceRemoval,
} from "@/lib/sessions/sessionWorkspaceLifecycle";

function session(id: string, cwd = "/projects/wavex"): Session {
  return { ...newSession("cursor", cwd), id };
}

function tab(id: string, sessionId: string): WorkspaceTab {
  return { ...newTab(sessionId), id };
}

function remove(input: {
  tabs: WorkspaceTab[];
  sessions: Session[];
  sessionId: string;
  activeTabId: string;
  scope?: "project" | "workspace";
}): SessionWorkspaceRemoval {
  return removeSessionFromWorkspace({
    ...input,
    scope: input.scope ?? "workspace",
    createReplacement: (seed) => session("replacement", seed?.cwd),
  });
}

describe("removeSessionFromWorkspace", () => {
  it("closes the sole-session tab with its files instead of promoting them", () => {
    const file = newFileTab("/projects/wavex/README.md", "/projects/wavex");
    const closing = {
      ...tab("closing", "s1"),
      layout: {
        type: "split" as const,
        id: "split",
        dir: "right" as const,
        children: [leaf("s1"), leaf("editor")],
        sizes: [0.5, 0.5],
      },
      focusedId: "s1",
      editorPanes: [{ id: "editor", files: [file], activeFileId: file.id }],
    };
    const result = remove({
      tabs: [closing, tab("other", "s2")],
      sessions: [session("s1"), session("s2", "/projects/ruler")],
      sessionId: "s1",
      activeTabId: "closing",
    });

    expect(result.closedTabs.map((entry) => entry.id)).toEqual(["closing"]);
    expect(result.tabs.map((entry) => entry.id)).toEqual(["other"]);
    expect(result.sessions.map((entry) => entry.id)).toEqual(["s2"]);
    expect(result.activeTabId).toBe("other");
  });

  it("retains file panes and another conversation in a shared workspace", () => {
    const file = newFileTab("/projects/wavex/README.md", "/projects/wavex");
    const shared: WorkspaceTab = {
      ...tab("shared", "s1"),
      layout: {
        type: "split" as const,
        id: "outer",
        dir: "right" as const,
        children: [
          leaf("s1"),
          {
            type: "split",
            id: "inner",
            dir: "down",
            children: [leaf("s2"), leaf("editor")],
            sizes: [0.5, 0.5],
          },
        ],
        sizes: [0.5, 0.5],
      },
      focusedId: "s1",
      editorPanes: [{ id: "editor", files: [file], activeFileId: file.id }],
    };
    const result = remove({
      tabs: [shared],
      sessions: [session("s1"), session("s2")],
      sessionId: "s1",
      activeTabId: "shared",
    });

    expect(result.closedTabs).toEqual([]);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0]?.editorPanes).toEqual(shared.editorPanes);
    expect(result.tabs[0]?.layout).toEqual({
      type: "split",
      id: "inner",
      dir: "down",
      children: [leaf("s2"), leaf("editor")],
      sizes: [0.5, 0.5],
    });
    expect(result.sessions.map((entry) => entry.id)).toEqual(["s2"]);
  });

  it("closes session-owned plans with the session while preserving other files", () => {
    const ownPlan = newPlanTab("s1", "p1", "Own plan", "/projects/wavex");
    const readme = newFileTab("/projects/wavex/README.md", "/projects/wavex");
    const shared: WorkspaceTab = {
      ...tab("shared", "s1"),
      layout: {
        type: "split" as const,
        id: "split",
        dir: "right" as const,
        children: [leaf("s1"), leaf("s2"), leaf("editor")],
        sizes: [1 / 3, 1 / 3, 1 / 3],
      },
      focusedId: "s1",
      editorPanes: [
        {
          id: "editor",
          files: [ownPlan, readme],
          activeFileId: ownPlan.id,
        },
      ],
    };
    const result = remove({
      tabs: [shared],
      sessions: [session("s1"), session("s2")],
      sessionId: "s1",
      activeTabId: "shared",
    });

    expect(result.tabs[0]?.editorPanes[0]?.files).toEqual([readme]);
    expect(result.tabs[0]?.editorPanes[0]?.activeFileId).toBe(readme.id);
  });

  it("replaces the final project tab with a blank session", () => {
    const result = remove({
      tabs: [tab("only", "s1")],
      sessions: [session("s1")],
      sessionId: "s1",
      activeTabId: "only",
      scope: "project",
    });

    expect(result.closedTabs.map((entry) => entry.id)).toEqual(["only"]);
    expect(result.tabs[0]?.id).toBe("only");
    expect(result.tabs[0]?.focusedId).toBe("replacement");
    expect(result.sessions.map((entry) => entry.id)).toEqual(["replacement"]);
  });

  it("does not leave the project when closing its final tab in project scope", () => {
    const result = remove({
      tabs: [tab("ruler", "r1"), tab("wavex", "s1")],
      sessions: [session("r1", "/projects/ruler"), session("s1")],
      sessionId: "s1",
      activeTabId: "wavex",
      scope: "project",
    });

    expect(result.tabs.map((entry) => entry.id)).toEqual(["ruler", "wavex"]);
    expect(result.activeTabId).toBe("wavex");
    expect(result.tabs[1]?.focusedId).toBe("replacement");
  });

  it("removes only the archived session's plans in a shared workspace", () => {
    const own = newPlanTab("s1", "p1", "Own plan", "/projects/wavex");
    const other = newPlanTab("s2", "p2", "Other plan", "/projects/wavex");
    const readme = newFileTab("/projects/wavex/README.md", "/projects/wavex");
    const shared: WorkspaceTab = {
      ...tab("shared", "s1"),
      layout: {
        type: "split",
        id: "split",
        dir: "right",
        children: [leaf("s1"), leaf("s2")],
        sizes: [0.5, 0.5],
      },
    };
    const withFiles = [own, other, readme].reduce(openEditorTab, shared);
    const result = remove({
      tabs: [withFiles],
      sessions: [session("s1"), session("s2")],
      sessionId: "s1",
      activeTabId: "shared",
    });
    expect(result.tabs[0].editorPanes[0].files).toEqual([other, readme]);
    expect(leafIds(result.tabs[0].layout)).not.toContain("s1");
  });

  it("removes plan panes even after their conversation moved to another tab", () => {
    const plan = newPlanTab("s1", "p1", "Plan", "/projects/wavex");
    const other = openEditorTab(tab("other", "s2"), plan);
    const result = remove({
      tabs: [tab("own", "s1"), other],
      sessions: [session("s1"), session("s2")],
      sessionId: "s1",
      activeTabId: "other",
    });
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].editorPanes).toEqual([]);
    expect(result.tabs[0].focusedId).toBe("s2");
    expect(result.tabs[0].layout).toEqual(leaf("s2"));
  });

  it("replaces a standalone plan pane without leaving a dangling layout leaf", () => {
    const plan = newPlanTab("s1", "p1", "Plan", "/projects/wavex");
    const only: WorkspaceTab = {
      ...tab("only", "editor"),
      editorPanes: [{ id: "editor", files: [plan], activeFileId: plan.id }],
    };
    const result = remove({
      tabs: [only],
      sessions: [session("s1")],
      sessionId: "s1",
      activeTabId: "only",
    });
    expect(result.tabs[0].editorPanes).toEqual([]);
    expect(result.tabs[0].layout).toEqual(leaf("replacement"));
    expect(result.sessions.map((s) => s.id)).toEqual(["replacement"]);
  });
});
