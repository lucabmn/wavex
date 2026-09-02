import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchModelRates, fetchUsageSummary, type ModelRatesSnapshot } from "./usageFetch";
import { loadingPlanLimits, PLAN_LIMIT_PROVIDERS, type PlanLimits } from "./planLimits";
import { fetchClaudePlanLimits, fetchCodexPlanLimits } from "./planLimitsFetch";
import { EMPTY_RATE_TABLE } from "./usagePricing";
import { buildUsageReport, type UsageReport } from "./usageReport";
import type { UsageSummary } from "./usageTypes";
import { makeUsageWindow, type UsageWindow, type UsageWindowDays } from "./usageWindow";

type LoadedUsage = {
  key: string;
  summary: UsageSummary;
  scannedAtMs: number;
};

function windowKey(window: UsageWindow): string {
  return window.dayStartsMs.join(",");
}

/**
 * Shared usage controller for the full usage surface and the compact menu-bar
 * view. `active` keeps provider processes, scans, and timers asleep while the
 * menu-bar popover is hidden.
 */
export function useUsageData(days: UsageWindowDays, active = true) {
  const [window_, setWindow] = useState<UsageWindow>(() => makeUsageWindow(days));
  const [loaded, setLoaded] = useState<LoadedUsage | null>(null);
  const [rates, setRates] = useState<ModelRatesSnapshot | null>(null);
  const [planLimits, setPlanLimits] = useState<PlanLimits[]>(() =>
    PLAN_LIMIT_PROVIDERS.map(loadingPlanLimits),
  );
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(active);
  const requestId = useRef(0);
  const planLimitsLoaded = useRef(false);
  const windowDays = useRef(days);

  useEffect(() => {
    if (windowDays.current === days) return;
    windowDays.current = days;
    setWindow(makeUsageWindow(days));
  }, [days]);

  const loadPlanLimits = useCallback((force = false) => {
    planLimitsLoaded.current = true;
    setPlanLimits(PLAN_LIMIT_PROVIDERS.map(loadingPlanLimits));
    for (const [index, read] of [fetchClaudePlanLimits, fetchCodexPlanLimits].entries()) {
      void read(force).then((result) => {
        setPlanLimits((current) =>
          current.map((entry, position) => (position === index ? result : entry)),
        );
      });
    }
  }, []);

  useEffect(() => {
    if (active && !planLimitsLoaded.current) loadPlanLimits();
  }, [active, loadPlanLimits]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const load = useCallback(async (next: UsageWindow) => {
    const id = (requestId.current += 1);
    const key = windowKey(next);
    setBusy(true);
    try {
      const summary = await fetchUsageSummary(next);
      if (requestId.current !== id) return;
      setLoaded({ key, summary, scannedAtMs: Date.now() });
      setError(null);
    } catch (err: unknown) {
      if (requestId.current !== id) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestId.current === id) setBusy(false);
    }
  }, []);

  const key = windowKey(window_);
  useEffect(() => {
    if (!active || loaded?.key === key) return;
    void load(window_);
  }, [active, key, load, loaded?.key, window_]);

  useEffect(() => {
    if (!active || rates) return;
    let live = true;
    void fetchModelRates().then((snapshot) => {
      if (live) setRates(snapshot);
    });
    return () => {
      live = false;
    };
  }, [active, rates]);

  const refresh = useCallback(() => {
    // The button is the way past the host's short plan-limit cache.
    loadPlanLimits(true);
    const next = makeUsageWindow(days);
    if (windowKey(next) === key) {
      void load(next);
    } else {
      // The window rolled into a new day; the active-window effect performs
      // the one scan after this state change.
      setWindow(next);
    }
  }, [days, key, load, loadPlanLimits]);

  const report = useMemo<UsageReport | null>(() => {
    if (!loaded || loaded.key !== key) return null;
    return buildUsageReport({
      summary: loaded.summary,
      window: window_,
      rates: rates?.table ?? EMPTY_RATE_TABLE,
    });
  }, [key, loaded, rates, window_]);

  return {
    window: window_,
    summary: loaded?.summary ?? null,
    scannedAtMs: loaded?.scannedAtMs ?? 0,
    rates,
    planLimits,
    now,
    error,
    busy,
    report,
    refresh,
  };
}
