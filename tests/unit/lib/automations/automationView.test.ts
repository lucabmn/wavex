import { describe, expect, it } from "vitest";
import {
  automationCounts,
  automationStatus,
  filterAutomations,
  latestRuns,
  nextRunLine,
  relativeMoment,
  runDurationText,
  scheduleLine,
} from "@/lib/automations/automationView";
import type { Automation, AutomationRun } from "@/lib/automations/automation";

const NOW = Date.UTC(2025, 0, 1, 12, 0);

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "a1",
    name: "Nightly triage",
    prompt: "Triage new issues",
    projectRef: "/repo/app",
    cwd: "/repo/app",
    hostId: "local",
    harness: "claude",
    model: "",
    runtimeMode: "supervised",
    schedule: { kind: "interval", every: 4, unit: "hours", anchorMs: 0 },
    timeZone: "UTC",
    dstPolicy: "shift",
    overlapPolicy: "skip",
    missedPolicy: "once",
    notify: true,
    enabled: true,
    nextDueAt: NOW + 3_600_000,
    runCount: 3,
    pausedReason: "",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "r1",
    automationId: "a1",
    sessionId: "s1",
    dueAt: NOW,
    startedAt: NOW,
    finishedAt: NOW + 90_000,
    status: "success",
    ...overrides,
  };
}

describe("automationStatus", () => {
  it("reads the row rather than a second stored flag", () => {
    expect(automationStatus(automation(), { running: true })).toBe("running");
    expect(automationStatus(automation(), { running: false })).toBe("active");
    expect(
      automationStatus(automation(), { running: false, lastRun: run({ status: "failed" }) }),
    ).toBe("failing");
    expect(
      automationStatus(automation({ enabled: false, pausedReason: "manual" }), { running: false }),
    ).toBe("paused");
    expect(
      automationStatus(automation({ enabled: false, pausedReason: "max-runs" }), {
        running: false,
      }),
    ).toBe("finished");
  });
});

describe("latestRuns", () => {
  it("keeps the newest run per automation", () => {
    const map = latestRuns([
      run({ id: "r1", startedAt: 1 }),
      run({ id: "r2", startedAt: 5 }),
      run({ id: "r3", automationId: "a2", startedAt: 2 }),
    ]);
    expect(map.get("a1")?.id).toBe("r2");
    expect(map.get("a2")?.id).toBe("r3");
  });
});

describe("filterAutomations", () => {
  const rows = [
    automation({ id: "a1", name: "Nightly triage", cwd: "/repo/app", projectRef: "/repo/app" }),
    automation({
      id: "a2",
      name: "Weekly digest",
      prompt: "Summarize the changelog",
      cwd: "/repo/site",
      projectRef: "/repo/site",
      enabled: false,
      pausedReason: "manual",
    }),
  ];
  const statusOf = (entry: Automation) => automationStatus(entry, { running: false });

  it("matches on name, prompt, and project", () => {
    expect(filterAutomations(rows, { text: "triage" }, statusOf).map((a) => a.id)).toEqual(["a1"]);
    expect(filterAutomations(rows, { text: "changelog" }, statusOf).map((a) => a.id)).toEqual([
      "a2",
    ]);
    expect(filterAutomations(rows, { text: "site" }, statusOf).map((a) => a.id)).toEqual(["a2"]);
  });

  it("filters by status and by project", () => {
    expect(filterAutomations(rows, { status: "paused" }, statusOf).map((a) => a.id)).toEqual([
      "a2",
    ]);
    expect(filterAutomations(rows, { project: "/repo/app" }, statusOf).map((a) => a.id)).toEqual([
      "a1",
    ]);
    expect(filterAutomations(rows, { status: "all" }, statusOf)).toHaveLength(2);
  });

  it("counts every status for the filter bar", () => {
    expect(automationCounts(rows, statusOf)).toMatchObject({ all: 2, active: 1, paused: 1 });
  });
});

describe("nextRunLine", () => {
  it("never offers a next run for something that will not run", () => {
    expect(nextRunLine(automation(), "active", NOW)).toBe("Next run 1 January 2025 at 13:00");
    expect(nextRunLine(automation(), "running", NOW)).toBe("Running now");
    expect(
      nextRunLine(automation({ enabled: false, pausedReason: "failures" }), "paused", NOW),
    ).toBe("Paused after repeated failures.");
    expect(
      nextRunLine(automation({ enabled: false, pausedReason: "max-runs" }), "finished", NOW),
    ).toBe("Finished — it reached its run limit.");
    expect(nextRunLine(automation({ nextDueAt: null }), "active", NOW)).toBe("Nothing scheduled.");
    expect(nextRunLine(automation({ nextDueAt: NOW - 1 }), "active", NOW)).toBe("Due now.");
  });
});

describe("scheduleLine", () => {
  it("always names the zone the schedule is written in", () => {
    expect(scheduleLine(automation({ timeZone: "Europe/Berlin" }))).toBe(
      "Every 4 hours · Europe/Berlin",
    );
  });
});

describe("relativeMoment", () => {
  it("reads forwards and backwards", () => {
    expect(relativeMoment(NOW + 30_000, NOW)).toBe("in 30s");
    expect(relativeMoment(NOW + 20 * 60_000, NOW)).toBe("in 20m");
    expect(relativeMoment(NOW + 3 * 3_600_000 + 20 * 60_000, NOW)).toBe("in 3h 20m");
    expect(relativeMoment(NOW + 4 * 3_600_000, NOW)).toBe("in 4h");
    expect(relativeMoment(NOW - 4 * 60_000, NOW)).toBe("4m ago");
    expect(relativeMoment(NOW - 3 * 86_400_000, NOW)).toBe("3d ago");
  });
});

describe("runDurationText", () => {
  it("measures a finished run, and a going one against now", () => {
    expect(runDurationText(run(), NOW)).toBe("1m 30s");
    expect(runDurationText(run({ finishedAt: null, status: "running" }), NOW + 45_000)).toBe("45s");
  });
});
