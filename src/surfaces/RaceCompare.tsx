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
import { HARNESS_TITLE, type Session } from "../lib/session";
import { formatLiveElapsed } from "../lib/liveAgents";
import { sessionNeedsInput } from "../lib/session";
import { buildUnifiedFile } from "../lib/unifiedDiff";
import { raceRunnerElapsed, raceRunnerStatus, raceSessions, type RaceGroup } from "../lib/race";
import { HarnessIcon } from "../chrome/HarnessIcon";
import { Square, Undo2, X } from "../chrome/icons";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";

type Props = {
  race: RaceGroup;
  sessions: Session[];
  onStopOne: (sessionId: string) => void;
  onStopAll: () => void;
  onClose: () => void;
};

type RunnerFiles = {
  files: CheckpointFile[];
  diffs: Map<string, { binary: boolean; tooLarge: boolean; original: string; current: string }>;
};

/**
 * Side-by-side compare for one race. Every runner shares the race checkout,
 * so each section shows that runner's checkpoint delta against the shared
 * race baseline. Accepting stages hunks/files into the git index (undoable
 * with unstage); "Undo" restores the pre-race snapshot bytes. Neither touches
 * user commits, and sessions outside the race are never listed here.
 */
export function RaceCompare({ race, sessions, onStopOne, onStopAll, onClose }: Props) {
  const runners = raceSessions(race, sessions);
  const [now, setNow] = useState(() => Date.now());
  const [states, setStates] = useState<Map<string, RunnerFiles>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    const next = new Map<string, RunnerFiles>();
    await Promise.all(
      race.runnerIds.map(async (id) => {
        try {
          const status = await sessionCheckpointStatus(id, race.cwd);
          const diffs = new Map<
            string,
            { binary: boolean; tooLarge: boolean; original: string; current: string }
          >();
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
          next.set(id, { files: status.files, diffs });
        } catch {
          next.set(id, { files: [], diffs: new Map() });
        }
      }),
    );
    setStates(next);
  }, [race.cwd, race.runnerIds.join("\n")]);

  useEffect(() => {
    void load();
    const unsub = subscribeGitChanged(load);
    return unsub;
  }, [load]);

  const anyWorking = runners.some(
    (session) => session?.busy || (session != null && sessionNeedsInput(session)),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Race results"
      className="fixed inset-0 z-50 flex flex-col bg-black/50 p-4"
    >
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-xl border border-content/10 bg-background-base shadow-2xl">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-content/10 px-3">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-content">
            Race · {race.prompt.split(/\r?\n/)[0]?.slice(0, 80)}
          </span>
          {anyWorking ? (
            <button
              type="button"
              onClick={onStopAll}
              className="flex shrink-0 items-center gap-1.5 rounded-md bg-content/10 px-2 py-1 text-[12px] text-content/70 hover:bg-content/15 hover:text-content"
            >
              <Square className="size-2.5 fill-current" strokeWidth={0} />
              Stop all
            </button>
          ) : null}
          <button
            type="button"
            title="Close compare"
            aria-label="Close compare"
            onClick={onClose}
            className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
        <p className="shrink-0 border-b border-content/10 px-3 py-1.5 text-[12px] text-content/45">
          Runners share one checkout. Accept stages into the git index; Undo restores the pre-race
          snapshot. Neither touches your commits.
        </p>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-y-auto bg-content/10 lg:grid-cols-2 xl:grid-cols-3">
          {race.runnerIds.map((id, index) => (
            <RunnerSection
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
      </div>
    </div>
  );
}

function RunnerSection({
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
  const needsYou = session != null && sessionNeedsInput(session);
  const working = status === "working" || status === "waiting";

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

  const acceptFile = async (relative: string) => {
    setBusyId(relative);
    try {
      await gitStageFile(cwd, relative);
      notifyGitChanged();
      onReload();
    } finally {
      setBusyId(null);
    }
  };

  const unstageFile = async (relative: string) => {
    setBusyId(relative);
    try {
      await gitUnstageFile(cwd, relative);
      notifyGitChanged();
      onReload();
    } finally {
      setBusyId(null);
    }
  };

  const undoFile = async (relative: string) => {
    if (!session) return;
    setBusyId(relative);
    try {
      await undoSessionChanges(session.id, cwd, relative);
      notifyGitChanged();
      onReload();
    } finally {
      setBusyId(null);
    }
  };

  const acceptHunk = async (relative: string, pos: number) => {
    const loaded = state?.diffs.get(relative);
    if (!loaded) return;
    const next = stageChunkText(loaded.original, loaded.current, pos);
    if (next == null) return;
    setBusyId(relative);
    try {
      await gitStageContents(cwd, relative, next);
      notifyGitChanged();
      onReload();
    } finally {
      setBusyId(null);
    }
  };

  const undoAll = async () => {
    if (!session) return;
    setBusyId(session.id);
    try {
      await undoSessionChanges(session.id, cwd);
      notifyGitChanged();
      onReload();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="flex min-h-80 flex-col bg-background-base">
      <header className="flex shrink-0 items-center gap-2 border-b border-content/10 px-2.5 py-2">
        <HarnessIcon harness={harness} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-content">
          {HARNESS_TITLE[harness]}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
            status === "working"
              ? "bg-emerald-400/15 text-emerald-300"
              : status === "waiting"
                ? "bg-amber-400/15 text-amber-300"
                : status === "done"
                  ? "bg-content/10 text-content/60"
                  : status === "error"
                    ? "bg-red-400/15 text-red-300"
                    : "bg-content/10 text-content/40"
          }`}
        >
          {status === "working" ? "Working" : status === "waiting" ? "Needs you" : status}
        </span>
        {elapsed != null ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-content/40">
            {formatLiveElapsed(0, elapsed)}
          </span>
        ) : null}
        {working ? (
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
            onClick={undoAll}
            className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
          >
            <Undo2 className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </header>
      <p className="shrink-0 truncate px-2.5 pt-1.5 font-mono text-[11px] text-content/40">
        {session?.model ?? choice?.model ?? ""}
        {needsYou ? " · waiting on approval in its pane" : ""}
      </p>
      <div className="min-h-0 flex-1">
        {models.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-content/45">
            {status === "working" || status === "waiting"
              ? "No changes yet — still working."
              : "No changes recorded against the race baseline."}
          </p>
        ) : (
          <UnifiedDiffView
            files={models}
            busyId={busyId}
            onStageFile={acceptFile}
            onUnstageFile={unstageFile}
            onDiscardFile={undoFile}
            onStageHunk={acceptHunk}
          />
        )}
      </div>
    </section>
  );
}
