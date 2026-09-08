/**
 * When an automation is next due.
 *
 * The schedule builder is structured rather than cron: the shapes below are
 * exactly the three sentences the UI can write, so a stored schedule always
 * reads back as the sentence the user confirmed. Cron would be one field that
 * covers all three and is impossible to preview honestly.
 *
 * Every occurrence is computed here, in TypeScript. The Rust side stores the
 * answer as an instant and never parses a schedule, so timezone and
 * daylight-saving rules exist once and are tested once.
 */

import { gapEndInstant, wallToInstant, zonedParts, type WallTime } from "./zone";

export type IntervalUnit = "minutes" | "hours" | "days" | "weeks";

/** 0 is Sunday, matching `Date.prototype.getDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Schedule =
  | {
      kind: "interval";
      every: number;
      unit: IntervalUnit;
      /**
       * Elapsed time is counted from here, so "every 4 hours" stays four
       * hours across a daylight-saving jump instead of drifting an hour.
       */
      anchorMs: number;
    }
  | { kind: "weekly"; days: Weekday[]; time: string }
  | { kind: "once"; atMs: number };

/**
 * What to do with a wall time the spring-forward jump deletes. `shift` runs it
 * the moment the clock reaches the skipped hour; `skip` passes that occurrence
 * over. An hour that the autumn fall-back repeats runs once either way — a
 * schedule that fires twice on one day is never what was asked for.
 */
export type DstPolicy = "shift" | "skip";

export const DST_POLICIES: DstPolicy[] = ["shift", "skip"];

export const DST_POLICY_LABEL: Record<DstPolicy, string> = {
  shift: "Run at the next valid time",
  skip: "Skip that day",
};

export const DST_POLICY_HINT: Record<DstPolicy, string> = {
  shift: "When the clock skips the scheduled hour, run as soon as it passes.",
  skip: "When the clock skips the scheduled hour, wait for the next occurrence.",
};

/**
 * A floor on how often an automation may run, so a slipped digit cannot turn
 * into a machine spawning agents faster than they finish.
 */
export const MIN_INTERVAL_MS = 5 * 60_000;

export const EVERY_DAY: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];

export const DEFAULT_TIME = "09:00";

const UNIT_MS: Record<IntervalUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 7 * 86_400_000,
};

const UNIT_LABEL: Record<IntervalUnit, [one: string, many: string]> = {
  minutes: ["minute", "minutes"],
  hours: ["hour", "hours"],
  days: ["day", "days"],
  weeks: ["week", "weeks"],
};

const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isIntervalUnit(value: unknown): value is IntervalUnit {
  return value === "minutes" || value === "hours" || value === "days" || value === "weeks";
}

export function isDstPolicy(value: unknown): value is DstPolicy {
  return value === "shift" || value === "skip";
}

export function intervalMs(schedule: Extract<Schedule, { kind: "interval" }>): number {
  return Math.max(1, Math.round(schedule.every)) * UNIT_MS[schedule.unit];
}

/** Smallest whole count of `unit` that still clears the supported minimum. */
export function minEvery(unit: IntervalUnit): number {
  return Math.max(1, Math.ceil(MIN_INTERVAL_MS / UNIT_MS[unit]));
}

export function parseTime(value: unknown): { hour: number; minute: number } | null {
  if (typeof value !== "string") return null;
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Read a schedule that came from storage, a remote host, or a half-finished
 * form. Nothing throws: an unusable shape reads as the daily default, which is
 * the one schedule that is always safe to show in a preview the user must
 * still confirm.
 */
export function normalizeSchedule(raw: unknown): Schedule {
  const value = raw as Partial<Schedule> | null | undefined;
  if (value && typeof value === "object") {
    if (value.kind === "interval") {
      const unit = isIntervalUnit(value.unit) ? value.unit : "hours";
      const asked = Number.isFinite(value.every) ? Math.round(Number(value.every)) : 1;
      const every = Math.max(minEvery(unit), Math.min(asked, 9999));
      const anchorMs = Number.isFinite(value.anchorMs) ? Number(value.anchorMs) : 0;
      return { kind: "interval", every, unit, anchorMs };
    }
    if (value.kind === "weekly") {
      const days = normalizeWeekdays(value.days);
      const time = parseTime(value.time) ? (value.time as string) : DEFAULT_TIME;
      return { kind: "weekly", days, time };
    }
    if (value.kind === "once" && Number.isFinite(value.atMs)) {
      return { kind: "once", atMs: Number(value.atMs) };
    }
  }
  return { kind: "weekly", days: [...EVERY_DAY], time: DEFAULT_TIME };
}

export function normalizeWeekdays(raw: unknown): Weekday[] {
  const seen = new Set<Weekday>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const day = Number(entry);
      if (Number.isInteger(day) && day >= 0 && day <= 6) seen.add(day as Weekday);
    }
  }
  return seen.size > 0 ? [...seen].sort((a, b) => a - b) : [...EVERY_DAY];
}

/** How far ahead a weekly schedule is searched before it is called empty. */
const WEEKLY_HORIZON_DAYS = 15;

/**
 * The first occurrence strictly after `fromMs`, or `null` when the schedule
 * has none left. Strictly after, so passing the instant an occurrence just
 * fired at always advances rather than returning the same run forever.
 */
export function nextRun(
  schedule: Schedule,
  fromMs: number,
  timeZone: string,
  dstPolicy: DstPolicy,
): number | null {
  if (schedule.kind === "once") {
    return schedule.atMs > fromMs ? schedule.atMs : null;
  }
  if (schedule.kind === "interval") {
    const period = intervalMs(schedule);
    if (fromMs < schedule.anchorMs) return schedule.anchorMs;
    const steps = Math.floor((fromMs - schedule.anchorMs) / period) + 1;
    return schedule.anchorMs + steps * period;
  }

  const time = parseTime(schedule.time) ?? { hour: 9, minute: 0 };
  const days = new Set(schedule.days);
  const start = zonedParts(fromMs, timeZone);
  for (let offset = 0; offset < WEEKLY_HORIZON_DAYS; offset++) {
    // Walk the calendar in the zone, not in UTC: a local day is not always
    // 24 hours long, and stepping by 86_400_000 would skip or repeat one.
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    if (!days.has(date.getUTCDay() as Weekday)) continue;
    const wall: WallTime = {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: time.hour,
      minute: time.minute,
    };
    const resolved = wallToInstant(wall, timeZone);
    if (!resolved.exists) {
      if (dstPolicy === "skip") continue;
      const shifted = gapEndInstant(wall, timeZone);
      if (shifted > fromMs) return shifted;
      continue;
    }
    if (resolved.ms > fromMs) return resolved.ms;
  }
  return null;
}

export function upcomingRuns(
  schedule: Schedule,
  fromMs: number,
  count: number,
  timeZone: string,
  dstPolicy: DstPolicy,
): number[] {
  const runs: number[] = [];
  let cursor = fromMs;
  for (let i = 0; i < count; i++) {
    const next = nextRun(schedule, cursor, timeZone, dstPolicy);
    if (next == null) break;
    runs.push(next);
    cursor = next;
  }
  return runs;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function sameDays(a: readonly Weekday[], b: readonly Weekday[]): boolean {
  return a.length === b.length && a.every((day, index) => day === b[index]);
}

/** The sentence shown in the preview before an automation may be enabled. */
export function describeSchedule(schedule: Schedule, timeZone: string): string {
  if (schedule.kind === "interval") {
    const [one, many] = UNIT_LABEL[schedule.unit];
    return schedule.every === 1 ? `Every ${one}` : `Every ${schedule.every} ${many}`;
  }
  if (schedule.kind === "once") {
    return `Once on ${formatDate(schedule.atMs, timeZone)} at ${formatClock(schedule.atMs, timeZone)}`;
  }
  const days = [...schedule.days].sort((a, b) => a - b);
  const which = sameDays(days, EVERY_DAY)
    ? "day"
    : sameDays(days, WEEKDAYS)
      ? "weekday"
      : joinNames(days.map((day) => DAY_NAME[day]));
  return `Every ${which} at ${schedule.time}`;
}

export function formatDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(ms));
}

export function formatClock(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

/** Date and time together, for a next-run line or a run row. */
export function formatMoment(ms: number, timeZone: string): string {
  return `${formatDate(ms, timeZone)} at ${formatClock(ms, timeZone)}`;
}

/** The wall time in `timeZone` right now, for seeding a builder's fields. */
export function wallNow(timeZone: string, nowMs = Date.now()): WallTime {
  const parts = zonedParts(nowMs, timeZone);
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}
