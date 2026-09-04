import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { HarnessIcon } from "../chrome/HarnessIcon";
import { CircleAlert, Square } from "../chrome/icons";
import { OverlayNav } from "../chrome/TitleBar";
import { WindowControls } from "../chrome/WindowControls";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { formatLiveElapsed, type LiveAgent } from "../lib/liveAgents";
import {
  focusMenuBarAgent,
  MENU_BAR_AGENTS_CHANGED,
  menuBarStatusLabel,
  stopMenuBarAgent,
} from "../lib/menuBar";
import { displayPath, projectName } from "../lib/paths";
import { IS_MAC } from "../lib/platform";
import { HARNESS_LABEL } from "../lib/session";

type ActivityFilter = "all" | "waiting" | "working" | "done";

type Props = {
  besideRail?: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
};

/**
 * Every turn running in this install, not just this window. The rows come from
 * the same native store the menu bar reads, so twenty worktrees in five windows
 * are one list with one truth.
 */
export function ActivityView({ besideRail = false, onClose, onToggleSidebar }: Props) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [agents, setAgents] = useState<LiveAgent[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>("all");

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

  // One timer for the whole list: elapsed is the only thing ticking here.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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

  const status = useMemo(() => menuBarStatusLabel(agents), [agents]);
  const counts = useMemo(
    () => ({
      waiting: agents.filter((agent) => agent.needsApproval).length,
      working: agents.filter((agent) => !agent.done && !agent.needsApproval).length,
      done: agents.filter((agent) => agent.done).length,
    }),
    [agents],
  );
  const filteredAgents = useMemo(
    () =>
      agents.filter((agent) => {
        if (filter === "waiting") return agent.needsApproval;
        if (filter === "working") return !agent.done && !agent.needsApproval;
        if (filter === "done") return agent.done;
        return true;
      }),
    [agents, filter],
  );
  const projects = useMemo(() => {
    const groups = new Map<string, LiveAgent[]>();
    for (const agent of filteredAgents) {
      const key = agent.cwd || "~";
      const list = groups.get(key);
      if (list) list.push(agent);
      else groups.set(key, [agent]);
    }
    return [...groups.entries()];
  }, [filteredAgents]);

  const stop = (agent: LiveAgent) => {
    setError(null);
    void stopMenuBarAgent(agent.id).then((routed) => {
      if (!routed) setError("That chat's window is gone, so nothing was left to stop.");
    });
  };

  return (
    <div
      role="region"
      aria-label="Activity"
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        className="flex h-10 shrink-0 items-center border-b border-content/10 select-none"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
          <span className="shrink-0 text-content/45">Activity</span>
          <span aria-hidden className="shrink-0 text-content/25">
            /
          </span>
          <span className="min-w-0 truncate text-content">{status}</span>
        </div>
        {counts.waiting > 0 ? (
          <button
            type="button"
            onClick={() => {
              const next = agents.find((agent) => agent.needsApproval);
              if (next) focusMenuBarAgent(next.id);
            }}
            className="mr-2 hidden shrink-0 items-center gap-1.5 rounded-md bg-amber-400/12 px-2 py-1 text-[11.5px] font-medium text-amber-300 hover:bg-amber-400/18 sm:flex"
          >
            <CircleAlert className="size-3.5" strokeWidth={1.75} />
            Review next
          </button>
        ) : null}
        <WindowControls />
      </div>

      <div ref={lockOverscroll} className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        {agents.length > 0 ? (
          <div
            role="group"
            aria-label="Filter agent activity"
            className="sticky top-0 z-10 flex items-center gap-1 border-b border-content/10 bg-background-base/90 px-3 py-2 backdrop-blur-md"
          >
            <ActivityFilterButton
              label="All"
              count={agents.length}
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />
            <ActivityFilterButton
              label="Needs you"
              count={counts.waiting}
              active={filter === "waiting"}
              tone="attention"
              onClick={() => setFilter("waiting")}
            />
            <ActivityFilterButton
              label="Working"
              count={counts.working}
              active={filter === "working"}
              onClick={() => setFilter("working")}
            />
            <ActivityFilterButton
              label="Done"
              count={counts.done}
              active={filter === "done"}
              onClick={() => setFilter("done")}
            />
          </div>
        ) : null}
        {error ? (
          <p className="flex items-center gap-2 px-4 pt-3 text-[12px] text-amber-300">
            <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
            {error}
          </p>
        ) : null}
        {agents.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-content/45">
            No agent is working right now. Turns from every window show up here while they run.
          </p>
        ) : filteredAgents.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-4 py-6">
            <p className="text-[13px] text-content/45">Nothing matches this filter.</p>
            <button
              type="button"
              onClick={() => setFilter("all")}
              className="rounded-md bg-content/10 px-2 py-1 text-[11.5px] text-content/70 hover:bg-content/15 hover:text-content"
            >
              Show all activity
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-3">
            {projects.map(([cwd, rows]) => (
              <section key={cwd} className="flex flex-col gap-1">
                <h2 className="px-1 text-[11px] font-medium tracking-wide text-content/40 uppercase">
                  {projectName(cwd)}
                </h2>
                {rows.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    now={now}
                    onOpen={() => focusMenuBarAgent(agent.id)}
                    onStop={() => stop(agent)}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityFilterButton({
  label,
  count,
  active,
  tone = "default",
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone?: "default" | "attention";
  onClick: () => void;
}) {
  const attention = tone === "attention" && count > 0;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] transition-colors ${
        active
          ? attention
            ? "bg-amber-400/15 text-amber-300"
            : "bg-content/12 text-content"
          : attention
            ? "text-amber-300/80 hover:bg-amber-400/10 hover:text-amber-300"
            : "text-content/45 hover:bg-content/8 hover:text-content/75"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function AgentRow({
  agent,
  now,
  onOpen,
  onStop,
}: {
  agent: LiveAgent;
  now: number;
  onOpen: () => void;
  onStop: () => void;
}) {
  const waiting = agent.approvals?.length ?? 0;
  const elapsed = agent.done
    ? agent.durationMs != null
      ? formatLiveElapsed(0, agent.durationMs)
      : null
    : agent.startedAt != null
      ? formatLiveElapsed(agent.startedAt, now)
      : null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-content/10 bg-content/[0.03] px-2.5 py-2">
      <button
        type="button"
        onClick={onOpen}
        title={displayPath(agent.cwd, agent.cwd)}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <HarnessIcon harness={agent.harness} className="size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] text-content">{agent.title}</span>
          <span className="truncate text-[12px] text-content/45">{agent.activity}</span>
        </span>
      </button>
      {waiting > 0 ? (
        <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-300">
          {waiting === 1 ? "1 needs you" : `${waiting} need you`}
        </span>
      ) : null}
      <span className="shrink-0 text-[11px] text-content/35">{HARNESS_LABEL[agent.harness]}</span>
      {elapsed ? (
        <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-content/40">
          {elapsed}
        </span>
      ) : null}
      {agent.done ? null : (
        <button
          type="button"
          title="Stop this turn"
          aria-label="Stop this turn"
          onClick={onStop}
          className="grid size-6.5 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
        >
          <Square className="size-2.5 fill-current" strokeWidth={0} />
        </button>
      )}
    </div>
  );
}
