/**
 * Backend bridge for the usage view.
 *
 * The scan itself never touches a provider API — it reads the CLIs' own
 * transcripts — so refreshing costs nothing but disk. The one network call is
 * the LiteLLM rate table, which the backend refreshes at most daily and caches
 * to disk; it is fetched once per app run and held here.
 */
import { getDefaultHostId, invokeOn } from "../transport";
import { type HostId } from "../host";
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

const ratesPromises = new Map<HostId, Promise<ModelRatesSnapshot>>();

export async function fetchUsageSummary(
  window: UsageWindow,
  hostId: HostId = getDefaultHostId(),
): Promise<UsageSummary> {
  return invokeOn<UsageSummary>(hostId, "usage_summary", {
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
export function fetchModelRates(hostId: HostId = getDefaultHostId()): Promise<ModelRatesSnapshot> {
  const cached = ratesPromises.get(hostId);
  if (cached) return cached;
  const pending = loadModelRates(hostId).then(
    (snapshot) => {
      if (snapshot.status === "unavailable") ratesPromises.delete(hostId);
      return snapshot;
    },
    () => {
      ratesPromises.delete(hostId);
      return UNAVAILABLE_RATES;
    },
  );
  ratesPromises.set(hostId, pending);
  return pending;
}

async function loadModelRates(hostId: HostId): Promise<ModelRatesSnapshot> {
  const result = await invokeOn<ModelRatesFetch>(hostId, "usage_model_rates");
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
