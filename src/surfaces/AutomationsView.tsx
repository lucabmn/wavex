import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AutomationDialog } from "../chrome/AutomationDialog";
import { FilterChip } from "../chrome/FilterChip";
import { HarnessIcon } from "../chrome/HarnessIcon";
import {
  CircleAlert,
  Clock,
  Copy,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
} from "../chrome/icons";
import { SecondaryButton } from "../chrome/SettingsRow";
import { WindowControls } from "../chrome/WindowControls";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { CLOCK_STRIDE_COARSE, useNow } from "../lib/motion";
import { IS_MAC } from "../lib/platform";
import { isRemoteHostId, projectKey, type HostId } from "../lib/host";
import { connectionSnapshot } from "../lib/transport";
import { prettyCwd, projectName } from "../lib/paths";
import { RUNTIME_MODE_LABEL } from "../lib/session";
import {
  automationDraft,
  duplicateDraft,
  newAutomationDraft,
  RUN_STATUS_LABEL,
  type Automation,
  type AutomationDraft,
  type AutomationRun,
} from "../lib/automations/automation";
import {
  createAutomation,
  deleteAutomation,
  getAutomationsState,
  loadAutomations,
  pauseAllAutomations,
  runAutomationNow,
  setAutomationEnabled,
  stopAutomationRun,
  subscribeAutomations,
  updateAutomation,
} from "../lib/automations/automationStore";
import {
  AUTOMATION_STATUS_LABEL,
  automationCounts,
  automationStatus,
  filterAutomations,
  latestRuns,
  nextRunLine,
  relativeMoment,
  runDurationText,
  scheduleLine,
  type AutomationFilter,
  type AutomationListStatus,
} from "../lib/automations/automationView";
import { listAutomationRuns } from "../lib/automations/automationsHost";
import { formatMoment, upcomingRuns } from "../lib/automations/schedule";

type Props = {
  /** Projects offered as targets, in the rail's order. */
  projects: readonly string[];
  onClose: () => void;
  /** The host is the automation's: a run's session lives where it ran. */
  onOpenSession: (sessionId: string, hostId: HostId) => void;
};

const FILTERS: AutomationFilter[] = ["all", "active", "running", "failing", "paused", "finished"];

const STATUS_TONE: Record<AutomationListStatus, string> = {
  running: "bg-accent",
  active: "bg-emerald-400",
  failing: "bg-amber-400",
  paused: "bg-content/30",
  finished: "bg-content/20",
};

const RUN_TONE: Record<AutomationRun["status"], string> = {
  running: "text-accent",
  success: "text-emerald-400",
  failed: "text-red-400",
  cancelled: "text-faint",
  "needs-attention": "text-amber-300",
  interrupted: "text-faint",
};

/**
 * Every scheduled task in this profile.
 *
 * The list is the state of the schedule and the detail is the state of one
 * automation's history, because the two questions a person brings here are
 * "what is going to run" and "what did that one do last time".
 */
export function AutomationsView({ projects, onClose, onOpenSession }: Props) {
  const listLock = useLockOverscroll<HTMLDivElement>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const state = useSyncExternalStore(
    subscribeAutomations,
    getAutomationsState,
    getAutomationsState,
  );
  const now = useNow(true, CLOCK_STRIDE_COARSE);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AutomationFilter>("all");
  const [project, setProject] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    draft: AutomationDraft;
    existing: Automation | null;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [history, setHistory] = useState<AutomationRun[]>([]);

  useEffect(() => {
    void loadAutomations(true).catch(() => undefined);
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

  const running = useMemo(() => new Set(state.running), [state.running]);
  const newest = useMemo(() => latestRuns(state.runs), [state.runs]);
  const statusOf = useMemo(
    () => (automation: Automation) => {
      const lastRun = newest.get(automation.id);
      return automationStatus(automation, {
        running: running.has(automation.id),
        ...(lastRun ? { lastRun } : {}),
      });
    },
    [newest, running],
  );

  const counts = useMemo(
    () => automationCounts(state.automations, statusOf),
    [state.automations, statusOf],
  );
  const visible = useMemo(
    () =>
      filterAutomations(
        state.automations,
        { text: query, status: filter, ...(project ? { project } : {}) },
        statusOf,
      ),
    [filter, project, query, state.automations, statusOf],
  );

  // Only the projects that actually have an automation: a filter offering
  // every recent project would mostly filter to nothing.
  const projectFilters = useMemo(() => {
    const seen = new Map<string, string>();
    for (const automation of state.automations) {
      seen.set(projectKey(automation.projectRef), automation.cwd);
    }
    return [...seen.entries()];
  }, [state.automations]);

  const selected = useMemo(
    () => visible.find((entry) => entry.id === selectedId) ?? visible[0] ?? null,
    [selectedId, visible],
  );

  // A refetch belongs to a run changing, not to the store handing out a new
  // array every tick, which is what depending on `state.runs` itself would do.
  const runsToken = useMemo(
    () => state.runs.map((run) => `${run.id}:${run.status}`).join("|"),
    [state.runs],
  );

  // The detail's history is the automation's own, not the shared newest-first
  // slice the list uses, so opening one does not depend on how busy the others
  // have been.
  useEffect(() => {
    if (!selected) {
      setHistory([]);
      return;
    }
    let live = true;
    void listAutomationRuns({ automationId: selected.id })
      .then((runs) => {
        if (live) setHistory(runs);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [selected, runsToken]);

  const openNew = () => {
    const target = projects[0];
    if (!target) return;
    setEditing({
      draft: newAutomationDraft({ projectRef: target, cwd: target, harness: "claude" }),
      existing: null,
    });
  };

  const save = async (draft: AutomationDraft) => {
    if (editing?.existing) await updateAutomation(editing.existing.id, draft);
    else await createAutomation(draft);
  };

  const empty = state.automations.length === 0;

  return (
    <div
      role="region"
      aria-label="Automations"
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-edge"
        data-tauri-drag-region="deep"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13.5px]">
          <span className="shrink-0 text-faint">Automations</span>
          <span aria-hidden className="shrink-0 text-dim">
            /
          </span>
          <span className="min-w-0 truncate text-content">
            {counts.active + counts.running > 0
              ? `${counts.active + counts.running} scheduled`
              : "Nothing scheduled"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pr-2" data-tauri-drag-region="false">
          <button
            type="button"
            aria-pressed={state.allPaused}
            onClick={() => void pauseAllAutomations(!state.allPaused).catch(() => undefined)}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              state.allPaused
                ? "bg-amber-400/15 text-amber-300 hover:bg-amber-400/22"
                : "text-muted hover:bg-hover hover:text-content"
            }`}
          >
            <Pause className="size-3.5" strokeWidth={1.75} />
            {state.allPaused ? "All paused" : "Pause all"}
          </button>
        </div>
        {IS_MAC ? null : <WindowControls />}
      </div>

      {state.allPaused ? (
        <p className="flex items-center gap-2 border-b border-edge bg-amber-400/8 px-4 py-1.5 text-[11.5px] text-amber-300">
          <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
          Every automation is held. Nothing runs until you release the pause.
        </p>
      ) : null}
      {state.error ? (
        <p className="border-b border-edge px-4 py-1.5 text-[11.5px] text-red-400">{state.error}</p>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 w-70 shrink-0 flex-col border-r border-edge">
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-edge px-2">
            <div className="relative flex h-7 min-w-0 flex-1 items-center">
              <Search className="pointer-events-none absolute left-2 size-3 shrink-0 opacity-50" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter automations"
                aria-label="Filter automations"
                spellCheck={false}
                autoComplete="off"
                className="h-7 w-full rounded-md bg-transparent pl-7 pr-2 text-[12.5px] text-content outline-none placeholder:text-dim"
              />
            </div>
            <button
              type="button"
              title="New automation"
              aria-label="New automation"
              disabled={projects.length === 0}
              onClick={openNew}
              className="grid size-6 shrink-0 place-items-center rounded-md text-faint hover:bg-hover hover:text-content disabled:opacity-40"
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>

          <div ref={listLock} className="min-h-0 flex-1 overflow-y-auto overscroll-none">
            {!empty ? (
              <div
                role="group"
                aria-label="Filter automations by state"
                className="sticky top-0 z-10 flex flex-col gap-1 border-b border-edge bg-background-base/90 px-3 py-2 backdrop-blur-md"
              >
                <div className="flex flex-wrap gap-1">
                  {FILTERS.map((entry) => (
                    <FilterChip
                      key={entry}
                      label={entry === "all" ? "All" : AUTOMATION_STATUS_LABEL[entry]}
                      count={counts[entry]}
                      active={filter === entry}
                      tone={entry === "failing" ? "attention" : "default"}
                      onClick={() => setFilter(entry)}
                    />
                  ))}
                </div>
                {projectFilters.length > 1 ? (
                  <select
                    value={project}
                    aria-label="Filter by project"
                    onChange={(event) => setProject(event.target.value)}
                    className="w-full rounded-md border border-edge bg-content/5 px-2 py-1 text-[11.5px] text-content outline-none hover:border-edge-strong"
                  >
                    <option value="">Every project</option>
                    {projectFilters.map(([key, cwd]) => (
                      <option key={key} value={key}>
                        {projectName(cwd)}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : null}

            {state.loading && empty ? (
              <div className="flex justify-center py-10 text-dim">
                <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
              </div>
            ) : empty ? (
              <p className="px-3 py-2 text-[12.5px] text-faint">
                {projects.length > 0
                  ? "No automations yet. An automation is a prompt, a project, and a schedule."
                  : "No automations yet. Open a project first — an automation runs in a real checkout."}
              </p>
            ) : visible.length === 0 ? (
              <p className="px-3 py-2 text-[12.5px] text-faint">No matching automations</p>
            ) : (
              <ul className="flex flex-col gap-0.5 p-1.5">
                {visible.map((automation) => (
                  <li key={automation.id}>
                    <AutomationCard
                      automation={automation}
                      status={statusOf(automation)}
                      active={selected?.id === automation.id}
                      now={now}
                      onSelect={() => setSelectedId(automation.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none">
          {selected ? (
            <Detail
              automation={selected}
              status={statusOf(selected)}
              runs={history}
              now={now}
              confirmDelete={confirmDelete === selected.id}
              onRunNow={() => void runAutomationNow(selected.id).catch(() => undefined)}
              onStop={() => void stopAutomationRun(selected.id).catch(() => undefined)}
              onToggle={() =>
                void setAutomationEnabled(selected.id, !selected.enabled).catch(() => undefined)
              }
              onEdit={() => setEditing({ draft: automationDraft(selected), existing: selected })}
              onDuplicate={() => setEditing({ draft: duplicateDraft(selected), existing: null })}
              onDelete={() => {
                if (confirmDelete !== selected.id) {
                  setConfirmDelete(selected.id);
                  return;
                }
                setConfirmDelete(null);
                void deleteAutomation(selected.id).catch(() => undefined);
              }}
              onOpenSession={onOpenSession}
            />
          ) : (
            <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center px-6 text-center">
              <Clock className="mb-3 size-6 text-dim" strokeWidth={1.75} />
              <p className="text-[13.5px] text-faint">Select an automation</p>
            </div>
          )}
        </div>
      </div>

      {editing ? (
        <AutomationDialog
          draft={editing.draft}
          existing={editing.existing}
          projects={projects}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      ) : null}
    </div>
  );
}

function AutomationCard({
  automation,
  status,
  active,
  now,
  onSelect,
}: {
  automation: Automation;
  status: AutomationListStatus;
  active: boolean;
  now: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      className={`flex w-full flex-col rounded-md border px-2.5 py-2 text-left ${
        active
          ? "border-transparent bg-selected text-content"
          : "border-transparent text-strong hover:bg-hover hover:text-content"
      }`}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${STATUS_TONE[status]}`} />
        <span className="min-w-0 flex-1 truncate text-[12.5px]">{automation.name}</span>
        <HarnessIcon harness={automation.harness} className="size-3 shrink-0" />
      </span>
      <span className="mt-0.5 truncate text-[11.5px] leading-tight text-faint">
        {projectName(automation.cwd)} · {scheduleLine(automation)}
      </span>
      <span className="truncate text-[11.5px] leading-tight text-dim">
        {nextRunLine(automation, status, now)}
      </span>
    </button>
  );
}

function Detail({
  automation,
  status,
  runs,
  now,
  confirmDelete,
  onRunNow,
  onStop,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
  onOpenSession,
}: {
  automation: Automation;
  status: AutomationListStatus;
  runs: AutomationRun[];
  now: number;
  confirmDelete: boolean;
  onRunNow: () => void;
  onStop: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpenSession: (sessionId: string, hostId: HostId) => void;
}) {
  const upcoming = useMemo(
    () =>
      automation.enabled
        ? upcomingRuns(automation.schedule, now, 3, automation.timeZone, automation.dstPolicy)
        : [],
    [automation, now],
  );
  // A path is only unique on the machine that owns it, so the surface names
  // that machine rather than leaving the path to speak for itself.
  const host = isRemoteHostId(automation.hostId) ? connectionSnapshot(automation.hostId) : null;

  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-medium leading-tight text-content">
            {automation.name}
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-snug text-faint">{scheduleLine(automation)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] leading-snug text-dim">
            {status === "running" ? (
              <LoaderCircle className="size-3 shrink-0 animate-spin" strokeWidth={1.75} />
            ) : null}
            {nextRunLine(automation, status, now)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {status === "running" ? (
            <SecondaryButton onClick={onStop}>
              <Square className="size-3.5" strokeWidth={1.75} />
              Stop
            </SecondaryButton>
          ) : (
            <SecondaryButton onClick={onRunNow}>
              <Play className="size-3.5" strokeWidth={1.75} />
              Run now
            </SecondaryButton>
          )}
          <SecondaryButton onClick={onToggle}>
            {automation.enabled ? (
              <Pause className="size-3.5" strokeWidth={1.75} />
            ) : (
              <Play className="size-3.5" strokeWidth={1.75} />
            )}
            {automation.enabled ? "Pause" : "Resume"}
          </SecondaryButton>
          <SecondaryButton onClick={onEdit}>
            <Pencil className="size-3.5" strokeWidth={1.75} />
            Edit
          </SecondaryButton>
          <SecondaryButton onClick={onDuplicate}>
            <Copy className="size-3.5" strokeWidth={1.75} />
            Duplicate
          </SecondaryButton>
          <SecondaryButton danger onClick={onDelete}>
            <Trash2 className="size-3.5" strokeWidth={1.75} />
            {confirmDelete ? "Click again to delete" : "Delete"}
          </SecondaryButton>
        </div>
      </header>

      {host && host.phase !== "connected" ? (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-amber-300">
          <CircleAlert className="mt-px size-3 shrink-0" strokeWidth={1.75} />
          {host.name} is not connected. This automation cannot run until it is.
        </p>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[12.5px] leading-tight">
        <Row label="Runs in">{prettyCwd(automation.cwd)}</Row>
        <Row label="On">{host ? host.name : "This device"}</Row>
        <Row label="Agent">
          {automation.harness}
          {automation.model ? ` · ${automation.model}` : ""} ·{" "}
          {RUNTIME_MODE_LABEL[automation.runtimeMode]}
        </Row>
        <Row label="Run count">
          {automation.runCount}
          {automation.maxRuns ? ` of ${automation.maxRuns}` : ""}
        </Row>
      </dl>

      <Section title="Prompt">
        <p className="whitespace-pre-wrap rounded-md bg-content/5 px-2.5 py-2 font-mono text-[11.5px] leading-5 text-strong">
          {automation.prompt}
        </p>
      </Section>

      {upcoming.length > 0 ? (
        <Section title="Upcoming">
          <ul className="flex flex-col gap-0.5">
            {upcoming.map((run) => (
              <li key={run} className="text-[11.5px] leading-tight text-faint">
                {formatMoment(run, automation.timeZone)}
                <span className="ml-1.5 text-dim">{relativeMoment(run, now)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="History">
        {runs.length === 0 ? (
          <p className="text-[12.5px] text-faint">
            This automation has not run yet. Use Run now to try it before it goes on the schedule.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {runs.map((run) => (
              <li
                key={run.id}
                className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-hover"
              >
                <span className={`w-24 shrink-0 text-[11.5px] ${RUN_TONE[run.status]}`}>
                  {RUN_STATUS_LABEL[run.status]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11.5px] leading-tight text-muted">
                    {formatMoment(run.startedAt, automation.timeZone)} · {runDurationText(run, now)}
                  </span>
                  {run.error || run.summary ? (
                    <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-dim">
                      {run.error ?? run.summary}
                    </span>
                  ) : null}
                </span>
                {run.status !== "running" && run.status !== "success" ? (
                  <button
                    type="button"
                    onClick={onRunNow}
                    className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-faint hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <RefreshCw className="size-3" strokeWidth={1.75} />
                    Retry
                  </button>
                ) : null}
                {run.sessionId ? (
                  <button
                    type="button"
                    onClick={() => onOpenSession(run.sessionId!, automation.hostId)}
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] text-faint hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Open
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="pb-2 text-[13.5px] font-semibold uppercase tracking-[0.07em] text-faint">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-dim">{label}</dt>
      <dd className="min-w-0 truncate text-muted">{children}</dd>
    </>
  );
}
