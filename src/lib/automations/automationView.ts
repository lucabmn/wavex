/**
 * What the automations surface shows, kept out of the components that show it.
 *
 * The list has a search box, five status filters, and a per-project and
 * per-host filter, which together are the part of the surface worth testing;
 * the markup around them is not.
 */

import { fuzzyMatch } from "../fuzzy";
import { projectKey } from "../host";
import { projectName } from "../paths";
import type { Automation, AutomationRun, PausedReason } from "./automation";
import { PAUSED_REASON_TEXT } from "./automation";
import { describeSchedule, formatMoment } from "./schedule";

/**
 * `failing` is not a stored flag: it is what an enabled automation whose last
 * finished run failed looks like, so the list can surface it without a second
 * column in the database that could disagree with the history.
 */
export type AutomationListStatus = "running" | "failing" | "active" | "paused" | "finished";

export const AUTOMATION_STATUS_LABEL: Record<AutomationListStatus, string> = {
  running: "Running",
  failing: "Failing",
  active: "Active",
  paused: "Paused",
  finished: "Finished",
};

export type AutomationFilter = "all" | AutomationListStatus;

export function automationStatus(
  automation: Automation,
  input: { running: boolean; lastRun?: AutomationRun },
): AutomationListStatus {
  if (input.running) return "running";
  if (automation.pausedReason === "max-runs" || automation.pausedReason === "end-date") {
    return "finished";
  }
  if (!automation.enabled) return "paused";
  return input.lastRun?.status === "failed" ? "failing" : "active";
}

/** The newest run of each automation, for the list rows. */
export function latestRuns(runs: readonly AutomationRun[]): Map<string, AutomationRun> {
  const newest = new Map<string, AutomationRun>();
  for (const run of runs) {
    const held = newest.get(run.automationId);
    if (!held || run.startedAt > held.startedAt) newest.set(run.automationId, run);
  }
  return newest;
}

export type AutomationQuery = {
  text?: string;
  status?: AutomationFilter;
  /** A `projectKey`, which namespaces a remote project by its host. */
  project?: string;
};

export function filterAutomations(
  automations: readonly Automation[],
  query: AutomationQuery,
  statusOf: (automation: Automation) => AutomationListStatus,
): Automation[] {
  const text = (query.text ?? "").trim();
  return automations.filter((automation) => {
    if (query.status && query.status !== "all" && statusOf(automation) !== query.status) {
      return false;
    }
    if (query.project && projectKey(automation.projectRef) !== query.project) return false;
    if (!text) return true;
    // Name, prompt, and project all read as "what is this automation", so any
    // of the three matching is a hit.
    return (
      fuzzyMatch(text, automation.name) != null ||
      automation.prompt.toLowerCase().includes(text.toLowerCase()) ||
      fuzzyMatch(text, projectName(automation.cwd)) != null
    );
  });
}

export function automationCounts(
  automations: readonly Automation[],
  statusOf: (automation: Automation) => AutomationListStatus,
): Record<AutomationFilter, number> {
  const counts: Record<AutomationFilter, number> = {
    all: automations.length,
    running: 0,
    failing: 0,
    active: 0,
    paused: 0,
    finished: 0,
  };
  for (const automation of automations) counts[statusOf(automation)] += 1;
  return counts;
}

/**
 * The one line under an automation's name. It says what it does next, or why
 * it will not — never a next-run time for something that is not going to run.
 */
export function nextRunLine(
  automation: Automation,
  status: AutomationListStatus,
  nowMs: number,
): string {
  if (status === "running") return "Running now";
  if (status === "finished" || (!automation.enabled && automation.pausedReason)) {
    return PAUSED_REASON_TEXT[automation.pausedReason as Exclude<PausedReason, "">];
  }
  if (!automation.enabled) return "Paused.";
  if (automation.nextDueAt == null) return "Nothing scheduled.";
  if (automation.nextDueAt <= nowMs) return "Due now.";
  return `Next run ${formatMoment(automation.nextDueAt, automation.timeZone)}`;
}

/** The schedule sentence with its zone, for the row and the confirm step. */
export function scheduleLine(automation: Automation): string {
  return `${describeSchedule(automation.schedule, automation.timeZone)} · ${automation.timeZone}`;
}

/** "in 3h 20m" / "4m ago", for a next-run or last-run hint. */
export function relativeMoment(ms: number, nowMs: number): string {
  const delta = ms - nowMs;
  const ahead = delta >= 0;
  const seconds = Math.round(Math.abs(delta) / 1000);
  const text =
    seconds < 60
      ? `${Math.max(1, seconds)}s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m`
        : seconds < 86_400
          ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`.replace(
              / 0m$/,
              "",
            )
          : `${Math.floor(seconds / 86_400)}d`;
  return ahead ? `in ${text}` : `${text} ago`;
}

export function runDurationText(run: AutomationRun, nowMs: number): string {
  const end = run.finishedAt ?? nowMs;
  const seconds = Math.max(1, Math.round((end - run.startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`.replace(/ 0s$/, "");
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`.replace(/ 0m$/, "");
}
