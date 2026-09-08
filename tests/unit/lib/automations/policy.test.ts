import { describe, expect, it } from "vitest";
import {
  AUTO_PAUSE_AFTER,
  MISSED_GRACE_MS,
  dueDecision,
  endedReason,
  leadingFailures,
  shouldAutoPause,
  shouldStartRun,
} from "@/lib/automations/policy";
import type { Schedule } from "@/lib/automations/schedule";
import type { AutomationRun } from "@/lib/automations/automation";

const NY = "America/New_York";
const every4h: Schedule = {
  kind: "interval",
  every: 4,
  unit: "hours",
  anchorMs: Date.UTC(2025, 0, 1, 0, 0),
};

const base = {
  schedule: every4h,
  timeZone: NY,
  dstPolicy: "shift" as const,
  missedPolicy: "once" as const,
};

describe("dueDecision", () => {
  it("stays quiet while the next run is ahead", () => {
    const decision = dueDecision({
      ...base,
      nextDueAt: Date.UTC(2025, 0, 1, 8, 0),
      nowMs: Date.UTC(2025, 0, 1, 7, 0),
    });
    expect(decision).toEqual({
      runNow: false,
      dueAt: null,
      nextDueAt: Date.UTC(2025, 0, 1, 8, 0),
    });
  });

  it("runs an occurrence that has just come due and books the following one", () => {
    const decision = dueDecision({
      ...base,
      nextDueAt: Date.UTC(2025, 0, 1, 8, 0),
      nowMs: Date.UTC(2025, 0, 1, 8, 0) + 1_000,
    });
    expect(decision.runNow).toBe(true);
    expect(decision.dueAt).toBe(Date.UTC(2025, 0, 1, 8, 0));
    expect(decision.nextDueAt).toBe(Date.UTC(2025, 0, 1, 12, 0));
  });

  it("runs once after a long outage rather than replaying every missed interval", () => {
    const decision = dueDecision({
      ...base,
      nextDueAt: Date.UTC(2025, 0, 1, 8, 0),
      nowMs: Date.UTC(2025, 0, 3, 9, 0),
    });
    expect(decision.runNow).toBe(true);
    expect(decision.dueAt).toBe(Date.UTC(2025, 0, 1, 8, 0));
    // The catch-up run does not shift the schedule: the next slot is the next
    // real occurrence after now.
    expect(decision.nextDueAt).toBe(Date.UTC(2025, 0, 3, 12, 0));
  });

  it("drops a missed occurrence entirely under the skip policy", () => {
    const decision = dueDecision({
      ...base,
      missedPolicy: "skip",
      nextDueAt: Date.UTC(2025, 0, 1, 8, 0),
      nowMs: Date.UTC(2025, 0, 3, 9, 0),
    });
    expect(decision.runNow).toBe(false);
    expect(decision.nextDueAt).toBe(Date.UTC(2025, 0, 3, 12, 0));
  });

  it("still runs a slightly late occurrence under the skip policy", () => {
    const decision = dueDecision({
      ...base,
      missedPolicy: "skip",
      nextDueAt: Date.UTC(2025, 0, 1, 8, 0),
      nowMs: Date.UTC(2025, 0, 1, 8, 0) + MISSED_GRACE_MS - 1_000,
    });
    expect(decision.runNow).toBe(true);
  });

  it("books a first run for an automation that has never had one", () => {
    const decision = dueDecision({ ...base, nextDueAt: null, nowMs: Date.UTC(2025, 0, 1, 7, 0) });
    expect(decision.runNow).toBe(false);
    expect(decision.nextDueAt).toBe(Date.UTC(2025, 0, 1, 8, 0));
  });

  it("leaves a one-time schedule with nothing booked after it fires", () => {
    const once: Schedule = { kind: "once", atMs: Date.UTC(2025, 0, 1, 8, 0) };
    const decision = dueDecision({
      ...base,
      schedule: once,
      nextDueAt: Date.UTC(2025, 0, 1, 8, 0),
      nowMs: Date.UTC(2025, 0, 1, 8, 1),
    });
    expect(decision.runNow).toBe(true);
    expect(decision.nextDueAt).toBeNull();
  });
});

describe("dueDecision — the clock moves", () => {
  it("does not re-run an occurrence when the clock is set backwards", () => {
    // The host booked 08:00, ran it, and booked 12:00. An NTP correction then
    // puts the clock back to 07:00: the booked instant is ahead again, and
    // nothing may fire until it arrives for real.
    const decision = dueDecision({
      ...base,
      nextDueAt: Date.UTC(2025, 0, 1, 12, 0),
      nowMs: Date.UTC(2025, 0, 1, 7, 0),
    });
    expect(decision).toEqual({
      runNow: false,
      dueAt: null,
      nextDueAt: Date.UTC(2025, 0, 1, 12, 0),
    });
  });

  it("books from the corrected clock rather than the one it was set from", () => {
    // Forward correction past several occurrences: one catch-up run, and the
    // next slot is the next real occurrence after the corrected now.
    const decision = dueDecision({
      ...base,
      nextDueAt: Date.UTC(2025, 0, 1, 4, 0),
      nowMs: Date.UTC(2025, 0, 1, 13, 0),
    });
    expect(decision.runNow).toBe(true);
    expect(decision.dueAt).toBe(Date.UTC(2025, 0, 1, 4, 0));
    expect(decision.nextDueAt).toBe(Date.UTC(2025, 0, 1, 16, 0));
  });

  it("keeps a weekly schedule on its wall time when the zone's offset changes", () => {
    // 09:00 local either side of the spring transition is two different
    // instants, and the schedule follows the clock rather than the elapsed gap.
    const daily: Schedule = { kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "09:00" };
    const before = dueDecision({
      ...base,
      schedule: daily,
      nextDueAt: Date.UTC(2025, 2, 8, 14, 0),
      nowMs: Date.UTC(2025, 2, 8, 14, 1),
    });
    // 09:00 EST is 14:00Z; the next day 09:00 EDT is 13:00Z — an hour less
    // elapsed, which is what "every day at 09:00" means.
    expect(before.nextDueAt).toBe(Date.UTC(2025, 2, 9, 13, 0));
  });
});

describe("shouldStartRun", () => {
  it("skips a due run while the previous one is still going", () => {
    expect(shouldStartRun("skip", true)).toBe("skip");
    expect(shouldStartRun("skip", false)).toBe("start");
  });

  it("queues one instead when asked to", () => {
    expect(shouldStartRun("queue", true)).toBe("queue");
    expect(shouldStartRun("queue", false)).toBe("start");
  });
});

describe("shouldAutoPause", () => {
  const run = (status: AutomationRun["status"], startedAt: number): AutomationRun => ({
    id: `r${startedAt}`,
    automationId: "a",
    sessionId: null,
    dueAt: startedAt,
    startedAt,
    finishedAt: startedAt + 1,
    status,
  });

  it("counts only the newest unbroken run of failures", () => {
    const runs = [run("failed", 3), run("failed", 2), run("success", 1)];
    expect(leadingFailures(runs)).toBe(2);
    expect(shouldAutoPause(runs)).toBe(false);
  });

  it("pauses once the threshold is reached", () => {
    const runs = Array.from({ length: AUTO_PAUSE_AFTER }, (_, i) => run("failed", 10 - i));
    expect(shouldAutoPause(runs)).toBe(true);
  });

  it("does not count a cancelled or attention-needed run as a failure", () => {
    const runs = [run("cancelled", 3), run("needs-attention", 2), run("failed", 1)];
    expect(leadingFailures(runs)).toBe(0);
  });

  it("ignores a run that is still going", () => {
    const runs = [run("running", 4), run("failed", 3), run("failed", 2), run("failed", 1)];
    expect(shouldAutoPause(runs)).toBe(true);
  });
});

describe("endedReason", () => {
  const now = Date.UTC(2025, 5, 1);

  it("reports nothing for an open-ended automation", () => {
    expect(endedReason({ runCount: 4 }, now)).toBeNull();
  });

  it("reports the run cap once it is reached", () => {
    expect(endedReason({ runCount: 5, maxRuns: 5 }, now)).toBe("max-runs");
    expect(endedReason({ runCount: 4, maxRuns: 5 }, now)).toBeNull();
  });

  it("reports the final date once it passes", () => {
    expect(endedReason({ runCount: 1, endAtMs: now - 1 }, now)).toBe("end-date");
    expect(endedReason({ runCount: 1, endAtMs: now + 1 }, now)).toBeNull();
  });
});
