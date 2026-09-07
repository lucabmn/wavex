import { sessionRefKey } from "./host";
import { pathKey, projectName } from "./paths";
import { profileStorage } from "./profiles/profileStorage";
import type { LiveAgent } from "./liveAgents";
import type { SessionSummary } from "./sessions/sessionStore";
import {
  filterSessionsByHarness,
  filterSessionsByStatus,
  filterSessionsByTime,
  loadSessionSidebarFilters,
} from "./sessions/sessionFilters";
import { compareSessionSummaries, filterSessionsByArchive } from "./sessions/sessionHistory";

export type ActivityBoardLane = "needs-you" | "working" | "done" | "parked";
export type ActivityViewMode = "list" | "board";

export type ActivityBoardState = {
  view: ActivityViewMode;
  lanes: Record<string, ActivityBoardLane>;
};

export type ActivityBoardCard = {
  key: string;
  session: SessionSummary;
  projectKey: string;
  projectLabel: string;
  lane: ActivityBoardLane;
  derivedLane: ActivityBoardLane;
  live?: LiveAgent;
};

export const ACTIVITY_BOARD_LANES: readonly ActivityBoardLane[] = [
  "needs-you",
  "working",
  "done",
  "parked",
];

/**
 * The lanes a card can be dropped into. Needs you and Working are read off the
 * live turn, so a user cannot put a session there — only the two idle lanes
 * are a choice, and the board greys the rest out while a card is in hand.
 */
export const ACTIVITY_BOARD_DROP_LANES: readonly ActivityBoardLane[] = ["done", "parked"];

export const ACTIVITY_BOARD_LANE_LABEL: Record<ActivityBoardLane, string> = {
  "needs-you": "Needs you",
  working: "Working",
  done: "Done",
  parked: "Parked",
};

/**
 * How many cards one lane draws. Done holds every session this profile ever
 * saved, and a triage board becomes unreadable long before it becomes slow.
 * The rest stay one click away in the list.
 */
export const ACTIVITY_BOARD_LANE_LIMIT = 40;

export const DEFAULT_ACTIVITY_BOARD_STATE: ActivityBoardState = {
  view: "list",
  lanes: {},
};

const STORAGE_KEY = "wavex.activityBoard";

/**
 * Done is deliberately not LiveAgent.done. A summary is done when it has no
 * current live turn, which means its latest persisted turn completed. A user
 * move to Parked is a separate, explicit lane and wins while the session is
 * idle. Active derived states always win over a stale user pin, so a session
 * moving on cannot remain hidden in Done or Parked.
 */
export function derivedActivityLane(live?: LiveAgent): ActivityBoardLane {
  if (live?.needsApproval) return "needs-you";
  if (live && !live.done) return "working";
  return "done";
}

export function activitySessionKey(session: Pick<SessionSummary, "id" | "hostId">): string {
  return sessionRefKey(session.hostId, session.id);
}

export function activityProjectKey(session: Pick<SessionSummary, "cwd" | "hostId">): string {
  return `${session.hostId}\u0000${pathKey(session.cwd)}`;
}

export function activityProjectLabel(session: Pick<SessionSummary, "cwd">): string {
  return projectName(session.cwd);
}

export function activityBoardCards(
  sessions: SessionSummary[],
  liveAgents: LiveAgent[],
  state: ActivityBoardState,
): ActivityBoardCard[] {
  const liveById = new Map(liveAgents.map((agent) => [agent.id, agent]));
  // Newest first, so the slice a lane draws is the part worth triaging.
  return [...sessions].sort(compareSessionSummaries).map((session) => {
    const key = activitySessionKey(session);
    const live = liveById.get(session.id);
    const derivedLane = derivedActivityLane(live);
    return {
      key,
      session,
      projectKey: activityProjectKey(session),
      projectLabel: activityProjectLabel(session),
      lane: derivedLane === "done" ? (state.lanes[key] ?? derivedLane) : derivedLane,
      derivedLane,
      ...(live ? { live } : {}),
    };
  });
}

/**
 * Whether this card can be moved into that lane. A running turn owns its lane,
 * so the move is refused rather than written and silently ignored.
 */
export function canMoveActivityCard(
  card: Pick<ActivityBoardCard, "derivedLane" | "lane">,
  lane: ActivityBoardLane,
): boolean {
  return (
    card.derivedLane === "done" && card.lane !== lane && ACTIVITY_BOARD_DROP_LANES.includes(lane)
  );
}

export function moveActivityCard(
  state: ActivityBoardState,
  key: string,
  lane: ActivityBoardLane,
): ActivityBoardState {
  return { ...state, lanes: { ...state.lanes, [key]: lane } };
}

export function normalizeActivityBoardState(value: unknown): ActivityBoardState {
  if (!value || typeof value !== "object") return DEFAULT_ACTIVITY_BOARD_STATE;
  const parsed = value as { view?: unknown; lanes?: unknown };
  const lanes: Record<string, ActivityBoardLane> = {};
  if (parsed.lanes && typeof parsed.lanes === "object" && !Array.isArray(parsed.lanes)) {
    for (const [key, lane] of Object.entries(parsed.lanes)) {
      if (key && isActivityBoardLane(lane)) lanes[key] = lane;
    }
  }
  return { view: parsed.view === "board" ? "board" : "list", lanes };
}

export function loadActivityBoardState(): ActivityBoardState {
  try {
    const raw = profileStorage.getItem(STORAGE_KEY);
    return raw ? normalizeActivityBoardState(JSON.parse(raw)) : DEFAULT_ACTIVITY_BOARD_STATE;
  } catch {
    return DEFAULT_ACTIVITY_BOARD_STATE;
  }
}

export function saveActivityBoardState(state: ActivityBoardState): void {
  try {
    profileStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeActivityBoardState(state)));
  } catch {
    // private mode / quota
  }
}

export function pruneActivityBoardState(
  state: ActivityBoardState,
  sessions: ReadonlyArray<Pick<SessionSummary, "id" | "hostId">>,
): ActivityBoardState {
  const liveKeys = new Set(sessions.map(activitySessionKey));
  const lanes = Object.fromEntries(
    Object.entries(state.lanes).filter(([key]) => liveKeys.has(key)),
  );
  return { ...state, lanes };
}

export function filterActivitySessions(
  sessions: SessionSummary[],
  busyIds: Set<string> = new Set(),
  approvalIds: Set<string> = new Set(),
  doneIds: Set<string> = new Set(),
  now = Date.now(),
): SessionSummary[] {
  const filters = loadSessionSidebarFilters();
  return filterSessionsByStatus(
    filterSessionsByTime(
      filterSessionsByHarness(
        filterSessionsByArchive(sessions, filters.showArchived),
        filters.hiddenHarnesses,
      ),
      filters.time,
      now,
    ),
    filters.status,
    busyIds,
    approvalIds,
    doneIds,
  );
}

export function isActivityBoardLane(value: unknown): value is ActivityBoardLane {
  return ACTIVITY_BOARD_LANES.includes(value as ActivityBoardLane);
}
