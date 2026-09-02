import { describe, expect, it } from "vitest";
import { makeUsageWindow, shiftDay, zonedDayStartMs } from "@/lib/usage/usageWindow";

describe("shiftDay", () => {
  it("moves across a month boundary", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("leaves an unparseable day alone", () => {
    expect(shiftDay("not-a-day", -1)).toBe("not-a-day");
  });
});

describe("zonedDayStartMs", () => {
  it("resolves midnight in a fixed-offset zone", () => {
    expect(zonedDayStartMs("2026-06-15", "UTC")).toBe(Date.parse("2026-06-15T00:00:00Z"));
    // Tokyo is UTC+9 year round.
    expect(zonedDayStartMs("2026-06-15", "Asia/Tokyo")).toBe(Date.parse("2026-06-14T15:00:00Z"));
  });

  it("resolves midnight in a half-hour zone", () => {
    expect(zonedDayStartMs("2026-06-15", "Asia/Kolkata")).toBe(Date.parse("2026-06-14T18:30:00Z"));
  });

  it("uses the offset in force on the day itself, not the one at UTC midnight", () => {
    // Berlin is UTC+1 in winter and UTC+2 in summer; the DST switch is
    // 2026-03-29, so the day after it must resolve at the summer offset.
    expect(zonedDayStartMs("2026-01-15", "Europe/Berlin")).toBe(Date.parse("2026-01-14T23:00:00Z"));
    expect(zonedDayStartMs("2026-03-30", "Europe/Berlin")).toBe(Date.parse("2026-03-29T22:00:00Z"));
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(zonedDayStartMs("2026-06-15", "Not/AZone")).toBe(Date.parse("2026-06-15T00:00:00Z"));
  });
});

describe("makeUsageWindow", () => {
  it("ends on today and carries one boundary more than days", () => {
    const window = makeUsageWindow(7, new Date("2026-06-15T12:00:00Z"));
    expect(window.dayLabels).toHaveLength(7);
    expect(window.dayStartsMs).toHaveLength(8);
    expect(window.dayLabels[window.dayLabels.length - 1]).toMatch(/^2026-06-1[45]$/);
  });

  it("keeps the boundaries strictly ascending, which the scanner requires", () => {
    const window = makeUsageWindow(90, new Date("2026-03-30T12:00:00Z"));
    for (let index = 1; index < window.dayStartsMs.length; index += 1) {
      expect(window.dayStartsMs[index]).toBeGreaterThan(window.dayStartsMs[index - 1] as number);
    }
  });

  it("covers the whole of the last day, so a turn from a moment ago still lands", () => {
    const now = new Date("2026-06-15T23:59:00Z");
    const window = makeUsageWindow(7, now);
    expect(window.dayStartsMs[window.dayStartsMs.length - 1]).toBeGreaterThan(now.getTime());
  });
});
