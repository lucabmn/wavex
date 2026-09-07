/**
 * The live races of this window.
 *
 * Races are ephemeral: the runners are ordinary sessions that persist on their
 * own, and the grouping only exists while those sessions do. Nothing here is
 * written to disk, so a reload — including a profile switch — starts empty.
 *
 * A `useSyncExternalStore` store rather than `App.tsx` state because three
 * unrelated places read it: the composer control that starts and reopens a
 * race, the compare view, and the pane that hosts both.
 */

import type { Session } from "../session";
import { raceOfSession, removeRaceSessions, type RaceGroup } from "./race";

const NO_RACES: RaceGroup[] = [];

let races: RaceGroup[] = NO_RACES;
let viewId: string | null = null;

const listeners = new Set<() => void>();

export function subscribeRaces(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRacesSnapshot(): RaceGroup[] {
  return races;
}

export function getRaceViewSnapshot(): string | null {
  return viewId;
}

export function startRaceGroup(race: RaceGroup): void {
  races = [...races, race];
  viewId = race.id;
  emit();
}

export function viewRaceOfSession(sessionId: string): void {
  const race = raceOfSession(races, sessionId);
  if (!race || viewId === race.id) return;
  viewId = race.id;
  emit();
}

export function closeRaceView(): void {
  if (viewId == null) return;
  viewId = null;
  emit();
}

export function racesSessionIds(): string[] {
  return races.flatMap((race) => race.runnerIds);
}

/**
 * Forget runners whose sessions are gone, and the races left with none. Closes
 * the compare view when the race it was showing no longer exists.
 */
export function pruneRaces(sessions: Session[]): void {
  if (races.length === 0) return;
  const live = new Set(sessions.map((session) => session.id));
  const gone = new Set(racesSessionIds().filter((id) => !live.has(id)));
  if (gone.size === 0) return;
  const next = removeRaceSessions(races, gone);
  races = next.length === 0 ? NO_RACES : next;
  if (viewId != null && !races.some((race) => race.id === viewId)) viewId = null;
  emit();
}

/** Test seam: the store outlives a single component, so tests reset it. */
export function resetRaces(): void {
  races = NO_RACES;
  viewId = null;
  emit();
}

function emit(): void {
  for (const listener of listeners) listener();
}
