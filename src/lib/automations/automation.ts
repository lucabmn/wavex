/**
 * What a scheduled agent task is.
 *
 * An automation is a prompt, a place to run it, and a schedule. It is never a
 * session: each run creates a normal persisted session, so a run's prompt,
 * tool activity, result, and failure stay inspectable in the same surfaces
 * every other session uses.
 *
 * The record carries its target as both a `projectRef` — the form the rail, a
 * tab, and a session hold, which names the owning host — and the bare `cwd`
 * that host stores paths under. A schedule that fires while its host is
 * unreachable is a failed run, never a run somewhere else.
 */

import { HARNESSES, RUNTIME_MODES, type HarnessId, type RuntimeMode } from "../session";
import { LOCAL_HOST_ID, normalizeHostId, type HostId } from "../host";
import {
  MIN_INTERVAL_MS,
  intervalMs,
  isDstPolicy,
  normalizeSchedule,
  parseTime,
  type DstPolicy,
  type Schedule,
} from "./schedule";
import { localTimeZone, normalizeTimeZone } from "./zone";

/** New runs skip while one is active; `queue` holds exactly one behind it. */
export type OverlapPolicy = "skip" | "queue";

export const OVERLAP_POLICIES: OverlapPolicy[] = ["skip", "queue"];

export const OVERLAP_POLICY_LABEL: Record<OverlapPolicy, string> = {
  skip: "Skip the new run",
  queue: "Queue one run",
};

export const OVERLAP_POLICY_HINT: Record<OverlapPolicy, string> = {
  skip: "If the previous run is still going, do not start another.",
  queue:
    "If the previous run is still going, start one more when it finishes. A run started in another window is skipped instead.",
};

/** What to do about occurrences that came due while this host was not running. */
export type MissedPolicy = "once" | "skip";

export const MISSED_POLICIES: MissedPolicy[] = ["once", "skip"];

export const MISSED_POLICY_LABEL: Record<MissedPolicy, string> = {
  once: "Run once when wavex is back",
  skip: "Wait for the next scheduled time",
};

export const MISSED_POLICY_HINT: Record<MissedPolicy, string> = {
  once: "Missed occurrences collapse into a single catch-up run.",
  skip: "Nothing catches up; the schedule resumes at its next time.",
};

export type PausedReason = "" | "manual" | "failures" | "max-runs" | "end-date";

export const PAUSED_REASON_TEXT: Record<Exclude<PausedReason, "">, string> = {
  manual: "Paused.",
  failures: "Paused after repeated failures.",
  "max-runs": "Finished — it reached its run limit.",
  "end-date": "Finished — it passed its final date.",
};

export type Automation = {
  id: string;
  name: string;
  prompt: string;
  /** Persisted project reference; a bare path means the machine this client is. */
  projectRef: string;
  /** The checkout the agent runs in, as the owning host stores it. */
  cwd: string;
  hostId: HostId;
  harness: HarnessId;
  /** Empty means the harness picks, exactly as a new session does. */
  model: string;
  runtimeMode: RuntimeMode;
  schedule: Schedule;
  timeZone: string;
  dstPolicy: DstPolicy;
  overlapPolicy: OverlapPolicy;
  missedPolicy: MissedPolicy;
  notify: boolean;
  enabled: boolean;
  /** Optional end conditions. */
  endAtMs?: number;
  maxRuns?: number;
  nextDueAt: number | null;
  lastRunAt?: number;
  runCount: number;
  pausedReason: PausedReason;
  createdAt: number;
  updatedAt: number;
};

export type RunStatus =
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "needs-attention"
  | "interrupted";

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: "Running",
  success: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  "needs-attention": "Needs you",
  interrupted: "Interrupted",
};

export type AutomationRun = {
  id: string;
  automationId: string;
  /**
   * Null when the run failed before a session existed — a checkout that is
   * gone, a harness that is not installed, a host that is not reachable. Those
   * still have to appear in the history.
   */
  sessionId: string | null;
  dueAt: number;
  startedAt: number;
  finishedAt: number | null;
  status: RunStatus;
  error?: string;
  summary?: string;
};

export const AUTOMATION_NAME_MAX = 64;
export const AUTOMATION_PROMPT_MAX = 100_000;
/** Per-automation history cap. Bounded so a year of runs is not unbounded rows. */
export const RUN_HISTORY_MAX = 50;

export type AutomationDraft = Omit<
  Automation,
  "id" | "nextDueAt" | "lastRunAt" | "runCount" | "pausedReason" | "createdAt" | "updatedAt"
>;

export function newAutomationDraft(input: {
  projectRef: string;
  cwd: string;
  hostId?: HostId;
  harness: HarnessId;
  model?: string;
  runtimeMode?: RuntimeMode;
  nowMs?: number;
}): AutomationDraft {
  const timeZone = localTimeZone();
  return {
    name: "",
    prompt: "",
    projectRef: input.projectRef,
    cwd: input.cwd,
    hostId: normalizeHostId(input.hostId ?? LOCAL_HOST_ID),
    harness: input.harness,
    model: input.model ?? "",
    runtimeMode: input.runtimeMode ?? "supervised",
    schedule: {
      kind: "interval",
      every: 4,
      unit: "hours",
      anchorMs: input.nowMs ?? Date.now(),
    },
    timeZone,
    dstPolicy: "shift",
    overlapPolicy: "skip",
    missedPolicy: "once",
    notify: true,
    // Never enabled by creation: the schedule, target, harness, and prompt are
    // confirmed against a resolved preview first.
    enabled: false,
  };
}

export type ValidationIssue = { field: string; message: string };

/**
 * Everything that would make an automation unsafe or impossible to run,
 * reported together so the form can mark each field rather than failing on the
 * first one.
 */
export function validateAutomation(
  draft: Partial<AutomationDraft>,
  nowMs = Date.now(),
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const name = (draft.name ?? "").trim();
  if (!name) issues.push({ field: "name", message: "Give this automation a name." });
  else if (name.length > AUTOMATION_NAME_MAX) {
    issues.push({
      field: "name",
      message: `Keep the name under ${AUTOMATION_NAME_MAX} characters.`,
    });
  }

  const prompt = (draft.prompt ?? "").trim();
  if (!prompt) issues.push({ field: "prompt", message: "Write the prompt to run." });
  else if (prompt.length > AUTOMATION_PROMPT_MAX) {
    issues.push({ field: "prompt", message: "This prompt is too large to store." });
  }

  if (!(draft.cwd ?? "").trim() || !(draft.projectRef ?? "").trim()) {
    issues.push({ field: "target", message: "Choose a project and checkout to run in." });
  }

  if (!draft.harness || !HARNESSES.includes(draft.harness)) {
    issues.push({ field: "harness", message: "Choose an agent to run this with." });
  }

  if (draft.runtimeMode && !RUNTIME_MODES.includes(draft.runtimeMode)) {
    issues.push({ field: "runtimeMode", message: "Choose how much this run may do on its own." });
  }

  const schedule = draft.schedule;
  if (!schedule) {
    issues.push({ field: "schedule", message: "Choose when this should run." });
  } else if (schedule.kind === "interval") {
    if (!Number.isInteger(schedule.every) || schedule.every < 1) {
      issues.push({ field: "schedule", message: "Enter how often this repeats." });
    } else if (intervalMs(schedule) < MIN_INTERVAL_MS) {
      issues.push({
        field: "schedule",
        message: `The shortest supported interval is ${MIN_INTERVAL_MS / 60_000} minutes.`,
      });
    }
  } else if (schedule.kind === "weekly") {
    if (schedule.days.length === 0) {
      issues.push({ field: "schedule", message: "Pick at least one day." });
    }
    if (!parseTime(schedule.time)) {
      issues.push({ field: "schedule", message: "Enter a time as HH:MM." });
    }
  } else if (schedule.kind === "once" && schedule.atMs <= nowMs) {
    issues.push({ field: "schedule", message: "Pick a date and time in the future." });
  }

  if (draft.timeZone !== undefined && normalizeTimeZone(draft.timeZone) !== draft.timeZone) {
    issues.push({ field: "timeZone", message: "Choose a time zone." });
  }

  if (draft.maxRuns !== undefined && (!Number.isInteger(draft.maxRuns) || draft.maxRuns < 1)) {
    issues.push({ field: "maxRuns", message: "A run limit has to be one or more." });
  }

  if (draft.endAtMs !== undefined && draft.endAtMs <= nowMs) {
    issues.push({ field: "endAtMs", message: "A final date has to be in the future." });
  }

  return issues;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function positiveInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Read a record that came from the host. Nothing here may throw on a bad row. */
export function normalizeAutomation(raw: unknown): Automation | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id : "";
  if (!id) return null;
  const nextDueAt = Number(value.nextDueAt);
  const lastRunAt = Number(value.lastRunAt);
  return {
    id,
    name: typeof value.name === "string" ? value.name : "",
    prompt: typeof value.prompt === "string" ? value.prompt : "",
    projectRef: typeof value.projectRef === "string" ? value.projectRef : "",
    cwd: typeof value.cwd === "string" ? value.cwd : "",
    hostId: normalizeHostId(value.hostId),
    harness: pickEnum(value.harness, HARNESSES, "claude"),
    model: typeof value.model === "string" ? value.model : "",
    runtimeMode: pickEnum(value.runtimeMode, RUNTIME_MODES, "supervised"),
    schedule: normalizeSchedule(value.schedule),
    timeZone: normalizeTimeZone(value.timeZone),
    dstPolicy: isDstPolicy(value.dstPolicy) ? value.dstPolicy : "shift",
    overlapPolicy: pickEnum(value.overlapPolicy, OVERLAP_POLICIES, "skip"),
    missedPolicy: pickEnum(value.missedPolicy, MISSED_POLICIES, "once"),
    notify: value.notify !== false,
    enabled: value.enabled === true,
    ...(positiveInt(value.endAtMs) ? { endAtMs: Number(value.endAtMs) } : {}),
    ...(positiveInt(value.maxRuns) ? { maxRuns: Number(value.maxRuns) } : {}),
    nextDueAt: Number.isFinite(nextDueAt) && nextDueAt > 0 ? nextDueAt : null,
    ...(Number.isFinite(lastRunAt) && lastRunAt > 0 ? { lastRunAt } : {}),
    runCount: Math.max(0, Math.trunc(Number(value.runCount) || 0)),
    pausedReason: pickEnum(
      value.pausedReason,
      ["", "manual", "failures", "max-runs", "end-date"] as const,
      "",
    ),
    createdAt: Number(value.createdAt) || 0,
    updatedAt: Number(value.updatedAt) || 0,
  };
}

/**
 * The settings half of a record, for the editor.
 *
 * Written out rather than spread-and-delete so a field added to `Automation`
 * fails to compile here instead of quietly vanishing the next time somebody
 * opens the form and saves.
 */
export function automationDraft(automation: Automation): AutomationDraft {
  return {
    name: automation.name,
    prompt: automation.prompt,
    projectRef: automation.projectRef,
    cwd: automation.cwd,
    hostId: automation.hostId,
    harness: automation.harness,
    model: automation.model,
    runtimeMode: automation.runtimeMode,
    schedule: automation.schedule,
    timeZone: automation.timeZone,
    dstPolicy: automation.dstPolicy,
    overlapPolicy: automation.overlapPolicy,
    missedPolicy: automation.missedPolicy,
    notify: automation.notify,
    enabled: automation.enabled,
    ...(automation.endAtMs != null ? { endAtMs: automation.endAtMs } : {}),
    ...(automation.maxRuns != null ? { maxRuns: automation.maxRuns } : {}),
  };
}

const RUN_STATUSES: RunStatus[] = [
  "running",
  "success",
  "failed",
  "cancelled",
  "needs-attention",
  "interrupted",
];

/**
 * Read a run row that came from the host. A row whose status the host has
 * grown and this build has not reads as interrupted rather than as a blank
 * label: an unknown state is over, not going.
 */
export function normalizeRun(raw: unknown): AutomationRun | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id : "";
  const automationId = typeof value.automationId === "string" ? value.automationId : "";
  if (!id || !automationId) return null;
  const finishedAt = Number(value.finishedAt);
  return {
    id,
    automationId,
    sessionId: typeof value.sessionId === "string" && value.sessionId ? value.sessionId : null,
    dueAt: Number(value.dueAt) || 0,
    startedAt: Number(value.startedAt) || 0,
    finishedAt: Number.isFinite(finishedAt) && finishedAt > 0 ? finishedAt : null,
    status: pickEnum(value.status, RUN_STATUSES, "interrupted"),
    ...(typeof value.error === "string" && value.error ? { error: value.error } : {}),
    ...(typeof value.summary === "string" && value.summary ? { summary: value.summary } : {}),
  };
}

/** A copy the user is expected to edit: never enabled, never carrying history. */
export function duplicateDraft(automation: Automation): AutomationDraft {
  return {
    ...automationDraft(automation),
    name: `${automation.name} copy`.slice(0, AUTOMATION_NAME_MAX),
    enabled: false,
  };
}
