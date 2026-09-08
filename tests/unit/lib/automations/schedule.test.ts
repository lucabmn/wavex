import { describe, expect, it } from "vitest";
import {
  MIN_INTERVAL_MS,
  describeSchedule,
  intervalMs,
  nextRun,
  normalizeSchedule,
  upcomingRuns,
  type Schedule,
} from "@/lib/automations/schedule";

const NY = "America/New_York";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

describe("intervalMs", () => {
  it("converts each unit", () => {
    expect(intervalMs({ kind: "interval", every: 4, unit: "hours", anchorMs: 0 })).toBe(
      4 * 3_600_000,
    );
    expect(intervalMs({ kind: "interval", every: 90, unit: "minutes", anchorMs: 0 })).toBe(
      90 * 60_000,
    );
    expect(intervalMs({ kind: "interval", every: 2, unit: "weeks", anchorMs: 0 })).toBe(
      2 * 7 * 86_400_000,
    );
  });
});

describe("nextRun — interval", () => {
  const every4h: Schedule = {
    kind: "interval",
    every: 4,
    unit: "hours",
    anchorMs: at(2025, 1, 1, 0, 0),
  };

  it("returns the first anchor multiple strictly after the moment asked about", () => {
    expect(nextRun(every4h, at(2025, 1, 1, 5, 0), NY, "shift")).toBe(at(2025, 1, 1, 8, 0));
  });

  it("does not return the moment itself when it lands exactly on an occurrence", () => {
    expect(nextRun(every4h, at(2025, 1, 1, 8, 0), NY, "shift")).toBe(at(2025, 1, 1, 12, 0));
  });

  it("stays elapsed time across a daylight-saving jump", () => {
    // 06:30Z on the spring-forward day is 01:30 EST; four hours later the
    // clock reads 05:30 EDT, which is what "every 4 hours" must mean.
    const anchored: Schedule = {
      kind: "interval",
      every: 4,
      unit: "hours",
      anchorMs: at(2025, 3, 9, 2, 30),
    };
    const next = nextRun(anchored, at(2025, 3, 9, 6, 0), NY, "shift");
    expect(next).toBe(at(2025, 3, 9, 6, 30));
    expect(nextRun(anchored, next!, NY, "shift")).toBe(next! + 4 * 3_600_000);
  });

  it("works backwards from an anchor in the future", () => {
    expect(nextRun(every4h, at(2024, 12, 31, 21, 0), NY, "shift")).toBe(at(2024, 12, 31, 24, 0));
  });
});

describe("nextRun — weekly", () => {
  const everyDay: Schedule = {
    kind: "weekly",
    days: [0, 1, 2, 3, 4, 5, 6],
    time: "09:00",
  };

  it("finds today's occurrence when it is still ahead", () => {
    // 2025-01-15 12:00Z is 07:00 in New York.
    expect(nextRun(everyDay, at(2025, 1, 15, 12, 0), NY, "shift")).toBe(at(2025, 1, 15, 14, 0));
  });

  it("rolls to tomorrow once today's has passed", () => {
    expect(nextRun(everyDay, at(2025, 1, 15, 15, 0), NY, "shift")).toBe(at(2025, 1, 16, 14, 0));
  });

  it("only picks the selected weekdays", () => {
    // Monday and Wednesday at 08:30.
    const monWed: Schedule = { kind: "weekly", days: [1, 3], time: "08:30" };
    // 2025-01-16 is a Thursday.
    const next = nextRun(monWed, at(2025, 1, 16, 20, 0), NY, "shift");
    // The following Monday is 2025-01-20; 08:30 EST is 13:30Z.
    expect(next).toBe(at(2025, 1, 20, 13, 30));
  });

  it("skips a wall time the spring jump deletes when asked to", () => {
    const half2: Schedule = { kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "02:30" };
    // Asked just after midnight on 2025-03-09 local (05:10Z).
    const next = nextRun(half2, at(2025, 3, 9, 5, 10), NY, "skip");
    // 02:30 does not exist that day, so the next is 2025-03-10 02:30 EDT.
    expect(next).toBe(at(2025, 3, 10, 6, 30));
  });

  it("shifts a deleted wall time to the moment the clock reaches it", () => {
    const half2: Schedule = { kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "02:30" };
    expect(nextRun(half2, at(2025, 3, 9, 5, 10), NY, "shift")).toBe(at(2025, 3, 9, 7, 0));
  });

  it("fires once on the day the clock repeats an hour", () => {
    const half1: Schedule = { kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "01:30" };
    // 2025-11-02 04:00Z is 00:00 EDT, before either occurrence.
    const first = nextRun(half1, at(2025, 11, 2, 4, 0), NY, "shift");
    expect(first).toBe(at(2025, 11, 2, 5, 30));
    // The repeat at 06:30Z must not be offered; the next is the following day.
    expect(nextRun(half1, first!, NY, "shift")).toBe(at(2025, 11, 3, 6, 30));
  });
});

describe("nextRun — once", () => {
  it("returns the moment while it is ahead and nothing after it", () => {
    const once: Schedule = { kind: "once", atMs: at(2026, 3, 1, 9, 0) };
    expect(nextRun(once, at(2026, 2, 1), NY, "shift")).toBe(at(2026, 3, 1, 9, 0));
    expect(nextRun(once, at(2026, 3, 1, 9, 0), NY, "shift")).toBeNull();
  });
});

describe("upcomingRuns", () => {
  it("lists the next occurrences in order", () => {
    const every4h: Schedule = {
      kind: "interval",
      every: 4,
      unit: "hours",
      anchorMs: at(2025, 1, 1, 0, 0),
    };
    expect(upcomingRuns(every4h, at(2025, 1, 1, 1, 0), 3, NY, "shift")).toEqual([
      at(2025, 1, 1, 4, 0),
      at(2025, 1, 1, 8, 0),
      at(2025, 1, 1, 12, 0),
    ]);
  });

  it("stops early when the schedule runs out", () => {
    const once: Schedule = { kind: "once", atMs: at(2026, 3, 1, 9, 0) };
    expect(upcomingRuns(once, at(2026, 2, 1), 5, NY, "shift")).toEqual([at(2026, 3, 1, 9, 0)]);
  });
});

describe("describeSchedule", () => {
  it("reads back as the sentence the builder wrote", () => {
    expect(describeSchedule({ kind: "interval", every: 4, unit: "hours", anchorMs: 0 }, NY)).toBe(
      "Every 4 hours",
    );
    expect(describeSchedule({ kind: "interval", every: 1, unit: "hours", anchorMs: 0 }, NY)).toBe(
      "Every hour",
    );
    expect(
      describeSchedule({ kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "09:00" }, NY),
    ).toBe("Every day at 09:00");
    expect(describeSchedule({ kind: "weekly", days: [1, 2, 3, 4, 5], time: "08:30" }, NY)).toBe(
      "Every weekday at 08:30",
    );
    expect(describeSchedule({ kind: "weekly", days: [1, 3], time: "08:30" }, NY)).toBe(
      "Every Monday and Wednesday at 08:30",
    );
    expect(describeSchedule({ kind: "once", atMs: at(2026, 3, 1, 14, 0) }, NY)).toBe(
      "Once on 1 March 2026 at 09:00",
    );
  });
});

describe("normalizeSchedule", () => {
  it("clamps an interval below the supported minimum", () => {
    const clamped = normalizeSchedule({
      kind: "interval",
      every: 1,
      unit: "minutes",
      anchorMs: 0,
    });
    expect(clamped.kind).toBe("interval");
    if (clamped.kind !== "interval") return;
    expect(intervalMs(clamped)).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
  });

  it("repairs a weekly schedule with no days or a broken time", () => {
    const repaired = normalizeSchedule({ kind: "weekly", days: [], time: "25:99" });
    expect(repaired).toEqual({ kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "09:00" });
  });

  it("reads an unknown shape as a daily schedule rather than throwing", () => {
    expect(normalizeSchedule({ kind: "cron", expression: "* * * * *" })).toEqual({
      kind: "weekly",
      days: [0, 1, 2, 3, 4, 5, 6],
      time: "09:00",
    });
  });
});
