import { describe, expect, it } from "vitest";
import {
  gapEndInstant,
  isTimeZone,
  normalizeTimeZone,
  wallToInstant,
  zoneOffsetMinutes,
  zonedParts,
} from "@/lib/automations/zone";

const NY = "America/New_York";

describe("zoneOffsetMinutes", () => {
  it("reads standard and daylight offsets", () => {
    expect(zoneOffsetMinutes(Date.UTC(2025, 0, 15, 12, 0), NY)).toBe(-300);
    expect(zoneOffsetMinutes(Date.UTC(2025, 6, 15, 12, 0), NY)).toBe(-240);
    expect(zoneOffsetMinutes(Date.UTC(2025, 0, 15, 12, 0), "UTC")).toBe(0);
  });
});

describe("zonedParts", () => {
  it("projects an instant into the zone's calendar", () => {
    const parts = zonedParts(Date.UTC(2025, 0, 15, 2, 30), NY);
    expect(parts).toMatchObject({ year: 2025, month: 1, day: 14, hour: 21, minute: 30 });
    // 14 January 2025 was a Tuesday.
    expect(parts.weekday).toBe(2);
  });
});

describe("wallToInstant", () => {
  it("resolves an ordinary wall time", () => {
    const { ms, exists } = wallToInstant({ year: 2025, month: 1, day: 15, hour: 9, minute: 0 }, NY);
    expect(exists).toBe(true);
    expect(ms).toBe(Date.UTC(2025, 0, 15, 14, 0));
  });

  it("reports a wall time the spring-forward jump deletes", () => {
    const { exists } = wallToInstant({ year: 2025, month: 3, day: 9, hour: 2, minute: 30 }, NY);
    expect(exists).toBe(false);
  });

  it("picks the first of the two fall-back occurrences", () => {
    const { ms, exists } = wallToInstant(
      { year: 2025, month: 11, day: 2, hour: 1, minute: 30 },
      NY,
    );
    expect(exists).toBe(true);
    expect(ms).toBe(Date.UTC(2025, 10, 2, 5, 30));
  });
});

describe("gapEndInstant", () => {
  it("lands on the moment the clock reaches the skipped hour", () => {
    const ms = gapEndInstant({ year: 2025, month: 3, day: 9, hour: 2, minute: 30 }, NY);
    expect(ms).toBe(Date.UTC(2025, 2, 9, 7, 0));
    expect(zonedParts(ms, NY)).toMatchObject({ hour: 3, minute: 0 });
  });
});

describe("normalizeTimeZone", () => {
  it("keeps a usable zone and falls back to UTC otherwise", () => {
    expect(isTimeZone(NY)).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(normalizeTimeZone(NY)).toBe(NY);
    expect(normalizeTimeZone("Mars/Olympus")).toBe("UTC");
    expect(normalizeTimeZone(undefined)).toBe("UTC");
  });
});
