import { Loader } from "./icons";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { notifyGitChanged } from "../lib/fs";
import { LAYER } from "../lib/layers";
import { prettyCwd } from "../lib/paths";
import { forgetWorktree } from "../lib/worktrees/worktreeIndex";
import {
  gitWorktreeRemove,
  worktreeHasLocalChanges,
  worktreeLabel,
  type Worktree,
} from "../lib/worktrees/worktrees";

type Props = {
  repoPath: string;
  worktree: Worktree;
  /** An agent is mid-turn in this worktree. */
  busy: boolean;
  onCancel: () => void;
  onRemoved: (path: string) => void;
};

/**
 * Removing a worktree deletes its folder. The branch survives unless the box is
 * ticked, so the usual "the agent is done, the PR is open" case loses nothing.
 */
export function RemoveWorktreeDialog({ repoPath, worktree, busy, onCancel, onRemoved }: Props) {
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const label = worktreeLabel(worktree);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!working) onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [working, onCancel]);

  const remove = async (force: boolean) => {
    if (working || busy) return;
    setWorking(true);
    setError(null);
    try {
      await gitWorktreeRemove(repoPath, worktree.path, { force, deleteBranch });
      forgetWorktree(worktree.path);
      notifyGitChanged();
      onRemoved(worktree.path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Git refuses while the checkout still holds work. That is worth a second
      // look rather than a flag the user ticks before they know they need it.
      setDirty(worktreeHasLocalChanges(message));
      setError(message);
      setWorking(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div
        className="absolute inset-0 bg-black/30"
        onMouseDown={() => {
          if (!working) onCancel();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-busy={working}
        aria-label={`Remove worktree ${label}`}
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute left-1/2 top-[22%] flex w-[min(440px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-content/10 bg-content/5 p-4 shadow-xl backdrop-blur-xl"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-[13px] font-medium leading-tight text-content">
            Remove worktree “{label}”?
          </h2>
          <p className="text-[12px] leading-snug text-content/55">
            The folder is deleted. Commits on the branch stay in the repository, and conversations
            held in this worktree are kept.
          </p>
          <p className="truncate text-[11px] leading-tight text-content/40">
            {prettyCwd(worktree.path)}
          </p>
        </div>

        {worktree.branch ? (
          <label className="flex items-start gap-2 text-[12px] leading-snug text-content/70">
            <input
              type="checkbox"
              checked={deleteBranch}
              disabled={working || busy}
              onChange={(event) => setDeleteBranch(event.target.checked)}
              className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent)]"
            />
            <span>
              Also delete the branch{" "}
              <span className="font-mono text-content">{worktree.branch}</span> and any commits only
              it has.
            </span>
          </label>
        ) : null}

        {busy ? (
          <p className="text-[11px] leading-4 text-amber-400">
            An agent is still working here. Stop its turn before removing the folder it writes to.
          </p>
        ) : error ? (
          <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] leading-4 text-red-400/90">
            {dirty ? "This worktree still has uncommitted changes." : error}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={working}
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={working || busy}
            onClick={() => void remove(dirty)}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-500/20 px-3 py-1.5 text-[12px] font-medium text-red-300 hover:bg-red-500/30 disabled:opacity-40"
          >
            {working ? <Loader className="size-3.5 animate-spin" strokeWidth={1.75} /> : null}
            {dirty ? "Discard changes & remove" : "Remove"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
