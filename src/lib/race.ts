import { sessionNeedsInput, type HarnessId, type Session } from "./session";

/**
 * Race-Mode: send the same prompt to 2–3 agents in parallel, compare the
 * results side by side, keep the winner per hunk.
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
 * runners edit around it. Accepting means `sessionCheckpointKeep` (and hunk
 * staging through the normal git plumbing); a bad accept is undone with
 * `sessionCheckpointUndo`, which only touches working-tree bytes, never user
 * commits.
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

export function validateRaceRunners(
  runners: RaceRunnerChoice[],
  options: { installed: (id: HarnessId) => boolean; probed: boolean },
): string | null {
  if (runners.length < RACE_MIN_RUNNERS) {
    return `Pick at least ${RACE_MIN_RUNNERS} runners to start a race.`;
  }
  if (runners.length > RACE_MAX_RUNNERS) {
    return `A race holds at most ${RACE_MAX_RUNNERS} runners.`;
  }
  const seen = new Set<HarnessId>();
  for (const runner of runners) {
    if (seen.has(runner.harness)) {
      return "Each runner needs its own provider.";
    }
    seen.add(runner.harness);
    if (!runner.model) return "Each runner needs a model.";
  }
  if (options.probed) {
    const missing = runners.filter((runner) => !options.installed(runner.harness));
    if (missing.length > 0) {
      return "One of the picked providers is not installed.";
    }
  }
  return null;
}

/** True when at least two providers are around to race at all. */
export function canRace(
  installedCount: number,
  probed: boolean,
): { ok: boolean; emptyState: string | null } {
  if (!probed) return { ok: true, emptyState: null };
  if (installedCount < RACE_MIN_RUNNERS) {
    return {
      ok: false,
      emptyState:
        "Racing needs 2 installed providers. Install another agent CLI, then restart wavex.",
    };
  }
  return { ok: true, emptyState: null };
}

/**
 * The same prompt goes to every runner, with one line of shared-copy context
 * so agents do not invent rival narratives about each other.
 */
export function buildRacePrompt(prompt: string, runnerCount: number): string {
  const text = prompt.trim();
  if (runnerCount <= 1) return text;
  return `${text}\n\n[Race mode: ${runnerCount} agents are solving this same prompt in parallel in this shared working copy. Work normally and do not address the other agents.]`;
}

export function raceTitleFor(prompt: string, harness: HarnessId): string {
  const line = prompt.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const short = line.length > 48 ? `${line.slice(0, 47)}…` : line || "prompt";
  return `${RACE_TITLE} · ${harness} · ${short}`;
}

export type RaceRunnerStatus = "working" | "waiting" | "done" | "idle" | "error";

/** Status of one runner, following the liveAgents/activity vocabulary. */
export function raceRunnerStatus(session: Session | undefined): RaceRunnerStatus {
  if (!session) return "idle";
  if (sessionNeedsInput(session)) return "waiting";
  if (session.busy) return "working";
  const last = session.blocks[session.blocks.length - 1];
  if (last?.role === "system" && /could not|not connected|error/i.test(last.text)) {
    return "error";
  }
  const hasTurn = session.blocks.some((block) => block.role === "user");
  if (!hasTurn) return "idle";
  return "done";
}

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

export function removeRaceSessions(races: RaceGroup[], sessionIds: Set<string>): RaceGroup[] {
  return races.flatMap((race) => {
    const runnerIds = race.runnerIds.filter((id) => !sessionIds.has(id));
    if (runnerIds.length === 0) return [];
    return [{ ...race, runnerIds }];
  });
}
