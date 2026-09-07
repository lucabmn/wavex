import { isInFlightSession, wasTurnInterrupted } from "../inFlight";
import { HARNESSES, sessionNeedsInput, type HarnessId, type Session } from "../session";

/**
 * Race: send the draft in the composer to 2–3 agents at once, each in its own
 * new session, then compare what they changed and keep the parts worth keeping.
 *
 * A race is a *dispatch of the current draft*, not a session action, so it is
 * offered where a send is offered — in the composer, gated on the same
 * conditions as the send button. Racing out of a session with a turn in flight
 * is meaningless: there is no draft to race.
 *
 * Worktree decision: every runner works in the SAME checkout (the source
 * session's working directory). One worktree per runner was considered and
 * rejected: it needs new Git worktree plumbing, risks uncommitted user work,
 * and breaks the "same files" comparison the mode is for. Sharing matches
 * `secondOpinion` semantics ("this same working copy").
 *
 * Per-runner attribution on a shared checkout comes from per-session
 * checkpoints: each runner snapshots the baseline before its first turn, so
 * `sessionCheckpointStatus` reports that runner's delta even while the other
 * runners edit around it. Accepting means staging through the normal git
 * plumbing; a bad accept is undone with `undoSessionChanges`, which only
 * touches working-tree bytes, never user commits.
 *
 * Known limit: two runners editing the same file interleave on disk — last
 * writer wins for the bytes on disk — while each runner's checkpoint status
 * still shows its own delta against the shared race baseline. Existing
 * sessions are never touched: a race only ever creates new sessions.
 */

export const RACE_MIN_RUNNERS = 2;
export const RACE_MAX_RUNNERS = 3;
export const RACE_TITLE = "Race";

export type RaceRunnerChoice = {
  harness: HarnessId;
  model: string;
};

export type RaceGroup = {
  id: string;
  /** Session the race was launched from. Untouched by the race itself. */
  sourceId: string;
  cwd: string;
  prompt: string;
  runners: RaceRunnerChoice[];
  runnerIds: string[];
  startedAt: number;
};

export function newRaceGroup(input: {
  sourceId: string;
  cwd: string;
  prompt: string;
  runners: RaceRunnerChoice[];
  runnerIds: string[];
}): RaceGroup {
  return {
    id: crypto.randomUUID(),
    sourceId: input.sourceId,
    cwd: input.cwd,
    prompt: input.prompt,
    runners: input.runners,
    runnerIds: input.runnerIds,
    startedAt: Date.now(),
  };
}

/**
 * Providers a race can pick from. Same shape as `secondOpinionTargets`: the
 * registry and the availability probe decide, never a provider adapter. Unlike
 * a second opinion this keeps the source harness, so a session can race the
 * agent it is already using against another one.
 */
export function raceTargets(options: {
  installed: (id: HarnessId) => boolean;
  visible: (id: HarnessId) => boolean;
  live: (id: HarnessId) => boolean;
  probed: boolean;
}): HarnessId[] {
  return HARNESSES.filter((id) => {
    if (!options.live(id)) return false;
    if (!options.visible(id)) return false;
    if (!options.probed) return true;
    return options.installed(id);
  });
}

/** Why the picked runners cannot start yet, or null when they can. */
export function raceRunnersError(runners: RaceRunnerChoice[]): string | null {
  if (runners.length < RACE_MIN_RUNNERS) {
    return `Pick ${RACE_MIN_RUNNERS} or more agents to race.`;
  }
  if (runners.length > RACE_MAX_RUNNERS) {
    return `A race holds at most ${RACE_MAX_RUNNERS} agents.`;
  }
  const seen = new Set<HarnessId>();
  for (const runner of runners) {
    if (!runner.model) return "Every runner needs a model.";
    if (seen.has(runner.harness)) return "Every runner needs its own agent.";
    seen.add(runner.harness);
  }
  return null;
}

/** Title for a runner session, so the tab reads as part of a race. */
export function raceSessionTitle(prompt: string): string {
  const line = prompt.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const short = line.length > 48 ? `${line.slice(0, 47)}…` : line || "prompt";
  return `${RACE_TITLE} · ${short}`;
}

export type RaceRunnerStatus = "working" | "waiting" | "done" | "stopped" | "idle";

/**
 * Status of one runner, decided by the same in-flight vocabulary the rest of
 * the app uses rather than by matching words in the transcript.
 */
export function raceRunnerStatus(session: Session | undefined): RaceRunnerStatus {
  if (!session) return "idle";
  if (sessionNeedsInput(session)) return "waiting";
  if (isInFlightSession(session)) return "working";
  if (wasTurnInterrupted(session)) return "stopped";
  if (!session.blocks.some((block) => block.role === "user")) return "idle";
  return "done";
}

export const RACE_STATUS_LABEL: Record<RaceRunnerStatus, string> = {
  working: "Working",
  waiting: "Needs you",
  done: "Done",
  stopped: "Stopped",
  idle: "Starting",
};

export function raceRunnerElapsed(session: Session | undefined, now: number): number | null {
  if (!session) return null;
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.role !== "user") continue;
    if (block.durationMs != null) return block.durationMs;
    if (block.startedAt != null) return Math.max(0, now - block.startedAt);
    return null;
  }
  return null;
}

/** Runner sessions of a race, in race order. */
export function raceSessions(race: RaceGroup, sessions: Session[]): (Session | undefined)[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return race.runnerIds.map((id) => byId.get(id));
}

export function raceOfSession(races: RaceGroup[], sessionId: string): RaceGroup | undefined {
  return races.find((race) => race.runnerIds.includes(sessionId) || race.sourceId === sessionId);
}

export function removeRaceSessions(
  races: RaceGroup[],
  sessionIds: ReadonlySet<string>,
): RaceGroup[] {
  return races.flatMap((race) => {
    const runnerIds = race.runnerIds.filter((id) => !sessionIds.has(id));
    if (runnerIds.length === 0) return [];
    if (runnerIds.length === race.runnerIds.length) return [race];
    return [{ ...race, runnerIds }];
  });
}

/**
 * "2/3 done" per runner session, so its composer offers the compare view
 * instead of starting a race a runner has no business starting. The source is
 * deliberately left out: it keeps its own composer free to race again, and the
 * compare view is one click away in any of the runner panes beside it.
 */
export function raceProgressLabels(
  races: RaceGroup[],
  sessions: Session[],
): Record<string, string> {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const labels: Record<string, string> = {};
  for (const race of races) {
    const done = race.runnerIds.filter((id) => {
      const status = raceRunnerStatus(byId.get(id));
      return status === "done" || status === "stopped";
    }).length;
    const label = `${done}/${race.runnerIds.length} done`;
    for (const id of race.runnerIds) labels[id] = label;
  }
  return labels;
}
