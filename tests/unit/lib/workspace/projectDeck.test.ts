import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/session";
import { newTab, splitPane, type WorkspaceTab } from "@/lib/workspace/layout";
import { deckTabsForActive } from "@/lib/workspace/projectDeck";

function session(id: string, cwd: string): Session {
  return {
    id,
    cwd,
    harness: "claude",
    title: "",
    blocks: [],
    busy: false,
    model: "",
    modelSettings: {},
    runtimeMode: "supervised",
  };
}

function tab(id: string, sessionId: string): WorkspaceTab {
  return { ...newTab(sessionId), id };
}

describe("deckTabsForActive", () => {
  const tabs = [tab("t1", "s1"), tab("t2", "s2"), tab("t3", "s3")];
  const sessions = [session("s1", "/a"), session("s2", "/b"), session("s3", "/a")];

  it("shows the project of the active tab, not the project the rail points at", () => {
    const deck = deckTabsForActive({ tabs, sessions, activeTabId: "t2", projectCwd: "/a" });
    expect(deck.map((entry) => entry.id)).toEqual(["t2"]);
  });

  it("keeps the active tab in the deck for every tab of every project", () => {
    for (const active of tabs) {
      const deck = deckTabsForActive({
        tabs,
        sessions,
        activeTabId: active.id,
        projectCwd: "/somewhere-else",
      });
      expect(deck.map((entry) => entry.id)).toContain(active.id);
    }
  });

  it("groups the tabs that share the active tab's project", () => {
    const deck = deckTabsForActive({ tabs, sessions, activeTabId: "t1", projectCwd: "/b" });
    expect(deck.map((entry) => entry.id)).toEqual(["t1", "t3"]);
  });

  it("keys a split tab on the project the tab reads as", () => {
    const split = {
      ...tabs[0],
      layout: splitPane(tabs[0].layout, "s1", "right", "s4"),
    };
    const deck = deckTabsForActive({
      tabs: [split, tabs[1]],
      sessions: [...sessions, session("s4", "/b")],
      activeTabId: split.id,
      projectCwd: "/b",
    });
    expect(deck.map((entry) => entry.id)).toEqual([split.id]);
  });

  it("stands a projectless tab on its own", () => {
    const deck = deckTabsForActive({
      tabs,
      sessions: [session("s1", "~"), session("s2", "/b"), session("s3", "/a")],
      activeTabId: "t1",
      projectCwd: "/a",
    });
    expect(deck.map((entry) => entry.id)).toEqual(["t1"]);
  });

  it("falls back to the project when no tab is active", () => {
    const deck = deckTabsForActive({ tabs, sessions, activeTabId: null, projectCwd: "/a" });
    expect(deck.map((entry) => entry.id)).toEqual(["t1", "t3"]);
  });
});
