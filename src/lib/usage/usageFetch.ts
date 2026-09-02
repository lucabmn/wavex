/**
 * Backend bridge for the usage view.
 *
 * The scan itself never touches a provider API — it reads the CLIs' own
 * transcripts — so refreshing costs nothing but disk. The one network call is
 * the LiteLLM rate table, which the backend refreshes at most daily and caches
 * to disk; it is fetched once per app run and held here.
 */
import { invoke } from "@tauri-apps/api/core";
import { EMPTY_RATE_TABLE, parseRateTable, type RateTable } from "./usagePricing";
import type { ModelRatesFetch, ModelRatesStatus, UsageSummary } from "./usageTypes";
import type { UsageWindow } from "./usageWindow";

export type ModelRatesSnapshot = {
  table: RateTable;
  status: ModelRatesStatus;
  fetchedAtMs: number | null;
};

const UNAVAILABLE_RATES: ModelRatesSnapshot = {
  table: EMPTY_RATE_TABLE,
  status: "unavailable",
  fetchedAtMs: null,
};

let ratesPromise: Promise<ModelRatesSnapshot> | null = null;

export async function fetchUsageSummary(window: UsageWindow): Promise<UsageSummary> {
  return invoke<UsageSummary>("usage_summary", {
    query: { dayStartsMs: window.dayStartsMs },
  });
}

/**
 * The rate table, parsed once and shared.
 *
 * The document runs to a couple of megabytes, so re-parsing it on every
 * refresh would be the most expensive thing the view does. A failed load is
 * not cached: every model then reports as unpriced, and the next refresh gets
 * another chance.
 */
export function fetchModelRates(): Promise<ModelRatesSnapshot> {
  if (ratesPromise) return ratesPromise;
  const pending = loadModelRates().then(
    (snapshot) => {
      if (snapshot.status === "unavailable") ratesPromise = null;
      return snapshot;
    },
    () => {
      ratesPromise = null;
      return UNAVAILABLE_RATES;
    },
  );
  ratesPromise = pending;
  return pending;
}

async function loadModelRates(): Promise<ModelRatesSnapshot> {
  const result = await invoke<ModelRatesFetch>("usage_model_rates");
  if (!result.document) return UNAVAILABLE_RATES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.document);
  } catch {
    return UNAVAILABLE_RATES;
  }
  const table = parseRateTable(parsed);
  if (table.size === 0) return UNAVAILABLE_RATES;
  return { table, status: result.status, fetchedAtMs: result.fetchedAtMs };
}
