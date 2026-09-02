/**
 * The reporting window, resolved in the viewer's own time zone.
 *
 * A day has to be the day the user experienced, so the boundaries are computed
 * here with `Intl` — the only thing that gets an arbitrary IANA zone right
 * across a DST transition or a half-hour offset — and handed to the backend as
 * plain instants. The scanner then only has to place a timestamp between two
 * of them, and needs no time zone database of its own.
 */

/** Windows the view offers, in days. */
export const USAGE_WINDOW_DAYS = [7, 30, 90] as const;

export type UsageWindowDays = (typeof USAGE_WINDOW_DAYS)[number];

export type UsageWindow = {
  days: number;
  timeZone: string;
  /** `YYYY-MM-DD`, ascending, one per day in the window. */
  dayLabels: string[];
  /** Local midnight for each day plus the exclusive end, in epoch ms. */
  dayStartsMs: number[];
};

const DAY_MS = 86_400_000;

export function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  // `en-CA` yields ISO-ordered parts, which is why days are read from it
  // rather than assembled out of `Date` getters (those are host-local only).
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
}

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  }
}

/** The zone's offset from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(instant: number, format: Intl.DateTimeFormat): number {
  const parts = new Map(
    format.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.get("year")),
    Number(parts.get("month")) - 1,
    Number(parts.get("day")),
    Number(parts.get("hour")),
    Number(parts.get("minute")),
    Number(parts.get("second")),
  );
  return asUtc - instant;
}

/**
 * The instant a `YYYY-MM-DD` day begins in `timeZone`.
 *
 * The first pass guesses with the offset that applies at the UTC midnight of
 * that day; the second corrects it when a DST transition sits between the
 * guess and the answer. Two passes are enough for every real zone.
 */
export function zonedDayStartMs(day: string, timeZone: string): number {
  const format = partsFormatter(timeZone);
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(utcMidnight)) return Number.NaN;
  const guess = utcMidnight - zoneOffsetMs(utcMidnight, format);
  return utcMidnight - zoneOffsetMs(guess, format);
}

/** Shifts a `YYYY-MM-DD` day by whole calendar days. */
export function shiftDay(day: string, delta: number): string {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed)) return day;
  return new Date(parsed + delta * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The window ending today, in the viewer's zone.
 *
 * The end boundary is tomorrow's local midnight, so a turn from a minute ago
 * still lands inside the last day rather than falling out of the window.
 */
export function makeUsageWindow(days: number, now: Date = new Date()): UsageWindow {
  const timeZone = resolveTimeZone();
  const today = dayFormatter(timeZone).format(now);
  const dayLabels: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    dayLabels.push(shiftDay(today, -offset));
  }
  const dayStartsMs = dayLabels.map((day) => zonedDayStartMs(day, timeZone));
  dayStartsMs.push(zonedDayStartMs(shiftDay(today, 1), timeZone));
  return { days, timeZone, dayLabels, dayStartsMs };
}
