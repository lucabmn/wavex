import { describe, expect, it } from "vitest";
import {
  codexPlanLabel,
  codexWindowLabel,
  formatResetIn,
  formatResetLabel,
  limitSeverity,
  parseClaudePlanLimits,
  parseCodexPlanLimits,
  parseResetTimestamp,
} from "@/lib/usage/planLimits";

describe("parseClaudePlanLimits", () => {
  it("prefers the plan's own limits array", () => {
    const limits = parseClaudePlanLimits(
      JSON.stringify({
        five_hour: { utilization: 9, resets_at: "2026-09-02T22:59:59Z" },
        seven_day: { utilization: 1, resets_at: "2026-09-04T03:59:59Z" },
        limits: [
          {
            kind: "weekly",
            percent: 41,
            resets_at: "2026-09-04T03:59:59Z",
            is_active: true,
          },
          { kind: "session", percent: 9, resets_at: "2026-09-02T22:59:59Z", is_active: true },
        ],
      }),
    );
    expect(limits.status).toBe("ok");
    // The session window is read first regardless of the payload's order.
    expect(limits.windows.map((window) => window.id)).toEqual(["session", "weekly"]);
    expect(limits.windows[0]?.label).toBe("5-hour session");
    expect(limits.windows[0]?.usedPercent).toBe(9);
    expect(limits.windows[1]?.label).toBe("Weekly");
    expect(limits.windows[1]?.resetsAt).toBe(Date.parse("2026-09-04T03:59:59Z"));
  });

  it("skips limits the account does not have", () => {
    const limits = parseClaudePlanLimits(
      JSON.stringify({
        limits: [
          { kind: "session", percent: 5, is_active: true },
          { kind: "weekly_opus", percent: 0, is_active: false },
        ],
      }),
    );
    expect(limits.windows.map((window) => window.id)).toEqual(["session"]);
  });

  it("names a window it has never seen instead of dropping it", () => {
    const limits = parseClaudePlanLimits(
      JSON.stringify({ limits: [{ kind: "monthly_agent", percent: 12, is_active: true }] }),
    );
    expect(limits.windows[0]?.label).toBe("Monthly Agent");
  });

  it("falls back to the named fields when no limits array is present", () => {
    const limits = parseClaudePlanLimits(
      JSON.stringify({
        five_hour: { utilization: 9, resets_at: "2026-09-02T22:59:59Z" },
        seven_day: { utilization: 1, resets_at: "2026-09-04T03:59:59Z" },
        seven_day_opus: null,
      }),
    );
    expect(limits.windows.map((window) => window.label)).toEqual(["5-hour session", "Weekly"]);
  });

  it("reports a payload with no windows as unavailable rather than as zero usage", () => {
    expect(parseClaudePlanLimits(JSON.stringify({ limits: [] })).status).toBe("unavailable");
    expect(parseClaudePlanLimits("{}").status).toBe("unavailable");
  });

  it("reports a broken payload as an error", () => {
    expect(parseClaudePlanLimits("not json").status).toBe("error");
  });
});

describe("parseCodexPlanLimits", () => {
  it("labels each window by the duration Codex reports", () => {
    const limits = parseCodexPlanLimits({
      rateLimits: {
        primary: { used_percent: 47, window_minutes: 300, resets_at: 1781544943 },
        secondary: { used_percent: 23, window_minutes: 10080, resets_at: 1781774419 },
        plan_type: "plus",
      },
    });
    expect(limits.status).toBe("ok");
    expect(limits.plan).toBe("Plus");
    expect(limits.windows.map((window) => window.label)).toEqual(["5-hour session", "Weekly"]);
    expect(limits.windows[0]?.usedPercent).toBe(47);
    // Codex reports seconds; the view works in milliseconds.
    expect(limits.windows[0]?.resetsAt).toBe(1_781_544_943_000);
  });

  it("shows only the windows a plan actually has", () => {
    const limits = parseCodexPlanLimits({
      rateLimits: { secondary: { usedPercent: 12, windowDurationMins: 10080 } },
    });
    expect(limits.windows).toHaveLength(1);
    expect(limits.windows[0]?.label).toBe("Weekly");
  });

  it("reads an unwrapped result too", () => {
    const limits = parseCodexPlanLimits({
      primary: { usedPercent: 5, windowDurationMins: 300 },
    });
    expect(limits.windows).toHaveLength(1);
  });

  it("reports an empty result as unavailable", () => {
    expect(parseCodexPlanLimits({}).status).toBe("unavailable");
    expect(parseCodexPlanLimits(null).status).toBe("unavailable");
  });
});

describe("codexWindowLabel", () => {
  it("names the durations Codex uses and falls back for the rest", () => {
    expect(codexWindowLabel(300)).toBe("5-hour session");
    expect(codexWindowLabel(10_080)).toBe("Weekly");
    expect(codexWindowLabel(1440)).toBe("Daily");
    expect(codexWindowLabel(60)).toBe("1-hour");
    expect(codexWindowLabel(45)).toBe("45-minute");
    expect(codexWindowLabel(null)).toBe("Rate limit");
  });
});

describe("codexPlanLabel", () => {
  it("title-cases a known plan and passes anything else through", () => {
    expect(codexPlanLabel("pro")).toBe("Pro");
    expect(codexPlanLabel("some_new_tier")).toBe("some_new_tier");
    expect(codexPlanLabel(null)).toBeNull();
    expect(codexPlanLabel("  ")).toBeNull();
  });
});

describe("parseResetTimestamp", () => {
  it("accepts seconds, milliseconds and ISO strings", () => {
    expect(parseResetTimestamp(1_781_544_943)).toBe(1_781_544_943_000);
    expect(parseResetTimestamp(1_781_544_943_000)).toBe(1_781_544_943_000);
    expect(parseResetTimestamp("2026-09-02T22:59:59Z")).toBe(Date.parse("2026-09-02T22:59:59Z"));
    expect(parseResetTimestamp(null)).toBeNull();
    expect(parseResetTimestamp("")).toBeNull();
  });
});

describe("formatResetIn", () => {
  it("floors to whole units", () => {
    expect(formatResetIn(0)).toBe("now");
    expect(formatResetIn(47 * 60_000)).toBe("47m");
    expect(formatResetIn(3 * 3_600_000 + 54 * 60_000)).toBe("3h 54m");
    expect(formatResetIn(6 * 86_400_000 + 7 * 3_600_000)).toBe("6d 7h");
    expect(formatResetIn(2 * 86_400_000)).toBe("2d");
  });

  it("reads as a countdown", () => {
    const now = Date.parse("2026-09-02T12:00:00Z");
    expect(formatResetLabel(now + 3_600_000, now)).toBe("Resets in 1h");
    expect(formatResetLabel(now - 1, now)).toBe("Resets now");
    expect(formatResetLabel(null, now)).toBe("No reset reported");
  });
});

describe("limitSeverity", () => {
  it("escalates as a window fills", () => {
    expect(limitSeverity(10)).toBe("normal");
    expect(limitSeverity(75)).toBe("high");
    expect(limitSeverity(90)).toBe("critical");
    expect(limitSeverity(1000)).toBe("critical");
  });
});
