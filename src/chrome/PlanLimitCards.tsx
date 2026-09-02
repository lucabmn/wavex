import { HarnessIcon } from "./HarnessIcon";
import { HARNESS_LABEL } from "../lib/session";
import {
  clampPercent,
  formatPercent,
  formatResetLabel,
  limitSeverity,
  type PlanLimits,
  type PlanLimitWindow,
} from "../lib/usage/planLimits";

/**
 * What is left of each subscription before its next reset.
 *
 * This is the figure people open the view for, so it sits above the token
 * history and shows every window the provider reports rather than a fixed
 * session-and-weekly pair — plans differ, and some have no session window.
 */
export function PlanLimitCards({ limits, now }: { limits: PlanLimits[]; now: number }) {
  if (limits.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {limits.map((entry) => (
        <PlanLimitCard key={entry.provider} limits={entry} now={now} />
      ))}
    </div>
  );
}

function PlanLimitCard({ limits, now }: { limits: PlanLimits; now: number }) {
  const tightest = limits.windows.reduce<PlanLimitWindow | null>((worst, window) => {
    return !worst || window.usedPercent > worst.usedPercent ? window : worst;
  }, null);

  return (
    <section
      className="flex flex-col rounded-xl border border-content/10 px-4 py-3.5"
      aria-label={`${HARNESS_LABEL[limits.provider]} plan limits`}
    >
      <header className="flex items-center gap-2">
        <HarnessIcon harness={limits.provider} className="size-4 shrink-0" />
        <span className="min-w-0 truncate text-[12px] font-medium">
          {HARNESS_LABEL[limits.provider]}
        </span>
        {limits.plan ? (
          <span className="shrink-0 rounded-full bg-content/[0.08] px-1.5 py-0.5 text-[10px] text-content/55">
            {limits.plan}
          </span>
        ) : null}
        {limits.status === "ok" && tightest ? (
          <span
            className={`ml-auto shrink-0 text-[11px] tabular-nums ${severityText(tightest.usedPercent)}`}
            title={`Highest window: ${tightest.label}`}
          >
            {formatPercent(tightest.usedPercent)} used
          </span>
        ) : null}
      </header>

      <div className="mt-3">
        {limits.status === "loading" ? (
          <Placeholder>Reading plan limits…</Placeholder>
        ) : limits.status === "unavailable" ? (
          <Placeholder>{limits.error ?? "Not connected"}</Placeholder>
        ) : limits.status === "error" ? (
          <Placeholder tone="error">{limits.error ?? "Could not read plan limits"}</Placeholder>
        ) : (
          <ul className="flex flex-col gap-3">
            {limits.windows.map((window) => (
              <li key={window.id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="min-w-0 truncate text-content/60">{window.label}</span>
                  <span className="shrink-0 tabular-nums">
                    <span className={severityText(window.usedPercent)}>
                      {formatPercent(window.usedPercent)}
                    </span>
                    <span className="ml-1.5 text-content/35">
                      {formatResetLabel(window.resetsAt, now)}
                    </span>
                  </span>
                </div>
                <LimitBar usedPercent={window.usedPercent} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function LimitBar({ usedPercent }: { usedPercent: number }) {
  const percent = clampPercent(usedPercent);
  return (
    <span
      className="block h-1.5 overflow-hidden rounded-full bg-content/[0.08]"
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span
        className={`block h-full rounded-full ${severityFill(usedPercent)}`}
        // A used window must stay visible even at a fraction of a percent.
        style={{ width: `${percent > 0 ? Math.max(1.5, percent) : 0}%` }}
      />
    </span>
  );
}

function Placeholder({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p className={`text-[11px] ${tone === "error" ? "text-red-400/80" : "text-content/35"}`}>
      {children}
    </p>
  );
}

function severityText(usedPercent: number): string {
  const severity = limitSeverity(usedPercent);
  if (severity === "critical") return "text-red-400";
  if (severity === "high") return "text-amber-400";
  return "text-content";
}

function severityFill(usedPercent: number): string {
  const severity = limitSeverity(usedPercent);
  if (severity === "critical") return "bg-red-400";
  if (severity === "high") return "bg-amber-400";
  return "bg-content/45";
}
