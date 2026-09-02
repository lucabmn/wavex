import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { HarnessIcon } from "../chrome/HarnessIcon";
import { BarChart, Bot, Check, CircleAlert, ExternalLink, RefreshCw } from "../chrome/icons";
import { PlanLimitCards } from "../chrome/PlanLimitCards";
import { formatLiveElapsed, type LiveAgent } from "../lib/liveAgents";
import { MENU_BAR_AGENTS_CHANGED } from "../lib/menuBar";
import { projectName } from "../lib/paths";
import { HARNESS_LABEL } from "../lib/session";
import { formatCount, formatTokens, formatUsd } from "../lib/usage/usageFormat";
import { USAGE_PROVIDER_COLOR } from "../lib/usage/usageProviders";
import type { UsageReport } from "../lib/usage/usageReport";
import { useUsageData } from "../lib/usage/useUsageData";
import { USAGE_WINDOW_DAYS, type UsageWindowDays } from "../lib/usage/usageWindow";

type MenuTab = "agents" | "usage";

export function MenuBarApp() {
  const [tab, setTab] = useState<MenuTab>("agents");
  const [agents, setAgents] = useState<LiveAgent[]>([]);
  const [focused, setFocused] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;
    void listen<LiveAgent[]>(MENU_BAR_AGENTS_CHANGED, ({ payload }) => {
      if (live) setAgents(payload);
    })
      .then((unlisten) => {
        stop = unlisten;
        return invoke<LiveAgent[]>("menu_bar_agents");
      })
      .then((snapshot) => {
        if (live) setAgents(snapshot);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      stop?.();
    };
  }, []);

  useEffect(() => {
    const current = getCurrentWindow();
    let stop: (() => void) | undefined;
    let hideTimer: number | undefined;
    void current
      .isFocused()
      .then(setFocused)
      .catch(() => undefined);
    void current
      .onFocusChanged(({ payload }) => {
        setFocused(payload);
        if (payload) {
          if (hideTimer !== undefined) window.clearTimeout(hideTimer);
          return;
        }
        // Delay lets a status-item click toggle an already-open popup before the
        // focus-loss dismissal runs.
        hideTimer = window.setTimeout(() => {
          if (!document.hasFocus()) void current.hide();
        }, 80);
      })
      .then((unlisten) => {
        stop = unlisten;
      })
      .catch(() => undefined);
    return () => {
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      stop?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void getCurrentWindow().hide();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const next: MenuTab = tab === "agents" ? "usage" : "agents";
      event.preventDefault();
      setTab(next);
      tabRefs.current[next === "agents" ? 0 : 1]?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab]);

  const working = agents.filter((agent) => !agent.done).length;

  return (
    // The native window carries the popover's corner radius, blur, and shadow,
    // so the card fills it edge to edge; an inset card would sit inside a
    // second frame.
    <main className="h-full text-content">
      <div className="flex h-full flex-col overflow-hidden rounded-[14px] border border-content/10 bg-background-base/70">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-content/10 px-3">
          <img src="/logo.png" alt="" className="h-3.5 w-5 object-contain" draggable={false} />
          <span className="text-[12px] font-semibold tracking-tight">wavex</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-content/45">
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${
                working > 0 ? "bg-accent shadow-[0_0_7px_var(--color-accent)]" : "bg-content/20"
              }`}
            />
            {working > 0 ? `${working} working` : "All quiet"}
          </span>
        </header>

        <div className="px-3 pt-2.5">
          <div
            role="tablist"
            aria-label="Menu bar sections"
            className="grid grid-cols-2 gap-1 rounded-lg bg-content/[0.06] p-1"
          >
            <MenuTabButton
              ref={(node) => {
                tabRefs.current[0] = node;
              }}
              id="menu-agents-tab"
              selected={tab === "agents"}
              icon={<Bot className="size-3.5" strokeWidth={1.75} aria-hidden />}
              onSelect={() => setTab("agents")}
            >
              Agents{working > 0 ? ` · ${working}` : ""}
            </MenuTabButton>
            <MenuTabButton
              ref={(node) => {
                tabRefs.current[1] = node;
              }}
              id="menu-usage-tab"
              selected={tab === "usage"}
              icon={<BarChart className="size-3.5" strokeWidth={1.75} aria-hidden />}
              onSelect={() => setTab("usage")}
            >
              Usage
            </MenuTabButton>
          </div>
        </div>

        {tab === "agents" ? (
          <AgentsTab agents={agents} focused={focused} />
        ) : (
          <UsageTab active={focused} />
        )}

        <footer className="flex h-10 shrink-0 items-center border-t border-content/10 px-3">
          <span className="text-[10px] text-content/45">
            {tab === "agents" ? "Click a session to jump back in" : "From local CLI transcripts"}
          </span>
          <button
            type="button"
            onClick={() => void invoke("menu_bar_open_app")}
            className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] text-content/55 hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
          >
            Open wavex
            <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden />
          </button>
        </footer>
      </div>
    </main>
  );
}

function MenuTabButton({
  ref,
  id,
  selected,
  icon,
  children,
  onSelect,
}: {
  ref: React.Ref<HTMLButtonElement>;
  id: string;
  selected: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={id.replace("-tab", "-panel")}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium focus-visible:outline-2 focus-visible:outline-accent ${
        selected
          ? "bg-background-base text-content shadow-sm ring-1 ring-content/10"
          : "text-content/45 hover:text-content/75"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function AgentsTab({ agents, focused }: { agents: LiveAgent[]; focused: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const ticking = focused && agents.some((agent) => !agent.done && agent.startedAt != null);

  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [ticking]);

  return (
    <section
      id="menu-agents-panel"
      role="tabpanel"
      aria-labelledby="menu-agents-tab"
      className="min-h-0 flex-1 overflow-y-auto overscroll-none px-2 py-2"
    >
      {agents.length === 0 ? (
        <div className="grid h-full place-content-center justify-items-center gap-2 px-8 text-center">
          <span className="grid size-9 place-items-center rounded-full bg-content/[0.06] text-content/35">
            <Check className="size-4" strokeWidth={1.8} aria-hidden />
          </span>
          <p className="text-[12px] font-medium text-content/65">No agents are working</p>
          <p className="text-[11px] leading-relaxed text-content/35">
            Active sessions and requests for approval will appear here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {agents.map((agent) => (
            <li key={agent.id}>
              <AgentRow agent={agent} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AgentRow({ agent, now }: { agent: LiveAgent; now: number }) {
  const elapsed = agent.done
    ? agent.durationMs != null
      ? formatLiveElapsed(0, agent.durationMs)
      : ""
    : agent.startedAt != null
      ? formatLiveElapsed(agent.startedAt, now)
      : "";
  const activity = agent.needsApproval
    ? "Needs approval"
    : agent.done
      ? "Finished"
      : agent.activity;
  const project = projectName(agent.cwd);

  return (
    <button
      type="button"
      onClick={() => void invoke("menu_bar_focus_agent", { sessionId: agent.id })}
      className="group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left hover:bg-content/[0.07] focus-visible:outline-2 focus-visible:outline-accent"
      aria-label={[agent.title, HARNESS_LABEL[agent.harness], project, activity, elapsed]
        .filter(Boolean)
        .join(", ")}
    >
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-content/[0.07]">
        <HarnessIcon harness={agent.harness} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold leading-snug">{agent.title}</span>
        <span
          className={`mt-1 flex min-w-0 items-center gap-1.5 text-[11px] ${
            agent.needsApproval
              ? "text-amber-400"
              : agent.done
                ? "text-emerald-400"
                : "text-content/50"
          }`}
        >
          {agent.needsApproval ? (
            <CircleAlert className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
          ) : agent.done ? (
            <Check className="size-3 shrink-0" strokeWidth={2} aria-hidden />
          ) : (
            <span className="size-1.5 shrink-0 rounded-full bg-accent animate-pulse" aria-hidden />
          )}
          <span className="truncate">{activity}</span>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-content/35">
          <span className="truncate">{HARNESS_LABEL[agent.harness]}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{project}</span>
          {elapsed ? <span className="ml-auto shrink-0 tabular-nums">{elapsed}</span> : null}
        </span>
      </span>
    </button>
  );
}

function UsageTab({ active }: { active: boolean }) {
  const [days, setDays] = useState<UsageWindowDays>(30);
  const { report, planLimits, now, error, busy, refresh } = useUsageData(days, active);

  return (
    <section
      id="menu-usage-panel"
      role="tabpanel"
      aria-labelledby="menu-usage-tab"
      className="min-h-0 flex-1 overflow-y-auto overscroll-none px-3 py-3"
    >
      <div className="mb-3 flex items-center gap-1.5">
        <span className="mr-auto text-[11px] text-content/40">Local usage</span>
        <div
          role="group"
          aria-label="Usage period"
          className="flex rounded-md bg-content/[0.06] p-0.5"
        >
          {USAGE_WINDOW_DAYS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={days === option}
              onClick={() => setDays(option)}
              className={`rounded px-1.5 py-1 text-[10px] leading-none ${
                days === option ? "bg-background-base text-content shadow-sm" : "text-content/40"
              }`}
            >
              {option}d
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Refresh usage"
          title="Refresh usage"
          disabled={busy}
          onClick={refresh}
          className="grid size-6 place-items-center rounded-md text-content/40 hover:bg-content/10 hover:text-content disabled:opacity-40"
        >
          <RefreshCw
            className={`size-3.5 ${busy ? "animate-spin" : ""}`}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
      </div>

      <PlanLimitCards limits={planLimits} now={now} />

      {error ? (
        <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[11px] text-red-300/80">
          {error}
        </div>
      ) : !report ? (
        <UsageSkeleton />
      ) : (
        <UsageSummary report={report} />
      )}
    </section>
  );
}

function UsageSummary({ report }: { report: UsageReport }) {
  const sessions = report.providers.reduce((sum, entry) => sum + entry.sessions, 0);
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="grid grid-cols-3 divide-x divide-content/10 rounded-lg bg-content/[0.045] py-2.5">
        <CompactStat label="Cost" value={formatUsd(report.overall.costUsd)} />
        <CompactStat label="Tokens" value={formatTokens(report.overall.totalTokens)} />
        <CompactStat label="Sessions" value={formatCount(sessions)} />
      </div>

      {report.providers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-content/10 px-4 py-5 text-center">
          <p className="text-[11px] text-content/45">No usage in this period</p>
        </div>
      ) : (
        <div>
          <div className="mb-1.5 flex items-center justify-between px-1 text-[10px] text-content/30">
            <span>Providers</span>
            <span>{report.providers.length} active</span>
          </div>
          <div className="flex flex-col gap-1">
            {report.providers.slice(0, 5).map((entry) => {
              const share =
                report.overall.totalTokens > 0
                  ? (entry.totals.totalTokens / report.overall.totalTokens) * 100
                  : 0;
              return (
                <div key={entry.provider} className="rounded-lg px-2 py-2 hover:bg-content/[0.04]">
                  <div className="flex items-center gap-2 text-[11px]">
                    <HarnessIcon harness={entry.provider} className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {HARNESS_LABEL[entry.provider]}
                    </span>
                    <span className="tabular-nums text-content/55">
                      {formatTokens(entry.totals.totalTokens)}
                    </span>
                    <span className="w-14 text-right tabular-nums text-content/35">
                      {formatUsd(entry.totals.costUsd)}
                    </span>
                  </div>
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-content/[0.06]">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(entry.totals.totalTokens > 0 ? 2 : 0, share)}%`,
                        background: USAGE_PROVIDER_COLOR[entry.provider],
                      }}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-2 text-center">
      <div className="truncate text-[13px] font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wide text-content/30">{label}</div>
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="mt-3 animate-pulse space-y-3" aria-label="Loading usage">
      <div className="h-14 rounded-lg bg-content/[0.05]" />
      <div className="space-y-1">
        <div className="h-10 rounded-lg bg-content/[0.04]" />
        <div className="h-10 rounded-lg bg-content/[0.04]" />
      </div>
    </div>
  );
}
