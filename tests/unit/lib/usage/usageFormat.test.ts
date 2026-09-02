import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatDayLong,
  formatDayRange,
  formatDayShort,
  formatScannedAgo,
  formatShare,
  formatTokens,
  formatUsd,
} from "@/lib/usage/usageFormat";

describe("formatUsd", () => {
  it("keeps a sub-cent figure from rounding away to nothing", () => {
    expect(formatUsd(0.0004)).toBe("$0.0004");
    expect(formatUsd(0.01)).toBe("$0.01");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("shows whole dollars at two places", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });
});

describe("formatTokens", () => {
  it("compacts to three significant figures", () => {
    expect(formatTokens(804_123)).toBe("804K");
    expect(formatTokens(76_700_000)).toBe("76.7M");
    expect(formatTokens(19_900_000_000)).toBe("19.9B");
    expect(formatTokens(1_500_000_000_000)).toBe("1.5T");
  });

  it("leaves small counts alone", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });
});

describe("formatShare", () => {
  it("keeps a tiny share visible", () => {
    expect(formatShare(0.0001)).toBe("<0.1%");
    expect(formatShare(0.05)).toBe("5.0%");
    expect(formatShare(0.5)).toBe("50%");
    expect(formatShare(0)).toBe("0%");
  });
});

describe("day formatting", () => {
  it("renders short, long and range labels", () => {
    expect(formatDayShort("2026-08-07")).toBe("Aug 7");
    expect(formatDayLong("2026-08-07")).toBe("Fri, Aug 7");
    expect(formatDayRange(["2026-08-07", "2026-09-05"])).toBe("Aug 7 – Sep 5");
    expect(formatDayRange(["2026-08-07"])).toBe("Aug 7");
  });

  it("passes an unparseable day through", () => {
    expect(formatDayShort("nope")).toBe("nope");
    expect(formatDayRange([])).toBe("");
  });
});

describe("formatScannedAgo", () => {
  it("reads as elapsed time", () => {
    const now = Date.parse("2026-06-15T12:00:00Z");
    expect(formatScannedAgo(now, now)).toBe("just now");
    expect(formatScannedAgo(now - 60_000, now)).toBe("1 minute ago");
    expect(formatScannedAgo(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(formatScannedAgo(now - 3 * 3_600_000, now)).toBe("3 hours ago");
    expect(formatScannedAgo(now - 48 * 3_600_000, now)).toBe("2 days ago");
  });

  it("never reads as the future", () => {
    const now = Date.parse("2026-06-15T12:00:00Z");
    expect(formatScannedAgo(now + 60_000, now)).toBe("just now");
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(12_345)).toBe("12,345");
  });
});
