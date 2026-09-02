import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HarnessIcon } from "../chrome/HarnessIcon";
import { LoaderCircle, RefreshCw } from "../chrome/icons";
import { OverlayNav } from "../chrome/TitleBar";
import { UsageChart, type UsageMetric } from "../chrome/UsageChart";
import { WindowControls } from "../chrome/WindowControls";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { IS_MAC } from "../lib/platform";
import { HARNESS_LABEL } from "../lib/session";
import {
  fetchModelRates,
  fetchUsageSummary,
  type ModelRatesSnapshot,
} from "../lib/usage/usageFetch";
import {
  formatCount,
  formatDayRange,
  formatScannedAgo,
  formatShare,
  formatTokens,
  formatUsd,
} from "../lib/usage/usageFormat";
import { EMPTY_RATE_TABLE } from "../lib/usage/usagePricing";
import { USAGE_PROVIDER_COLOR } from "../lib/usage/usageProviders";
import {
  buildUsageReport,
  totalsValue,
  type UsageModelEntry,
  type UsageProviderEntry,
  type UsageReport,
} from "../lib/usage/usageReport";
import {
  isUsageProvider,
  type UsageProvider,
  type UsageSource,
  type UsageSummary,
} from "../lib/usage/usageTypes";
import {
  makeUsageWindow,
  USAGE_WINDOW_DAYS,
  type UsageWindow,
  type UsageWindowDays,
} from "../lib/usage/usageWindow";

/** Survives a close and reopen, so the view comes back where it was left. */
let rememberedDays: UsageWindowDays = 30;
let rememberedMetric: UsageMetric = "cost";

type Props = {
  besideRail?: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
};

type Loaded = {
  summary: UsageSummary;
  scannedAtMs: number;
};

export function UsageView({ besideRail = false, onClose, onToggleSidebar }: Props) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [days, setDays] = useState<UsageWindowDays>(rememberedDays);
  const [metric, setMetric] = useState<UsageMetric>(rememberedMetric);
  const [window_, setWindow] = useState<UsageWindow>(() => makeUsageWindow(rememberedDays));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [rates, setRates] = useState<ModelRatesSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const requestId = useRef(0);

  useEffect(() => {
    rememberedDays = days;
  }, [days]);
  useEffect(() => {
    rememberedMetric = metric;
  }, [metric]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    globalThis.addEventListener("keydown", onKey, true);
    return () => globalThis.removeEventListener("keydown", onKey, true);
  }, []);

  const load = useCallback(async (next: UsageWindow) => {
    const id = (requestId.current += 1);
    setBusy(true);
    try {
      const summary = await fetchUsageSummary(next);
      if (requestId.current !== id) return;
      setLoaded({ summary, scannedAtMs: Date.now() });
      setError(null);
    } catch (err: unknown) {
      if (requestId.current !== id) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestId.current === id) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(window_);
  }, [load, window_]);

  // The rate table is fetched apart from the scan on purpose. It is memoised
  // after the first run, but that first run may go to the network, and the
  // scan is the part the view exists to show — waiting on pricing to render
  // anything would stall the first open of the day behind a request.
  useEffect(() => {
    let live = true;
    void fetchModelRates().then((snapshot) => {
      if (live) setRates(snapshot);
    });
    return () => {
      live = false;
    };
  }, []);

  const selectDays = (next: UsageWindowDays) => {
    setDays(next);
    setWindow(makeUsageWindow(next));
  };

  const refresh = () => {
    // Rebuilding the window also rolls it forward when the day has turned
    // while the view sat open.
    setWindow(makeUsageWindow(days));
  };

  const report = useMemo<UsageReport | null>(() => {
    if (!loaded) return null;
    return buildUsageReport({
      summary: loaded.summary,
      window: window_,
      rates: rates?.table ?? EMPTY_RATE_TABLE,
    });
  }, [loaded, rates, window_]);

  const chartProviders = useMemo(
    () => (report?.providers ?? []).map((entry) => entry.provider),
    [report],
  );

  // A provider with no usage is only worth a note when nothing went wrong; a
  // failed read is a different statement and gets its own line.
  const quiet = useMemo(() => {
    if (!loaded) return [];
    const active = new Set(chartProviders);
    return loaded.summary.sources.filter(
      (source) =>
        isUsageProvider(source.provider) &&
        !active.has(source.provider) &&
        source.status !== "failed",
    );
  }, [chartProviders, loaded]);

  const failed = useMemo(
    () => (loaded?.summary.sources ?? []).filter((source) => source.status === "failed"),
    [loaded],
  );

  const empty = report !== null && report.overall.totalTokens === 0;

  return (
    <div
      role="region"
      aria-label="Usage"
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-content/10"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
          <span className="shrink-0 text-content/45">Usage</span>
          <span aria-hidden className="shrink-0 text-content/25">
            /
          </span>
          <span className="min-w-0 truncate text-content">{formatDayRange(window_.dayLabels)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pr-2" data-tauri-drag-region="false">
          <Segmented
            label="Usage metric"
            value={metric}
            options={[
              { value: "cost", label: "Cost" },
              { value: "tokens", label: "Tokens" },
            ]}
            onSelect={setMetric}
          />
          <Segmented
            label="Usage period"
            value={days}
            options={USAGE_WINDOW_DAYS.map((option) => ({
              value: option,
              label: `${option}d`,
            }))}
            onSelect={selectDays}
          />
          <button
            type="button"
            aria-label="Refresh usage"
            title="Refresh usage"
            disabled={busy}
            onClick={refresh}
            className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
          >
            <RefreshCw
              className={`size-3.5 ${busy ? "animate-spin" : ""}`}
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
        </div>
        {IS_MAC ? null : <WindowControls />}
      </div>

      <div ref={lockOverscroll} className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-8 py-8">
          {error ? (
            <Notice>{error}</Notice>
          ) : !report ? (
            <Skeleton />
          ) : empty ? (
            <EmptyState quiet={quiet.length} />
          ) : (
            <>
              <SummaryCards report={report} />

              <Card>
                <UsageChart days={report.days} metric={metric} providers={chartProviders} />
              </Card>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card title="Providers" hint={`${report.providers.length} active`}>
                  <ProviderTable entries={report.providers} metric={metric} report={report} />
                </Card>
                <Card title="Models" hint={`${report.models.length} used`}>
                  <ModelTable entries={report.models} metric={metric} report={report} />
                </Card>
              </div>

              <Footnotes
                report={report}
                quiet={quiet.map((source) => source.provider)}
                failed={failed}
                rates={rates}
                scannedAtMs={loaded?.scannedAtMs ?? 0}
                scanDurationMs={loaded?.summary.scanDurationMs ?? 0}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onSelect: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 items-center gap-px rounded-md bg-content/[0.07] p-px"
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onSelect(option.value)}
          className={`rounded-[5px] px-2 py-[3px] text-[11px] leading-none ${
            option.value === value
              ? "bg-[var(--color-background-base)] text-content shadow-sm"
              : "text-content/50 hover:text-content"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-content/10 p-4">
      {title ? (
        <header className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-[12px] font-medium text-content/70">{title}</h2>
          {hint ? <span className="text-[11px] text-content/35">{hint}</span> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

function SummaryCards({ report }: { report: UsageReport }) {
  const { overall } = report;
  const input =
    overall.tokens.uncachedInputTokens +
    overall.tokens.cachedInputTokens +
    overall.tokens.cacheCreationTokens;
  const sessions = report.providers.reduce((sum, entry) => sum + entry.sessions, 0);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat
        label="API-equivalent cost"
        value={formatUsd(overall.costUsd)}
        hint={
          overall.cacheSavingsUsd > 0
            ? `${formatUsd(overall.cacheSavingsUsd)} saved by cache`
            : undefined
        }
      />
      <Stat
        label="Tokens"
        value={formatTokens(overall.totalTokens)}
        hint={`${formatTokens(input)} in · ${formatTokens(overall.tokens.outputTokens)} out`}
      />
      <Stat
        label="Sessions"
        value={formatCount(sessions)}
        hint={`${formatCount(overall.records)} turns`}
      />
      <Stat
        label="Cached input"
        value={formatTokens(overall.tokens.cachedInputTokens)}
        hint={
          input > 0
            ? `${formatShare(overall.tokens.cachedInputTokens / input)} of input`
            : undefined
        }
      />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-content/10 px-3.5 py-3">
      <div className="text-[11px] text-content/45">{label}</div>
      <div className="mt-1 truncate text-[19px] font-medium tabular-nums leading-tight">
        {value}
      </div>
      <div className="mt-0.5 h-4 truncate text-[11px] text-content/35">{hint ?? ""}</div>
    </div>
  );
}

function ProviderTable({
  entries,
  metric,
  report,
}: {
  entries: UsageProviderEntry[];
  metric: UsageMetric;
  report: UsageReport;
}) {
  const total = totalsValue(report.overall, metric);
  const format = metric === "cost" ? formatUsd : formatTokens;

  return (
    <ul className="flex flex-col gap-2.5">
      {entries.map((entry) => {
        const value = totalsValue(entry.totals, metric);
        const share = total > 0 ? value / total : 0;
        return (
          <li key={entry.provider} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <HarnessIcon harness={entry.provider} className="size-3.5 shrink-0" />
                <span className="truncate">{HARNESS_LABEL[entry.provider]}</span>
                <span className="shrink-0 text-[11px] text-content/30">
                  {formatCount(entry.sessions)} sessions
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                {format(value)}
                <span className="ml-1.5 text-[11px] text-content/35">{formatShare(share)}</span>
              </span>
            </div>
            <ShareBar share={share} color={USAGE_PROVIDER_COLOR[entry.provider]} />
          </li>
        );
      })}
    </ul>
  );
}

function ModelTable({
  entries,
  metric,
  report,
}: {
  entries: UsageModelEntry[];
  metric: UsageMetric;
  report: UsageReport;
}) {
  const total = totalsValue(report.overall, metric);
  const format = metric === "cost" ? formatUsd : formatTokens;

  return (
    <ul className="flex flex-col gap-2.5">
      {entries.slice(0, 12).map((entry) => {
        const value = totalsValue(entry.totals, metric);
        const share = total > 0 ? value / total : 0;
        // A model can mix reported and unpriceable turns. Only a row that
        // produced no cost at all reads as unpriced; a partial one keeps its
        // figure so the column still sums to the headline total.
        const unpriced = metric === "cost" && entry.costSource === "unpriced" && value === 0;
        const partial = metric === "cost" && entry.costSource === "unpriced" && value > 0;
        return (
          <li key={`${entry.provider} ${entry.model}`} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <HarnessIcon harness={entry.provider} className="size-3.5 shrink-0 opacity-60" />
                <span className="truncate font-mono text-[11px]">{entry.model}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                {unpriced ? (
                  <span className="text-content/30" title="No published rate for this model">
                    unpriced
                  </span>
                ) : (
                  <>
                    {format(value)}
                    {partial ? (
                      <span
                        className="ml-1 text-content/30"
                        title="Some turns on this model have no published rate, so this is a floor"
                      >
                        +
                      </span>
                    ) : null}
                    <span className="ml-1.5 text-[11px] text-content/35">{formatShare(share)}</span>
                  </>
                )}
              </span>
            </div>
            <ShareBar share={share} color={USAGE_PROVIDER_COLOR[entry.provider]} />
          </li>
        );
      })}
      {entries.length > 12 ? (
        <li className="text-[11px] text-content/35">+{entries.length - 12} more</li>
      ) : null}
    </ul>
  );
}

function ShareBar({ share, color }: { share: number; color: string }) {
  const percent = Math.max(0, Math.min(1, share)) * 100;
  return (
    <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-content/[0.08]">
      <span
        className="block h-full rounded-full"
        style={{ width: `${percent}%`, background: color }}
      />
    </span>
  );
}

function Footnotes({
  report,
  quiet,
  failed,
  rates,
  scannedAtMs,
  scanDurationMs,
}: {
  report: UsageReport;
  quiet: string[];
  failed: UsageSource[];
  rates: ModelRatesSnapshot | null;
  scannedAtMs: number;
  scanDurationMs: number;
}) {
  const notes: string[] = [];
  notes.push(
    "Cost is what these tokens would cost at published API rates — not what a subscription plan charged.",
  );
  if (report.unpricedModels.length > 0) {
    notes.push(
      `No published rate for ${report.unpricedModels.slice(0, 3).join(", ")}${
        report.unpricedModels.length > 3 ? ` and ${report.unpricedModels.length - 3} more` : ""
      }. Their tokens are counted, their cost is not.`,
    );
  }
  if (rates === null) {
    notes.push(
      "Still loading published rates — costs shown so far are the ones providers reported.",
    );
  } else if (rates.status === "unavailable") {
    notes.push("The rate table could not be loaded, so only provider-reported costs are shown.");
  }
  if (quiet.length > 0) {
    notes.push(
      `No transcripts found for ${quiet.map((id) => HARNESS_LABEL[id as UsageProvider] ?? id).join(", ")}.`,
    );
  }
  for (const source of failed) {
    notes.push(
      `${HARNESS_LABEL[source.provider as UsageProvider] ?? source.provider} could not be read in full: ${
        source.message ?? "unknown error"
      }`,
    );
  }

  return (
    <footer className="flex flex-col gap-1 pb-4 text-[11px] leading-relaxed text-content/35">
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      {scannedAtMs > 0 ? (
        <p>
          Read from local transcripts {formatScannedAgo(scannedAtMs)} in{" "}
          {formatCount(scanDurationMs)}
          ms. No provider APIs were called.
        </p>
      ) : null}
    </footer>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-400/30 px-4 py-3 text-[12px] text-red-400"
    >
      {children}
    </div>
  );
}

function EmptyState({ quiet }: { quiet: number }) {
  return (
    <div className="flex flex-col items-center gap-2 py-24 text-center">
      <p className="text-[13px] text-content/60">No usage in this window</p>
      <p className="max-w-sm text-[12px] text-content/35">
        {quiet > 0
          ? "Usage is read from each CLI's own session transcripts. Run a turn with one of them, or widen the window."
          : "Widen the window, or run a turn with one of the installed agents."}
      </p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col items-center gap-2 py-24 text-content/35">
      <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} aria-hidden />
      <span className="text-[12px]">Reading local transcripts…</span>
    </div>
  );
}
