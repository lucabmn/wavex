export type TabNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End";

/**
 * Resolve keyboard navigation for a tab list. Horizontal lists use Left/Right,
 * vertical lists use Up/Down; Home and End work in either orientation.
 */
export function nextTabIndex(
  current: number,
  count: number,
  key: string,
  orientation: "horizontal" | "vertical" = "horizontal",
): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;

  const previous = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  const next = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  if (key === previous) return (current - 1 + count) % count;
  if (key === next) return (current + 1) % count;
  return null;
}
