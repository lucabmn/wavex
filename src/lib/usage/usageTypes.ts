import type { HarnessId } from "../session";

/**
 * Providers whose CLI writes token usage into a local transcript.
 *
 * The ids match `HarnessId`, so the existing labels and icons apply. Cursor,
 * OpenCode and fx are absent on purpose: none of them records a per-turn token
 * count we can read without guessing at an unverified format, and a wrong
 * number is worse than an honest gap.
 */
export const USAGE_PROVIDERS = ["claude", "codex", "pi", "omp", "grok"] as const;

export type UsageProvider = (typeof USAGE_PROVIDERS)[number] & HarnessId;

export function isUsageProvider(value: string): value is UsageProvider {
  return (USAGE_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Token counts for a bucket.
 *
 * `cachedInputTokens` and `cacheCreationTokens` are disjoint from
 * `uncachedInputTokens`; the three together are the total input.
 * `reasoningTokens` is a *subset* of `outputTokens`, so it must never be added
 * on top.
 */
export type UsageTokenTotals = {
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

/**
 * One `(day, provider, model)` cell as the backend scanned it.
 *
 * `reportedCostUsd` is set only when every record in the cell carried a cost
 * the provider itself worked out. Cells without one are priced from the rate
 * table, and the backend never mixes the two into one bucket, so a cost cannot
 * be counted twice.
 */
export type UsageBucket = {
  dayIndex: number;
  provider: string;
  model: string;
  reportedCostUsd: number | null;
  records: number;
} & UsageTokenTotals;

export type UsageSourceStatus = "ok" | "missing" | "failed";

export type UsageSource = {
  provider: string;
  status: UsageSourceStatus;
  path: string;
  scannedFiles: number;
  sessions: number;
  message: string | null;
};

export type UsageSummary = {
  buckets: UsageBucket[];
  sources: UsageSource[];
  scanDurationMs: number;
};

export type ModelRatesStatus = "fresh" | "cached" | "unavailable";

export type ModelRatesFetch = {
  status: ModelRatesStatus;
  source: string;
  fetchedAtMs: number | null;
  document: string | null;
};

export const EMPTY_TOKEN_TOTALS: UsageTokenTotals = {
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

export function addTokenTotals(a: UsageTokenTotals, b: UsageTokenTotals): UsageTokenTotals {
  return {
    uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

export function totalTokens(totals: UsageTokenTotals): number {
  // reasoningTokens sits inside outputTokens and must not be added again.
  return (
    totals.uncachedInputTokens +
    totals.cachedInputTokens +
    totals.cacheCreationTokens +
    totals.outputTokens
  );
}
