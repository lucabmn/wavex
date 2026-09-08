import { describe, expect, it } from "vitest";
import { leaf, newTab, newTerminalFile, type WorkspaceTab } from "@/lib/workspace/layout";
import { createProjectDock } from "@/lib/workspace/projectDock";
import type { Session } from "@/lib/session";
import { collectWindowTransfer } from "@/lib/windowTransfer";

function session(id: string, cwd: string): Session {
  return {
    id,
    cwd,
    harness: "cursor",
    title: "",
    blocks: [],
    busy: false,
    model: "",
    modelSettings: {},
    runtimeMode: "supervised",
  };
}

describe("collectWindowTransfer", () => {
  it("collects tabs, sessions, and dirty files for a group", () => {
    const s1 = session("s1", "/Users/me/agent-terminal");
    const s2 = session("s2", "/Users/me/agent-terminal");
    const tabs: WorkspaceTab[] = [
      { ...newTab("s1"), id: "t1" },
      { ...newTab("s2"), id: "t2" },
      { ...newTab("s1"), id: "t3", layout: leaf("s9") },
    ];
    const payload = collectWindowTransfer(tabs, [s1, s2], ["t1", "t2"], "t2", new Set(), "~");
    expect(payload).toMatchObject({
      activeTabId: "t2",
      projectCwd: "/Users/me/agent-terminal",
    });
    expect(payload?.tabs.map((tab) => tab.id)).toEqual(["t1", "t2"]);
    expect(payload?.sessions.map((session) => session.id)).toEqual(["s1", "s2"]);
    expect(payload?.projectDocks).toBeUndefined();
  });

  it("carries a project terminal dock into the new window", () => {
    const s1 = session("s1", "/Users/me/agent-terminal");
    const tabs: WorkspaceTab[] = [{ ...newTab("s1"), id: "t1" }];
    const dock = createProjectDock("/Users/me/agent-terminal", {
      file: newTerminalFile("/Users/me/agent-terminal"),
    });
    const payload = collectWindowTransfer(tabs, [s1], ["t1"], "t1", new Set(), "~", [dock]);
    expect(payload?.projectDocks).toEqual([dock]);
  });
});
