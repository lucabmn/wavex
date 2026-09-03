import { describe, expect, it } from "vitest";
import type { LiveAgent } from "@/lib/liveAgents";
import {
  approvalKey,
  menuBarStatusLabel,
  pendingApprovalAgents,
  workingAgents,
} from "@/lib/menuBar";

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

const waiting = agent("blocked", {
  needsApproval: true,
  approval: { requestId: 9, kind: "approval", label: "Edited src/App.tsx", answerable: true },
});

describe("pendingApprovalAgents", () => {
  it("splits blocked sessions from ones that only need a way back in", () => {
    const rows = [agent("busy"), waiting, agent("finished", { done: true })];
    expect(pendingApprovalAgents(rows).map((row) => row.id)).toEqual(["blocked"]);
    expect(workingAgents(rows).map((row) => row.id)).toEqual(["busy", "finished"]);
  });
});

describe("approvalKey", () => {
  it("changes when the same session moves on to a new request", () => {
    const next = { ...waiting, approval: { ...waiting.approval!, requestId: 10 } };
    expect(approvalKey(waiting)).not.toBe(approvalKey(next));
  });
});

describe("menuBarStatusLabel", () => {
  it("reports what the user can act on before what is merely running", () => {
    expect(menuBarStatusLabel([])).toBe("All quiet");
    expect(menuBarStatusLabel([agent("busy"), agent("busy-2")])).toBe("2 working");
    expect(menuBarStatusLabel([agent("busy"), waiting])).toBe("1 needs you");
    expect(menuBarStatusLabel([waiting, { ...waiting, id: "blocked-2" }])).toBe("2 need you");
  });

  it("ignores finished sessions that are only waiting to be seen", () => {
    expect(menuBarStatusLabel([agent("finished", { done: true })])).toBe("All quiet");
  });
});
