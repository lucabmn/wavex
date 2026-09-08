/**
 * Wall-clock arithmetic in a named time zone.
 *
 * A schedule is written in the user's words — "every weekday at 08:30" — and a
 * wall time is not an instant until a zone resolves it. Storing an offset
 * instead of the zone would freeze the answer at the moment it was saved, so
 * the automation keeps the IANA name and every conversion runs through here.
 *
 * `Intl` already carries the zone database, which is why nothing is added to
 * `package.json` for this: the offset at an instant is the difference between
 * that instant and the same clock reading interpreted as UTC.
 */

export type WallTime = {
  year: number;
  /** 1-12, as a person writes it. */
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export type ZonedParts = WallTime & {
  second: number;
  /** 0 is Sunday, matching `Date.prototype.getDay`. */
  weekday: number;
};

export const UTC = "UTC";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, made);
  return made;
}

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Anything unusable resolves to UTC rather than to whatever this machine is set to. */
export function normalizeTimeZone(value: unknown): string {
  return isTimeZone(value) ? value : UTC;
}

export function localTimeZone(): string {
  try {
    return normalizeTimeZone(new Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return UTC;
  }
}

export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const year = read("year");
  const month = read("month");
  const day = read("day");
  return {
    year,
    month,
    day,
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** Minutes east of UTC at this instant. Negative west, as `Intl` reports it. */
export function zoneOffsetMinutes(ms: number, timeZone: string): number {
  const parts = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return (asUtc - Math.floor(ms / 1000) * 1000) / 60_000;
}

function sameWallTime(parts: ZonedParts, wall: WallTime): boolean {
  return (
    parts.year === wall.year &&
    parts.month === wall.month &&
    parts.day === wall.day &&
    parts.hour === wall.hour &&
    parts.minute === wall.minute
  );
}

/**
 * The instant a clock in this zone reads `wall`.
 *
 * Two passes, because the offset that converts the reading is the offset *at*
 * the answer, not at the guess: the first pass lands within an hour of the
 * instant and the second uses that neighbourhood's offset. Where the spring
 * jump deletes the reading there is no such instant, and `exists` says so
 * rather than silently returning the hour before it. Where the autumn fall-back
 * repeats the reading this converges on the first of the two, so a daily
 * schedule fires once.
 */
export function wallToInstant(wall: WallTime, timeZone: string): { ms: number; exists: boolean } {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0);
  let ms = naive - zoneOffsetMinutes(naive, timeZone) * 60_000;
  ms = naive - zoneOffsetMinutes(ms, timeZone) * 60_000;
  return { ms, exists: sameWallTime(zonedParts(ms, timeZone), wall) };
}

function beforeWall(parts: ZonedParts, wall: WallTime): boolean {
  if (parts.year !== wall.year) return parts.year < wall.year;
  if (parts.month !== wall.month) return parts.month < wall.month;
  if (parts.day !== wall.day) return parts.day < wall.day;
  if (parts.hour !== wall.hour) return parts.hour < wall.hour;
  return parts.minute < wall.minute;
}

/** Widest jump any zone has ever made forward, with room to spare. */
const GAP_SEARCH_MS = 6 * 60 * 60 * 1000;

/**
 * First instant at which a clock in this zone reads `wall` or later — the
 * moment the jump lands on for a reading the spring transition deleted.
 *
 * A minute-granular binary search rather than arithmetic on the two offsets:
 * transitions are minute-aligned, and zones have moved by amounts other than
 * an hour.
 */
export function gapEndInstant(wall: WallTime, timeZone: string): number {
  const { ms } = wallToInstant(wall, timeZone);
  let low = ms;
  let high = ms + GAP_SEARCH_MS;
  if (!beforeWall(zonedParts(low, timeZone), wall)) return low;
  while (high - low > 60_000) {
    const mid = low + Math.floor((high - low) / 2 / 60_000) * 60_000;
    if (mid <= low) break;
    if (beforeWall(zonedParts(mid, timeZone), wall)) low = mid;
    else high = mid;
  }
  return high;
}
