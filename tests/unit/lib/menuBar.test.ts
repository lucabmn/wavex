import { describe, expect, it } from "vitest";
import type { LiveAgent, LiveApproval } from "@/lib/liveAgents";
import { menuBarStatusLabel, pendingRequests, requestKey, unblockedAgents } from "@/lib/menuBar";

function approval(requestId: number, label: string): LiveApproval {
  return { requestId, kind: "approval", label, answerable: true };
}

function agent(id: string, patch: Partial<LiveAgent> = {}): LiveAgent {
  return {
    id,
    cwd: "/tmp/project",
    title: id,
    harness: "claude",
    activity: "Working",
    startedAt: 1_000,
    needsApproval: false,
    done: false,
    ...patch,
  };
}

const blocked = agent("blocked", {
  needsApproval: true,
  approvals: [approval(9, "Edited src/App.tsx")],
});

describe("pendingRequests", () => {
  it("splits blocked sessions from ones that only need a way back in", () => {
    const rows = [agent("busy"), blocked, agent("finished", { done: true })];
    expect(pendingRequests(rows).map((request) => request.agent.id)).toEqual(["blocked"]);
    expect(unblockedAgents(rows).map((row) => row.id)).toEqual(["busy", "finished"]);
  });

  it("lists a stacked session once per outstanding request", () => {
    const stacked = agent("stacked", {
      needsApproval: true,
      approvals: [approval(1, "Read a.ts"), approval(2, "Read b.ts")],
    });
    expect(pendingRequests([stacked]).map((request) => request.approval.requestId)).toEqual([1, 2]);
  });
});

describe("requestKey", () => {
  it("changes when the same session moves on to a new request", () => {
    const [first] = pendingRequests([blocked]);
    const [next] = pendingRequests([{ ...blocked, approvals: [approval(10, "Read b.ts")] }]);
    expect(requestKey(first)).not.toBe(requestKey(next));
  });
});

describe("menuBarStatusLabel", () => {
  it("reports what the user can act on before what is merely running", () => {
    expect(menuBarStatusLabel([])).toBe("All quiet");
    expect(menuBarStatusLabel([agent("busy"), agent("busy-2")])).toBe("2 working");
    expect(menuBarStatusLabel([agent("busy"), blocked])).toBe("1 needs you");
    expect(menuBarStatusLabel([blocked, { ...blocked, id: "blocked-2" }])).toBe("2 need you");
  });

  it("counts requests, not blocked sessions", () => {
    const stacked = agent("stacked", {
      needsApproval: true,
      approvals: [approval(1, "Read a.ts"), approval(2, "Read b.ts")],
    });
    expect(menuBarStatusLabel([stacked])).toBe("2 need you");
  });

  it("ignores finished sessions that are only waiting to be seen", () => {
    expect(menuBarStatusLabel([agent("finished", { done: true })])).toBe("All quiet");
  });
});
