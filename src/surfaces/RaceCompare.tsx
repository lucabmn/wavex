import { useCallback, useEffect, useMemo, useState } from "react";
import {
  sessionCheckpointStatus,
  undoSessionChanges,
  type CheckpointFile,
} from "../lib/checkpoint";
import { stageChunkText } from "../lib/editor/editorGit";
import {
  gitFileDiff,
  gitStageContents,
  gitStageFile,
  gitUnstageFile,
  notifyGitChanged,
  subscribeGitChanged,
} from "../lib/fs";
import { isInFlightSession } from "../lib/inFlight";
import { formatLiveElapsed } from "../lib/liveAgents";
import {
  RACE_STATUS_LABEL,
  raceRunnerElapsed,
  raceRunnerStatus,
  raceSessions,
  type RaceGroup,
  type RaceRunnerStatus,
} from "../lib/race/race";
import { HARNESS_TITLE, type Session } from "../lib/session";
import { buildUnifiedFile } from "../lib/unifiedDiff";
import { HarnessIcon } from "../chrome/HarnessIcon";
import { Square, Undo2 } from "../chrome/icons";
import { Modal } from "../chrome/Modal";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";

type Props = {
  race: RaceGroup;
  sessions: Session[];
  onStopOne: (sessionId: string) => void;
  onStopAll: () => void;
  onClose: () => void;
};

type FileDiff = { binary: boolean; tooLarge: boolean; original: string; current: string };
type RunnerFiles = { files: CheckpointFile[]; diffs: Map<string, FileDiff> };

const STATUS_TONE: Record<RaceRunnerStatus, string> = {
  working: "bg-emerald-400/15 text-emerald-300",
  waiting: "bg-amber-400/15 text-amber-300",
  done: "bg-content/10 text-content/60",
  stopped: "bg-content/10 text-content/45",
  idle: "bg-content/10 text-content/40",
};

/**
 * Side-by-side compare for one race. Every runner shares the race checkout, so
 * each column shows that runner's checkpoint delta against the shared race
 * baseline. Accepting stages hunks/files into the git index (undoable with
 * unstage); Undo restores the pre-race snapshot bytes. Neither touches user
 * commits, and sessions outside the race are never listed here.
 */
export function RaceCompare({ race, sessions, onStopOne, onStopAll, onClose }: Props) {
  const runners = raceSessions(race, sessions);
  const [now, setNow] = useState(() => Date.now());
  const [states, setStates] = useState<Map<string, RunnerFiles>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const runnerKey = race.runnerIds.join("\n");

  // The only live thing here is the elapsed clock, so it ticks only while a
  // runner is actually in flight.
  const live = runners.some((session) => session != null && isInFlightSession(session));

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  const load = useCallback(async () => {
    const ids = runnerKey.split("\n");
    const entries = await Promise.all(
      ids.map(async (id): Promise<[string, RunnerFiles]> => {
        try {
          const status = await sessionCheckpointStatus(id, race.cwd);
          const diffs = new Map<string, FileDiff>();
          await Promise.all(
            status.files.map(async (file) => {
              try {
                const diff = await gitFileDiff(race.cwd, file.relative);
                diffs.set(file.relative, {
                  binary: diff.binary,
                  tooLarge: diff.tooLarge,
                  original: diff.original,
                  current: diff.current,
                });
              } catch {
                // Leave the file listed without a patch.
              }
            }),
          );
          return [id, { files: status.files, diffs }];
        } catch {
          return [id, { files: [], diffs: new Map() }];
        }
      }),
    );
    setStates(new Map(entries));
  }, [race.cwd, runnerKey]);

  useEffect(() => {
    void load();
    return subscribeGitChanged(load);
  }, [load]);

  return (
    <Modal
      size="lg"
      onClose={onClose}
      title="Race"
      description={race.prompt.split(/\r?\n/)[0]?.slice(0, 120)}
      className="h-[min(760px,calc(100vh-96px))]"
    >
      <div className="flex items-center gap-2 px-4 pb-2 pt-1">
        <p className="min-w-0 flex-1 text-[12px] leading-snug text-content/45">
          Runners share one checkout. Accept stages into the git index; Undo restores the pre-race
          snapshot. Neither touches your commits.
        </p>
        {live ? (
          <button
            type="button"
            onClick={onStopAll}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-content/10 px-2 py-1 text-[12px] text-content/70 hover:bg-content/15 hover:text-content"
          >
            <Square className="size-2.5 fill-current" strokeWidth={0} />
            Stop all
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-px border-t border-content/10 bg-content/10 lg:grid-cols-2 xl:grid-cols-3">
        {race.runnerIds.map((id, index) => (
          <RunnerColumn
            key={id}
            session={runners[index]}
            choice={race.runners[index]}
            state={states.get(id)}
            now={now}
            busyId={busyId}
            setBusyId={setBusyId}
            cwd={race.cwd}
            onStop={() => onStopOne(id)}
            onReload={load}
          />
        ))}
      </div>
    </Modal>
  );
}

function RunnerColumn({
  session,
  choice,
  state,
  now,
  busyId,
  setBusyId,
  cwd,
  onStop,
  onReload,
}: {
  session: Session | undefined;
  choice: { harness: Session["harness"]; model: string } | undefined;
  state: RunnerFiles | undefined;
  now: number;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  cwd: string;
  onStop: () => void;
  onReload: () => void;
}) {
  const harness = session?.harness ?? choice?.harness ?? "claude";
  const status = raceRunnerStatus(session);
  const elapsed = raceRunnerElapsed(session, now);
  const running = status === "working" || status === "waiting";

  const models = useMemo<UnifiedDiffFileModel[]>(() => {
    if (!state) return [];
    return state.files.map((file) => {
      const loaded = state.diffs.get(file.relative);
      const unified =
        loaded && !loaded.binary && !loaded.tooLarge
          ? buildUnifiedFile(loaded.original, loaded.current)
          : null;
      return {
        id: file.relative,
        path: file.path,
        label: file.relative,
        binary: loaded?.binary,
        tooLarge: loaded?.tooLarge,
        emptyMessage: loaded == null ? "Loading…" : undefined,
        additions: unified?.additions ?? file.additions,
        deletions: unified?.deletions ?? file.deletions,
        blocks: unified?.blocks ?? [],
        canStage: true,
        canUnstage: true,
        canDiscard: true,
        canStageHunk: true,
      };
    });
  }, [state]);

  // Every mutation below is one git call plus a reload, so they share a body.
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusyId(key);
    try {
      await action();
      notifyGitChanged();
      onReload();
    } finally {
      setBusyId(null);
    }
  };

  const acceptHunk = (relative: string, pos: number) => {
    const loaded = state?.diffs.get(relative);
    if (!loaded) return;
    const next = stageChunkText(loaded.original, loaded.current, pos);
    if (next == null) return;
    void run(relative, () => gitStageContents(cwd, relative, next));
  };

  return (
    // A fixed column height rather than a stretched one: the modal body is the
    // only vertical scroller, so a long diff has to scroll inside its own
    // column instead of dragging every other column down with it.
    <section className="flex h-96 flex-col bg-background-base">
      <header className="flex shrink-0 items-center gap-2 border-b border-content/10 px-2.5 py-2">
        <HarnessIcon harness={harness} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-content">
          {HARNESS_TITLE[harness]}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${STATUS_TONE[status]}`}>
          {RACE_STATUS_LABEL[status]}
        </span>
        {elapsed != null ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-content/40">
            {formatLiveElapsed(0, elapsed)}
          </span>
        ) : null}
        {running ? (
          <button
            type="button"
            title="Stop this runner"
            aria-label="Stop this runner"
            onClick={onStop}
            className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
          >
            <Square className="size-2.5 fill-current" strokeWidth={0} />
          </button>
        ) : (
          <button
            type="button"
            title="Undo everything from this runner"
            aria-label="Undo everything from this runner"
            disabled={!session || busyId === session.id}
            onClick={() => {
              if (session) void run(session.id, () => undoSessionChanges(session.id, cwd));
            }}
            className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
          >
            <Undo2 className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </header>
      <p className="shrink-0 truncate px-2.5 pt-1.5 font-mono text-[11px] text-content/40">
        {session?.model ?? choice?.model ?? ""}
        {status === "waiting" ? " · waiting on approval in its pane" : ""}
      </p>
      <div className="min-h-0 flex-1">
        {models.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-content/45">
            {running ? "No changes yet — still working." : "No changes against the race baseline."}
          </p>
        ) : (
          <UnifiedDiffView
            files={models}
            busyId={busyId}
            onStageFile={(relative) => void run(relative, () => gitStageFile(cwd, relative))}
            onUnstageFile={(relative) => void run(relative, () => gitUnstageFile(cwd, relative))}
            onDiscardFile={(relative) => {
              if (session) void run(relative, () => undoSessionChanges(session.id, cwd, relative));
            }}
            onStageHunk={acceptHunk}
          />
        )}
      </div>
    </section>
  );
}
