import { useCallback, useMemo, useRef, useState } from "react";
import { HarnessIcon } from "./HarnessIcon";
import { formatDayLong, formatDayShort, formatTokens, formatUsd } from "../lib/usage/usageFormat";
import { USAGE_PROVIDER_COLOR, usageProviderLabel } from "../lib/usage/usageProviders";
import { peakDayValue, totalsValue, type UsageDayEntry } from "../lib/usage/usageReport";
import type { UsageProvider } from "../lib/usage/usageTypes";

export type UsageMetric = "cost" | "tokens";

/** Bars shorter than this vanish against the track, so a used day keeps a stub. */
const MIN_VISIBLE_PERCENT = 1.5;

export function UsageChart({
  days,
  metric,
  providers,
}: {
  days: UsageDayEntry[];
  metric: UsageMetric;
  providers: UsageProvider[];
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const peak = useMemo(() => peakDayValue(days, metric), [days, metric]);
  const format = metric === "cost" ? formatUsd : formatTokens;

  // Long windows cannot label every day, so only the ends and the midpoint are
  // written out; the tooltip carries the exact day for everything between.
  const labelledIndexes = useMemo(() => {
    if (days.length <= 1) return new Set([0]);
    if (days.length <= 10) return new Set(days.map((_, index) => index));
    return new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]);
  }, [days]);

  const onLeave = useCallback(() => setHovered(null), []);
  const active = hovered === null ? null : days[hovered];

  return (
    <div className="flex flex-col gap-2" ref={root}>
      <div
        className="relative flex h-44 items-end gap-px"
        role="img"
        aria-label={`Daily usage across ${days.length} days`}
        onPointerLeave={onLeave}
      >
        {days.map((day, index) => (
          <Column
            key={day.day}
            day={day}
            metric={metric}
            peak={peak}
            hovered={hovered === index}
            dimmed={hovered !== null && hovered !== index}
            onHover={() => setHovered(index)}
          />
        ))}
        {active ? (
          <Tooltip
            day={active}
            metric={metric}
            index={hovered ?? 0}
            count={days.length}
            format={format}
          />
        ) : null}
      </div>

      <div className="flex select-none gap-px text-[10px] text-content/35" aria-hidden>
        {days.map((day, index) => (
          <span key={day.day} className="min-w-0 flex-1 truncate text-center">
            {labelledIndexes.has(index) ? formatDayShort(day.day) : ""}
          </span>
        ))}
      </div>

      {providers.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {providers.map((provider) => (
            <span key={provider} className="inline-flex items-center gap-1.5 text-[11px]">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: USAGE_PROVIDER_COLOR[provider] }}
              />
              <HarnessIcon harness={provider} className="size-3 shrink-0 opacity-60" />
              <span className="text-content/55">{usageProviderLabel(provider)}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Column({
  day,
  metric,
  peak,
  hovered,
  dimmed,
  onHover,
}: {
  day: UsageDayEntry;
  metric: UsageMetric;
  peak: number;
  hovered: boolean;
  dimmed: boolean;
  onHover: () => void;
}) {
  const total = totalsValue(day.totals, metric);
  const height = peak > 0 ? Math.max(total > 0 ? MIN_VISIBLE_PERCENT : 0, (total / peak) * 100) : 0;

  return (
    <div
      className="group flex h-full min-w-0 flex-1 cursor-default items-end"
      onPointerEnter={onHover}
      onPointerMove={onHover}
    >
      <div
        className={`flex w-full flex-col-reverse justify-start overflow-hidden rounded-[3px] transition-opacity ${
          hovered ? "" : dimmed ? "opacity-45" : ""
        } ${total > 0 ? "" : "bg-content/[0.06]"}`}
        style={{ height: total > 0 ? `${height}%` : "2px" }}
      >
        {day.providers.map((slice) => {
          const value = totalsValue(slice.totals, metric);
          if (value <= 0) return null;
          return (
            <div
              key={slice.provider}
              style={{
                height: `${(value / total) * 100}%`,
                background: USAGE_PROVIDER_COLOR[slice.provider],
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function Tooltip({
  day,
  metric,
  index,
  count,
  format,
}: {
  day: UsageDayEntry;
  metric: UsageMetric;
  index: number;
  count: number;
  format: (value: number) => string;
}) {
  // Anchoring to the column's centre keeps the card over its bar; clamping the
  // translation keeps it inside the chart at either end.
  const centre = count > 0 ? ((index + 0.5) / count) * 100 : 50;
  const shift = centre < 20 ? "0%" : centre > 80 ? "-100%" : "-50%";

  return (
    <div
      className="pointer-events-none absolute bottom-full z-10 mb-2 w-max max-w-[15rem] rounded-lg border border-content/10 bg-[var(--color-background-base)] px-2.5 py-2 text-[11px] shadow-lg"
      style={{ left: `${centre}%`, transform: `translateX(${shift})` }}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-content/55">{formatDayLong(day.day)}</span>
        <span className="font-medium tabular-nums text-content">
          {format(totalsValue(day.totals, metric))}
        </span>
      </div>
      {day.providers.length === 0 ? (
        <div className="text-content/35">No usage</div>
      ) : (
        <div className="flex flex-col gap-1">
          {day.providers.map((slice) => (
            <div key={slice.provider} className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5 text-content/60">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ background: USAGE_PROVIDER_COLOR[slice.provider] }}
                />
                {usageProviderLabel(slice.provider)}
              </span>
              <span className="tabular-nums text-content/80">
                {format(totalsValue(slice.totals, metric))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
