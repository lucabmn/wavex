/**
 * Subscription limits, as the providers themselves report them.
 *
 * This is the other half of usage: the token history says what was spent, this
 * says how much of the plan is left before the next reset. Only the providers
 * that publish a limit appear — Claude over its OAuth usage endpoint, Codex
 * over its app-server. Nothing here is inferred from the transcripts.
 *
 * A plan's window set is not fixed: Claude reports a session window plus one
 * or more weekly ones depending on the plan, and Codex only reports a session
 * window on plans that have one. So windows arrive as a list rather than as
 * named fields, and the view renders whatever came back.
 */
import { asRecord } from "../harness/codexProtocol";
import type { HarnessId } from "../session";

export type PlanLimitProvider = Extract<HarnessId, "claude" | "codex">;

/** Providers that publish a plan limit at all, in reading order. */
export const PLAN_LIMIT_PROVIDERS: PlanLimitProvider[] = ["claude", "codex"];

export type PlanLimitStatus = "loading" | "ok" | "unavailable" | "error";

export type PlanLimitWindow = {
  /** Stable key for React and for ordering. */
  id: string;
  label: string;
  usedPercent: number;
  /** Unix ms when the window resets, when the provider says. */
  resetsAt: number | null;
};

export type PlanLimits = {
  provider: PlanLimitProvider;
  status: PlanLimitStatus;
  /** Plan name when the provider names one, such as Codex's `plan_type`. */
  plan: string | null;
  windows: PlanLimitWindow[];
  updatedAt: number;
  error: string | null;
};

export function loadingPlanLimits(provider: PlanLimitProvider): PlanLimits {
  return { provider, status: "loading", plan: null, windows: [], updatedAt: 0, error: null };
}

export function unavailablePlanLimits(provider: PlanLimitProvider, error: string): PlanLimits {
  return {
    provider,
    status: "unavailable",
    plan: null,
    windows: [],
    updatedAt: Date.now(),
    error,
  };
}

export function errorPlanLimits(provider: PlanLimitProvider, error: string): PlanLimits {
  return { provider, status: "error", plan: null, windows: [], updatedAt: Date.now(), error };
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Whole percent: a plan limit is never quoted more precisely than that. */
export function formatPercent(usedPercent: number): string {
  return `${Math.round(clampPercent(usedPercent))}%`;
}

/** Compact remaining duration, floored: `47m`, `3h 54m`, `6d 7h`. */
export function formatResetIn(ms: number): string {
  if (ms <= 0) return "now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest > 0 ? `${days}d ${rest}h` : `${days}d`;
}

export function formatResetLabel(resetsAt: number | null, now = Date.now()): string {
  if (resetsAt === null) return "No reset reported";
  const remaining = resetsAt - now;
  return remaining <= 0 ? "Resets now" : `Resets in ${formatResetIn(remaining)}`;
}

/** How close to the cap a window is, for the bar's colour. */
export function limitSeverity(usedPercent: number): "normal" | "high" | "critical" {
  const percent = clampPercent(usedPercent);
  if (percent >= 90) return "critical";
  if (percent >= 75) return "high";
  return "normal";
}

export function parseResetTimestamp(value: unknown): number | null {
  if (typeof value === "number") return normalizeEpochMs(value);
  if (typeof value !== "string" || value.trim() === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return normalizeEpochMs(numeric);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeEpochMs(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  // 1e10 sits between a seconds epoch (before 2286) and a millisecond one
  // (after 2001), which is the only ambiguity these payloads present.
  return value > 10_000_000_000 ? value : value * 1000;
}

function numberField(rec: Record<string, unknown>, key: string): number | null {
  const value = rec[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Claude                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Window names Anthropic uses, in the order a reader wants them.
 *
 * The endpoint carries more keys than any one plan uses, and the set changes;
 * anything unknown is title-cased from its own name rather than dropped, so a
 * new window shows up on its own.
 */
const CLAUDE_WINDOW_LABELS: Record<string, string> = {
  session: "5-hour session",
  five_hour: "5-hour session",
  weekly: "Weekly",
  weekly_all: "Weekly",
  seven_day: "Weekly",
  weekly_opus: "Weekly · Opus",
  seven_day_opus: "Weekly · Opus",
  weekly_sonnet: "Weekly · Sonnet",
  seven_day_sonnet: "Weekly · Sonnet",
  seven_day_oauth_apps: "Weekly · apps",
  opus: "Weekly · Opus",
};

const CLAUDE_WINDOW_ORDER = ["session", "five_hour", "weekly", "weekly_all", "seven_day"];

function claudeWindowLabel(kind: string): string {
  const known = CLAUDE_WINDOW_LABELS[kind];
  if (known) return known;
  return kind
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function claudeWindowRank(id: string): number {
  const index = CLAUDE_WINDOW_ORDER.indexOf(id);
  return index === -1 ? CLAUDE_WINDOW_ORDER.length : index;
}

/**
 * Reads the OAuth usage payload.
 *
 * The named `five_hour` / `seven_day*` fields are read first. The `limits`
 * array looked like the better source because it is the plan's own list, but
 * it marks a live weekly window `is_active: false` — a real percentage and a
 * real reset arrive under a flag that would drop it — so it is the fallback
 * for payloads that carry no named field.
 */
export function parseClaudePlanLimits(body: string): PlanLimits {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return errorPlanLimits("claude", "Claude usage response was not JSON");
  }
  const rec = asRecord(parsed);
  if (!rec) return errorPlanLimits("claude", "Claude usage response was empty");

  const named = claudeWindowsFromFields(rec);
  const windows = named.length > 0 ? named : (claudeWindowsFromLimits(rec) ?? []);
  if (windows.length === 0) {
    return unavailablePlanLimits("claude", "Claude reported no plan limits");
  }
  windows.sort((a, b) => claudeWindowRank(a.id) - claudeWindowRank(b.id));

  return {
    provider: "claude",
    status: "ok",
    plan: null,
    windows,
    updatedAt: Date.now(),
    error: null,
  };
}

function claudeWindowsFromLimits(rec: Record<string, unknown>): PlanLimitWindow[] | null {
  const limits = rec.limits;
  if (!Array.isArray(limits)) return null;
  const windows: PlanLimitWindow[] = [];
  for (const entry of limits) {
    const limit = asRecord(entry);
    if (!limit) continue;
    // A scoped limit caps one model or surface rather than the plan, and it
    // reports zero for accounts that never reach it. `is_active` is not the
    // test: the live weekly window arrives with it set to false.
    if (limit.scope != null) continue;
    const id =
      (typeof limit.kind === "string" && limit.kind.trim()) ||
      (typeof limit.group === "string" && limit.group.trim()) ||
      "";
    if (!id) continue;
    const percent = numberField(limit, "percent") ?? numberField(limit, "utilization");
    if (percent === null) continue;
    windows.push({
      id,
      label: claudeWindowLabel(id),
      usedPercent: clampPercent(percent),
      resetsAt: parseResetTimestamp(limit.resets_at),
    });
  }
  return windows.length > 0 ? windows : null;
}

/**
 * Reads the named windows.
 *
 * `five_hour` plus every `seven_day*` bucket: the endpoint carries more of the
 * latter than any one plan uses and adds new ones over time, and the unused
 * ones are null. The prefix is the filter rather than a fixed list so a new
 * weekly bucket shows up on its own; it also keeps out the codename keys the
 * payload carries for unreleased features, which report a flat zero with no
 * reset and would each render a card.
 */
function claudeWindowsFromFields(rec: Record<string, unknown>): PlanLimitWindow[] {
  const keys = ["five_hour", ...Object.keys(rec).filter((key) => key.startsWith("seven_day"))];
  const windows: PlanLimitWindow[] = [];
  for (const key of keys) {
    const field = asRecord(rec[key]);
    if (!field) continue;
    const percent = numberField(field, "utilization") ?? numberField(field, "used_percentage");
    if (percent === null) continue;
    windows.push({
      id: key,
      label: claudeWindowLabel(key),
      usedPercent: clampPercent(percent),
      resetsAt: parseResetTimestamp(field.resets_at),
    });
  }
  return windows;
}

/* -------------------------------------------------------------------------- */
/* Codex                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Names a Codex window from the duration it reports.
 *
 * Codex names neither window, and which ones exist depends on the plan — some
 * have no session window at all — so the duration is the only honest label.
 */
export function codexWindowLabel(windowMinutes: number | null): string {
  if (windowMinutes === null || !Number.isFinite(windowMinutes)) return "Rate limit";
  if (windowMinutes === 300) return "5-hour session";
  if (windowMinutes === 10_080) return "Weekly";
  if (windowMinutes % (60 * 24 * 7) === 0) {
    const weeks = windowMinutes / (60 * 24 * 7);
    return weeks === 1 ? "Weekly" : `${weeks}-week`;
  }
  if (windowMinutes % (60 * 24) === 0) {
    const days = windowMinutes / (60 * 24);
    return days === 1 ? "Daily" : `${days}-day`;
  }
  if (windowMinutes % 60 === 0) return `${windowMinutes / 60}-hour`;
  return `${windowMinutes}-minute`;
}

const CODEX_PLAN_LABELS: Record<string, string> = {
  free: "Free",
  plus: "Plus",
  pro: "Pro",
  business: "Business",
  team: "Team",
  enterprise: "Enterprise",
  edu: "Edu",
};

export function codexPlanLabel(planType: unknown): string | null {
  if (typeof planType !== "string" || planType.trim() === "") return null;
  const key = planType.trim().toLowerCase();
  return CODEX_PLAN_LABELS[key] ?? planType.trim();
}

/**
 * Reads the `account/rateLimits/read` result.
 *
 * Only the windows the account actually has come back, so a plan without a
 * session limit simply reports one window and the view shows one.
 */
export function parseCodexPlanLimits(result: unknown): PlanLimits {
  const rec = asRecord(result);
  const wrapper = asRecord(rec?.rateLimits) ?? rec;
  if (!wrapper) return unavailablePlanLimits("codex", "Codex reported no plan limits");

  const windows: PlanLimitWindow[] = [];
  for (const key of ["primary", "secondary"]) {
    const snapshot = asRecord(wrapper[key]);
    if (!snapshot) continue;
    const percent =
      numberField(snapshot, "usedPercent") ??
      numberField(snapshot, "used_percent") ??
      numberField(snapshot, "used_percentage");
    if (percent === null) continue;
    const windowMinutes =
      numberField(snapshot, "windowDurationMins") ??
      numberField(snapshot, "window_duration_mins") ??
      numberField(snapshot, "window_minutes");
    windows.push({
      id: key,
      label: codexWindowLabel(windowMinutes),
      usedPercent: clampPercent(percent),
      resetsAt: parseResetTimestamp(snapshot.resetsAt ?? snapshot.resets_at),
    });
  }

  if (windows.length === 0) {
    return unavailablePlanLimits("codex", "Codex reported no plan limits");
  }

  return {
    provider: "codex",
    status: "ok",
    plan: codexPlanLabel(wrapper.planType ?? wrapper.plan_type),
    windows,
    updatedAt: Date.now(),
    error: null,
  };
}
