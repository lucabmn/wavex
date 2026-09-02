import { describe, expect, it } from "vitest";
import { cacheSavingsUsd, lookupRate, parseRateTable, priceUsage } from "@/lib/usage/usagePricing";
import { EMPTY_TOKEN_TOTALS, type UsageTokenTotals } from "@/lib/usage/usageTypes";

const DOCUMENT = {
  "claude-opus-5": {
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
    cache_read_input_token_cost: 0.0000015,
    cache_creation_input_token_cost: 0.00001875,
  },
  "vertex_ai/gemini-3-pro": {
    input_cost_per_token: 0.000002,
    output_cost_per_token: 0.00001,
  },
  "openai/gpt-5.6-codex": {
    input_cost_per_token: 0.00000125,
    output_cost_per_token: 0.00001,
  },
  "azure/gpt-5.6-codex": {
    input_cost_per_token: 0.000009,
    output_cost_per_token: 0.00002,
  },
  "half-priced-model": { input_cost_per_token: 0.000001 },
  "not-an-entry": 7,
};

const tokens = (partial: Partial<UsageTokenTotals>): UsageTokenTotals => ({
  ...EMPTY_TOKEN_TOTALS,
  ...partial,
});

describe("parseRateTable", () => {
  it("drops entries missing either half of the price", () => {
    const table = parseRateTable(DOCUMENT);
    expect(table.has("half-priced-model")).toBe(false);
    expect(table.has("not-an-entry")).toBe(false);
  });

  it("falls back to the input rate when cache rates are absent", () => {
    const rate = parseRateTable(DOCUMENT).get("vertex_ai/gemini-3-pro");
    expect(rate?.cacheReadCostPerToken).toBe(0.000002);
    expect(rate?.cacheCreationCostPerToken).toBe(0.000002);
  });

  it("aliases a bare name only when every qualified entry agrees", () => {
    const table = parseRateTable(DOCUMENT);
    expect(table.has("gemini-3-pro")).toBe(true);
    // Two vendors price gpt-5.6-codex differently, so the bare name is unsafe.
    expect(table.has("gpt-5.6-codex")).toBe(false);
  });

  it("survives a document that is not an object", () => {
    expect(parseRateTable(null).size).toBe(0);
    expect(parseRateTable("nope").size).toBe(0);
  });
});

describe("lookupRate", () => {
  const table = parseRateTable(DOCUMENT);

  it("matches case-insensitively and through a vendor prefix", () => {
    expect(lookupRate(table, "CLAUDE-OPUS-5")).not.toBeNull();
    expect(lookupRate(table, "vertex_ai/gemini-3-pro")).not.toBeNull();
    expect(lookupRate(table, "gemini-3-pro")).not.toBeNull();
  });

  it("refuses ambiguous family names", () => {
    expect(lookupRate(table, "opus")).toBeNull();
    expect(lookupRate(table, "<synthetic>")).toBeNull();
  });

  it("returns null for an unknown model", () => {
    expect(lookupRate(table, "some-new-model")).toBeNull();
  });
});

describe("priceUsage", () => {
  const table = parseRateTable(DOCUMENT);

  it("prefers a cost the provider reported", () => {
    const priced = priceUsage(table, "claude-opus-5", tokens({ outputTokens: 1000 }), 0.42);
    expect(priced).toEqual({ costUsd: 0.42, costSource: "providerReported" });
  });

  it("prices each token class at its own rate", () => {
    const priced = priceUsage(
      table,
      "claude-opus-5",
      tokens({
        uncachedInputTokens: 1000,
        cachedInputTokens: 1000,
        cacheCreationTokens: 1000,
        outputTokens: 1000,
      }),
      null,
    );
    expect(priced.costSource).toBe("modelPriced");
    expect(priced.costUsd).toBeCloseTo(1000 * (0.000015 + 0.0000015 + 0.00001875 + 0.000075), 12);
  });

  it("never charges reasoning tokens twice", () => {
    const withReasoning = priceUsage(
      table,
      "claude-opus-5",
      tokens({ outputTokens: 1000, reasoningTokens: 600 }),
      null,
    );
    const without = priceUsage(table, "claude-opus-5", tokens({ outputTokens: 1000 }), null);
    expect(withReasoning.costUsd).toBe(without.costUsd);
  });

  it("reports an unknown model as unpriced rather than free-looking zero cost", () => {
    const priced = priceUsage(table, "brand-new-model", tokens({ outputTokens: 1000 }), null);
    expect(priced).toEqual({ costUsd: 0, costSource: "unpriced" });
  });
});

describe("cacheSavingsUsd", () => {
  const table = parseRateTable(DOCUMENT);

  it("is the discount on cache reads against full input rates", () => {
    expect(
      cacheSavingsUsd(table, "claude-opus-5", tokens({ cachedInputTokens: 1000 })),
    ).toBeCloseTo(1000 * (0.000015 - 0.0000015), 12);
  });

  it("is zero when the model has no rate", () => {
    expect(cacheSavingsUsd(table, "unknown", tokens({ cachedInputTokens: 1000 }))).toBe(0);
  });
});
