/** Display formatting for the usage view. */

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Sub-cent figures round to `$0.00`, which reads as "nothing" when it is not. */
const USD_PRECISE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const INTEGER = new Intl.NumberFormat("en-US");

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  if (value > 0 && value < 0.01) return USD_PRECISE.format(value);
  return USD.format(value);
}

export function formatCount(value: number): string {
  return INTEGER.format(Math.round(value));
}

/**
 * Compacts a token count to three significant figures with a unit suffix, so
 * a column of numbers lines up at a glance: `19.9B`, `76.7M`, `804K`.
 */
export function formatTokens(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e12) return `${trim(value / 1e12)}T`;
  if (magnitude >= 1e9) return `${trim(value / 1e9)}B`;
  if (magnitude >= 1e6) return `${trim(value / 1e6)}M`;
  if (magnitude >= 1e3) return `${trim(value / 1e3)}K`;
  return INTEGER.format(Math.round(value));
}

function trim(value: number): string {
  const magnitude = Math.abs(value);
  const digits = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2;
  // Trailing zeros are noise in a column of compacted numbers: 1.50T reads
  // as more precision than three significant figures actually carry.
  return value
    .toFixed(digits)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

export function formatShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return "0%";
  if (share < 0.001) return "<0.1%";
  return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-08-07` to `Aug 7`. */
export function formatDayShort(day: string): string {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  if (!year || !month || !dayOfMonth) return day;
  return `${MONTHS[month - 1] ?? ""} ${dayOfMonth}`;
}

/** `2026-08-07` to `Fri, Aug 7`. */
export function formatDayLong(day: string): string {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed)) return day;
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
  }).format(new Date(parsed));
  return `${weekday}, ${formatDayShort(day)}`;
}

/** `Aug 7 – Sep 5`, collapsing a single-day window to one date. */
export function formatDayRange(days: string[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return "";
  if (first === last) return formatDayShort(first);
  return `${formatDayShort(first)} – ${formatDayShort(last)}`;
}

/** `3 minutes ago`, for the "last scanned" line. */
export function formatScannedAgo(scannedAtMs: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - scannedAtMs);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
