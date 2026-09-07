/**
 * Where the cursor has been, across files.
 *
 * Go to definition is only half a feature: the other half is getting back. The
 * workspace already has a visit history over tabs, but a jump inside one file —
 * or between two files that are both already open — never changes the tab, so
 * that history has nothing to unwind. This one records code locations, and Go
 * Back spends it before falling through to the tab history.
 */

import { pathKey } from "../paths";

export type CodeLocation = {
  path: string;
  line: number;
  column: number;
};

export type CodeNavigationHistory = {
  back: CodeLocation[];
  forward: CodeLocation[];
};

/** Deep enough to unwind a chase through a call graph, bounded so it can't grow. */
const MAX_STACK = 50;

export const EMPTY_CODE_NAVIGATION: CodeNavigationHistory = { back: [], forward: [] };

/**
 * Record the place a jump is leaving.
 *
 * A jump that lands where it started is not a jump, and recording it would put
 * a Go Back on the stack that visibly does nothing.
 */
export function pushCodeLocation(
  history: CodeNavigationHistory,
  origin: CodeLocation,
  destination: CodeLocation,
): CodeNavigationHistory {
  if (sameLocation(origin, destination)) return history;
  const back = [...history.back, origin];
  return {
    back: back.length > MAX_STACK ? back.slice(-MAX_STACK) : back,
    forward: [],
  };
}

/** The location to return to, and the history after returning to it. */
export function codeNavigationBack(
  history: CodeNavigationHistory,
  current: CodeLocation | null,
): { location: CodeLocation; history: CodeNavigationHistory } | null {
  const location = history.back[history.back.length - 1];
  if (!location) return null;
  return {
    location,
    history: {
      back: history.back.slice(0, -1),
      forward: current ? [current, ...history.forward] : history.forward,
    },
  };
}

export function codeNavigationForward(
  history: CodeNavigationHistory,
  current: CodeLocation | null,
): { location: CodeLocation; history: CodeNavigationHistory } | null {
  const [location, ...forward] = history.forward;
  if (!location) return null;
  return {
    location,
    history: {
      back: current ? [...history.back, current] : history.back,
      forward,
    },
  };
}

/** Drop locations in files that are no longer open. */
export function pruneCodeNavigation(
  history: CodeNavigationHistory,
  openPaths: Iterable<string>,
): CodeNavigationHistory {
  const open = new Set([...openPaths].map(pathKey));
  const keep = (location: CodeLocation) => open.has(pathKey(location.path));
  const back = history.back.filter(keep);
  const forward = history.forward.filter(keep);
  if (back.length === history.back.length && forward.length === history.forward.length) {
    return history;
  }
  return { back, forward };
}

function sameLocation(a: CodeLocation, b: CodeLocation): boolean {
  return pathKey(a.path) === pathKey(b.path) && a.line === b.line;
}
