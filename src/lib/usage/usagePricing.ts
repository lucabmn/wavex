/**
 * Model rate lookup and cost arithmetic.
 *
 * Rates come from LiteLLM's `model_prices_and_context_window.json`, the table
 * `ccusage` prices against, so figures line up with the tool people already
 * compare wavex to. Fetching and caching the document is the backend's job;
 * everything here is pure.
 */
import type { UsageTokenTotals } from "./usageTypes";

/** The subset of a LiteLLM entry we price against, in USD per token. */
export type ModelRate = {
  inputCostPerToken: number;
  outputCostPerToken: number;
  cacheReadCostPerToken: number;
  cacheCreationCostPerToken: number;
};

export type RateTable = ReadonlyMap<string, ModelRate>;

export const EMPTY_RATE_TABLE: RateTable = new Map();

/**
 * Where a cost figure came from.
 *
 * - `providerReported`: the transcript carried an explicit cost.
 * - `modelPriced`: the model matched the rate table.
 * - `unpriced`: tokens are known, rates are not. Counted in the token totals,
 *   left out of cost.
 */
export type UsageCostSource = "providerReported" | "modelPriced" | "unpriced";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Projects the LiteLLM document into a rate table.
 *
 * Entries missing either an input or an output rate are dropped: half a price
 * would silently under-report cost, which is worse than reporting the model as
 * unpriced. LiteLLM also publishes tiered variants (`*_above_200k_tokens`,
 * `*_flex`, `*_priority`, `*_batches`); the base tier is used deliberately,
 * because transcripts do not record which tier served a request and anything
 * else would be a guess dressed up as precision.
 */
export function parseRateTable(document: unknown): RateTable {
  const table = new Map<string, ModelRate>();
  if (typeof document !== "object" || document === null) return table;

  for (const [name, raw] of Object.entries(document as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const input = finiteNumber(entry.input_cost_per_token);
    const output = finiteNumber(entry.output_cost_per_token);
    if (input === null || output === null) continue;

    const key = normalizeRateKey(name);
    if (key.length === 0) continue;
    table.set(key, {
      inputCostPerToken: input,
      outputCostPerToken: output,
      // Anthropic bills cache reads at a discount and cache writes at a
      // premium. When a model omits them, cached input is priced as plain
      // input rather than as free.
      cacheReadCostPerToken: finiteNumber(entry.cache_read_input_token_cost) ?? input,
      cacheCreationCostPerToken: finiteNumber(entry.cache_creation_input_token_cost) ?? input,
    });
  }

  // Transcripts write bare model names; the table often qualifies them with a
  // vendor prefix. A bare alias is only safe when every qualified entry agrees
  // on the price, so `null` marks one claimed at conflicting rates.
  const aliases = new Map<string, ModelRate | null>();
  for (const [key, rate] of table) {
    const alias = bareModelName(key);
    if (alias.length === 0 || alias === key || table.has(alias)) continue;
    const held = aliases.get(alias);
    if (held === undefined) {
      aliases.set(alias, rate);
    } else if (held !== null && !sameRate(held, rate)) {
      aliases.set(alias, null);
    }
  }
  for (const [alias, rate] of aliases) {
    if (rate !== null) table.set(alias, rate);
  }

  return table;
}

function sameRate(a: ModelRate, b: ModelRate): boolean {
  return (
    a.inputCostPerToken === b.inputCostPerToken &&
    a.outputCostPerToken === b.outputCostPerToken &&
    a.cacheReadCostPerToken === b.cacheReadCostPerToken &&
    a.cacheCreationCostPerToken === b.cacheCreationCostPerToken
  );
}

function normalizeRateKey(model: string): string {
  return model.trim().toLowerCase();
}

function bareModelName(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? key : key.slice(slash + 1);
}

/**
 * Models we never price, whatever the table says.
 *
 * `<synthetic>` marks locally generated messages that were never billed. Bare
 * family names are genuinely ambiguous across generations, so they report as
 * unpriced rather than guessing one.
 */
const UNPRICEABLE_MODELS = new Set([
  "<synthetic>",
  "synthetic",
  "opus",
  "sonnet",
  "haiku",
  "fable",
]);

export function lookupRate(table: RateTable, model: string): ModelRate | null {
  const key = normalizeRateKey(model);
  const bare = bareModelName(key);
  if (bare.length === 0 || UNPRICEABLE_MODELS.has(bare)) return null;
  return table.get(key) ?? table.get(bare) ?? null;
}

export type PricedUsage = {
  costUsd: number;
  costSource: UsageCostSource;
};

/**
 * Prices one cell's tokens.
 *
 * A cost the provider reported always wins: it is what the provider actually
 * charged, and the rate table is only ever a reconstruction of that.
 * `reasoningTokens` is deliberately not charged separately — it is already
 * counted inside `outputTokens`.
 */
export function priceUsage(
  table: RateTable,
  model: string,
  totals: UsageTokenTotals,
  reportedCostUsd: number | null,
): PricedUsage {
  if (reportedCostUsd !== null && Number.isFinite(reportedCostUsd)) {
    return { costUsd: reportedCostUsd, costSource: "providerReported" };
  }

  const rate = lookupRate(table, model);
  if (rate === null) return { costUsd: 0, costSource: "unpriced" };

  return {
    costUsd:
      totals.uncachedInputTokens * rate.inputCostPerToken +
      totals.cachedInputTokens * rate.cacheReadCostPerToken +
      totals.cacheCreationTokens * rate.cacheCreationCostPerToken +
      totals.outputTokens * rate.outputCostPerToken,
    costSource: "modelPriced",
  };
}

/**
 * What the cached input would have cost at full input rates, minus what it
 * actually cost. Needs the rate table, so it is computed alongside cost rather
 * than derived later.
 */
export function cacheSavingsUsd(table: RateTable, model: string, totals: UsageTokenTotals): number {
  const rate = lookupRate(table, model);
  if (rate === null) return 0;
  return totals.cachedInputTokens * (rate.inputCostPerToken - rate.cacheReadCostPerToken);
}
