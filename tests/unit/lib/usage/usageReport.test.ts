import { describe, expect, it } from "vitest";
import { parseRateTable } from "@/lib/usage/usagePricing";
import { buildUsageReport, peakDayValue, totalsValue } from "@/lib/usage/usageReport";
import type { UsageBucket, UsageSummary } from "@/lib/usage/usageTypes";
import { makeUsageWindow } from "@/lib/usage/usageWindow";

const rates = parseRateTable({
  "claude-opus-5": { input_cost_per_token: 0.00001, output_cost_per_token: 0.0001 },
});

const window = makeUsageWindow(3, new Date("2026-06-15T12:00:00Z"));

function bucket(partial: Partial<UsageBucket>): UsageBucket {
  return {
    dayIndex: 0,
    provider: "claude",
    model: "claude-opus-5",
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    reportedCostUsd: null,
    records: 1,
    ...partial,
  };
}

function summary(buckets: UsageBucket[], sessions = 0): UsageSummary {
  return {
    buckets,
    sources: [
      {
        provider: "claude",
        status: "ok",
        path: "/home/.claude/projects",
        scannedFiles: 1,
        sessions,
        message: null,
      },
    ],
    scanDurationMs: 4,
  };
}

describe("buildUsageReport", () => {
  it("gives every day in the window a row, including the quiet ones", () => {
    const report = buildUsageReport({
      summary: summary([bucket({ dayIndex: 1, outputTokens: 100 })]),
      window,
      rates,
    });
    expect(report.days).toHaveLength(3);
    expect(report.days.map((day) => day.day)).toEqual(window.dayLabels);
    expect(report.days[0]?.totals.totalTokens).toBe(0);
    expect(report.days[1]?.totals.totalTokens).toBe(100);
  });

  it("adds a provider-reported cost to a priced one without counting either twice", () => {
    const report = buildUsageReport({
      summary: summary([
        bucket({ outputTokens: 1000 }),
        bucket({ provider: "pi", model: "gpt-5.6-sol", outputTokens: 500, reportedCostUsd: 0.25 }),
      ]),
      window,
      rates,
    });
    expect(report.overall.costUsd).toBeCloseTo(0.1 + 0.25, 10);
    expect(report.overall.totalTokens).toBe(1500);
    expect(report.overall.unpricedRecords).toBe(0);
  });

  it("counts unpriced tokens but leaves them out of the cost", () => {
    const report = buildUsageReport({
      summary: summary([bucket({ model: "brand-new", outputTokens: 400, records: 3 })]),
      window,
      rates,
    });
    expect(report.overall.totalTokens).toBe(400);
    expect(report.overall.costUsd).toBe(0);
    expect(report.overall.unpricedRecords).toBe(3);
    expect(report.unpricedModels).toEqual(["brand-new"]);
  });

  it("keeps the weakest cost provenance when a model mixes sources", () => {
    const report = buildUsageReport({
      summary: summary([
        bucket({ model: "brand-new", outputTokens: 100, reportedCostUsd: 0.5 }),
        bucket({ model: "brand-new", outputTokens: 100 }),
      ]),
      window,
      rates,
    });
    expect(report.models).toHaveLength(1);
    expect(report.models[0]?.costSource).toBe("unpriced");
  });

  it("drops buckets from providers it does not present", () => {
    const report = buildUsageReport({
      summary: summary([bucket({ provider: "cursor", outputTokens: 999 })]),
      window,
      rates,
    });
    expect(report.overall.totalTokens).toBe(0);
    expect(report.providers).toHaveLength(0);
  });

  it("ignores a day index outside the window", () => {
    const report = buildUsageReport({
      summary: summary([bucket({ dayIndex: 42, outputTokens: 100 })]),
      window,
      rates,
    });
    expect(report.overall.totalTokens).toBe(0);
  });

  it("orders providers and models heaviest first, and carries session counts", () => {
    const report = buildUsageReport({
      summary: summary(
        [
          bucket({ provider: "codex", model: "gpt-5.6-codex", outputTokens: 10 }),
          bucket({ outputTokens: 1000 }),
        ],
        4,
      ),
      window,
      rates,
    });
    expect(report.providers.map((entry) => entry.provider)).toEqual(["claude", "codex"]);
    expect(report.providers[0]?.sessions).toBe(4);
    expect(report.models[0]?.model).toBe("claude-opus-5");
  });

  it("lists a day's providers in the canonical order regardless of bucket order", () => {
    const report = buildUsageReport({
      summary: summary([
        bucket({ provider: "grok", model: "grok-code", outputTokens: 10 }),
        bucket({ outputTokens: 10 }),
      ]),
      window,
      rates,
    });
    expect(report.days[0]?.providers.map((slice) => slice.provider)).toEqual(["claude", "grok"]);
  });
});

describe("peakDayValue", () => {
  it("scales to the heaviest day for the metric on screen", () => {
    const report = buildUsageReport({
      summary: summary([
        bucket({ dayIndex: 0, outputTokens: 100 }),
        bucket({ dayIndex: 2, outputTokens: 900 }),
      ]),
      window,
      rates,
    });
    expect(peakDayValue(report.days, "tokens")).toBe(900);
    expect(peakDayValue(report.days, "cost")).toBeCloseTo(0.09, 10);
    expect(totalsValue(report.overall, "tokens")).toBe(1000);
  });

  it("is zero for an empty window", () => {
    expect(peakDayValue([], "cost")).toBe(0);
  });
});
