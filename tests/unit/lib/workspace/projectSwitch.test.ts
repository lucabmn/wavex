import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/session";
import type { SessionSummary } from "@/lib/sessions/sessionStore";
import { newTab, type WorkspaceTab } from "@/lib/workspace/layout";
import { planProjectSwitch, topProjectSession } from "@/lib/workspace/projectSwitch";

function session(id: string, cwd: string, spoken = true): Session {
  return {
    id,
    cwd,
    harness: "claude",
    title: "",
    blocks: spoken ? [{ id: `${id}-b`, role: "user", text: "hi" }] : [],
    busy: false,
    model: "",
    modelSettings: {},
    runtimeMode: "supervised",
  };
}

function tab(id: string, sessionId: string): WorkspaceTab {
  return { ...newTab(sessionId), id };
}

function summary(id: string, cwd: string, patch: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    hostId: "local",
    cwd,
    harness: "claude",
    model: "",
    runtimeMode: "supervised",
    title: id,
    createdAt: 0,
    updatedAt: 1,
    scope: "coding",
    ...patch,
  };
}

describe("topProjectSession", () => {
  it("prefers a pinned row over a newer one", () => {
    const rows = [
      summary("recent", "/p", { updatedAt: 90 }),
      summary("pinned", "/p", { updatedAt: 10, pinned: true }),
    ];
    expect(topProjectSession(rows, "/p")?.id).toBe("pinned");
  });

  it("skips archived rows and rows of another project", () => {
    const rows = [
      summary("archived", "/p", { updatedAt: 90, archived: true }),
      summary("elsewhere", "/other", { updatedAt: 80 }),
      summary("live", "/p", { updatedAt: 20 }),
    ];
    expect(topProjectSession(rows, "/p")?.id).toBe("live");
  });
});

describe("planProjectSwitch", () => {
  const base = { tabs: [tab("t1", "s1")], sessions: [session("s1", "/a")], activeTabId: "t1" };

  it("stays put when the project is already focused", () => {
    expect(planProjectSwitch({ ...base, rows: [], path: "/a" })).toEqual({ kind: "stay" });
  });

  it("focuses an open tab of the project", () => {
    const plan = planProjectSwitch({
      tabs: [tab("t1", "s1"), tab("t2", "s2")],
      sessions: [session("s1", "/a"), session("s2", "/b")],
      activeTabId: "t1",
      rows: [summary("s9", "/b", { updatedAt: 99 })],
      path: "/b",
    });
    expect(plan).toEqual({ kind: "focusTab", tabId: "t2" });
  });

  it("opens the project's top session instead of creating one", () => {
    const plan = planProjectSwitch({
      ...base,
      rows: [summary("s7", "/b", { updatedAt: 5 }), summary("s8", "/b", { updatedAt: 50 })],
      path: "/b",
    });
    expect(plan).toEqual({ kind: "openSession", sessionId: "s8", hostId: "local" });
  });

  it("prefers the persisted session over retargeting a blank one", () => {
    const plan = planProjectSwitch({
      tabs: [tab("t1", "s1")],
      sessions: [session("s1", "/a", false)],
      activeTabId: "t1",
      rows: [summary("s8", "/b")],
      path: "/b",
    });
    expect(plan).toEqual({ kind: "openSession", sessionId: "s8", hostId: "local" });
  });

  it("focuses an open tab even when the current session is blank", () => {
    const plan = planProjectSwitch({
      tabs: [tab("t1", "s1"), tab("t2", "s2")],
      sessions: [session("s1", "/a", false), session("s2", "/b")],
      activeTabId: "t1",
      rows: [],
      path: "/b",
    });
    expect(plan).toEqual({ kind: "focusTab", tabId: "t2" });
  });

  it("retargets a blank session for a project with no history", () => {
    const plan = planProjectSwitch({
      tabs: [tab("t1", "s1")],
      sessions: [session("s1", "/a", false)],
      activeTabId: "t1",
      rows: [],
      path: "/b",
    });
    expect(plan).toEqual({ kind: "retargetBlank", sessionId: "s1" });
  });

  it("creates a session only when nothing exists for the project", () => {
    expect(planProjectSwitch({ ...base, rows: [], path: "/b" })).toEqual({ kind: "createSession" });
  });
});
