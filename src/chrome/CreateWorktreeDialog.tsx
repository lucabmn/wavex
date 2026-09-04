import { Check, ChevronDown, GitBranch, Loader, Search } from "./icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { notifyGitChanged } from "../lib/fs";
import { LAYER } from "../lib/layers";
import { prettyCwd } from "../lib/paths";
import { rememberWorktree } from "../lib/worktrees/worktreeIndex";
import { suggestWorktreePath } from "../lib/worktrees/worktreePaths";
import {
  checkedOutElsewhere,
  gitWorktreeCreate,
  worktreeLabel,
  type Worktree,
} from "../lib/worktrees/worktrees";
import { useHomeDir } from "../hooks/useHomeDir";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { useWorktrees } from "../hooks/useWorktrees";
import { Popover } from "./Popover";
import { useDialogFocus } from "../hooks/useDialogFocus";

type Props = {
  /** Any folder in the repository the worktree is added to. */
  repoPath: string;
  onCancel: () => void;
  /** A worktree was created; `open` says whether to switch to it now. */
  onCreated: (worktree: Worktree, open: boolean) => void;
  onOpenWorktree: (path: string) => void;
};

const BASE_MENU_WIDTH = 260;

export function CreateWorktreeDialog({ repoPath, onCancel, onCreated, onOpenWorktree }: Props) {
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "open" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [baseOpen, setBaseOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseRef = useRef<HTMLButtonElement>(null);

  const home = useHomeDir();
  const { branches } = useProjectBranchesState(repoPath, true);
  const { worktrees } = useWorktrees(repoPath, true);
  const trimmed = branch.trim();
  const taken = useMemo(() => worktrees.map((worktree) => worktree.path), [worktrees]);
  // The caller opens a project folder, which may sit inside the repository
  // rather than at its root. Git answers from either, but the worktree folder
  // is named after the repository and the index is keyed by it, so both have to
  // use the root git reports.
  const repoRoot = useMemo(
    () => worktrees.find((worktree) => worktree.main)?.path ?? repoPath,
    [repoPath, worktrees],
  );
  const path = trimmed ? suggestWorktreePath(home, repoRoot, trimmed, taken) : "";
  const baseBranch = base ?? branches?.current ?? null;
  const dialogRef = useDialogFocus<HTMLDivElement>({
    onClose: onCancel,
    initialFocusRef: inputRef,
    escapeDisabled: Boolean(busy) || baseOpen,
    trapDisabled: baseOpen,
  });

  // A branch lives in one worktree at a time, so an existing checkout is not an
  // error to recover from — it is the worktree the user is looking for.
  const existing = useMemo(
    () => worktrees.find((worktree) => worktree.branch === trimmed) ?? null,
    [trimmed, worktrees],
  );
  const canSubmit = Boolean(trimmed) && Boolean(home) && !busy && !existing;

  const create = async (open: boolean) => {
    if (!canSubmit || !path) return;
    setBusy(open ? "open" : "create");
    setError(null);
    setConflict(null);
    try {
      const worktree = await gitWorktreeCreate(repoRoot, path, trimmed, baseBranch);
      // Written before the caller can switch to it: the sidebar decides where a
      // folder belongs synchronously, and would otherwise file the new worktree
      // as a project of its own for one render.
      rememberWorktree(repoRoot, worktree.path);
      notifyGitChanged();
      onCreated(worktree, open);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConflict(checkedOutElsewhere(message));
      setError(message);
      setBusy(null);
      inputRef.current?.focus();
    }
  };

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div
        className="absolute inset-0 bg-black/30"
        onMouseDown={() => {
          if (!busy) onCancel();
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-busy={Boolean(busy)}
        aria-label="New worktree"
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute left-1/2 top-[22%] flex w-[min(460px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-content/10 bg-content/5 p-4 shadow-xl backdrop-blur-xl"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-[13px] font-medium leading-tight text-content">New worktree</h2>
          <p className="text-[12px] leading-snug text-content/55">
            A second checkout of this repository in its own folder. Agents working there cannot
            touch the files in {prettyCwd(repoRoot)}.
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] text-content/50">Branch</span>
          <input
            ref={inputRef}
            type="text"
            value={branch}
            placeholder="feature/checkout-flow"
            aria-label="Branch name"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            disabled={Boolean(busy)}
            className="w-full rounded-md bg-content/10 px-2 py-1.5 font-mono text-[13px] leading-5 text-content outline-none placeholder:text-content/35 disabled:opacity-40"
            onChange={(event) => {
              setBranch(event.target.value);
              setError(null);
              setConflict(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSubmit) {
                event.preventDefault();
                void create(true);
              }
            }}
          />
        </label>

        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] text-content/50">from</span>
          <button
            ref={baseRef}
            type="button"
            disabled={Boolean(busy)}
            aria-haspopup="listbox"
            aria-expanded={baseOpen}
            onClick={() => setBaseOpen((open) => !open)}
            className="flex min-w-0 items-center gap-1.5 rounded-md bg-content/10 px-2 py-1 text-content/80 hover:bg-content/15 hover:text-content disabled:opacity-40"
          >
            <GitBranch className="size-3.5 shrink-0" strokeWidth={1.5} />
            <span className="min-w-0 truncate font-mono text-[12px]">
              {baseBranch ?? "current HEAD"}
            </span>
            <ChevronDown className="size-3 shrink-0 text-content/50" strokeWidth={1.75} />
          </button>
        </div>

        <p className="truncate text-[11px] leading-tight text-content/40" title={path || undefined}>
          {path ? prettyCwd(path) : "Pick a branch name to see the folder."}
        </p>

        {existing ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-content/8 px-2.5 py-2 text-[11px] leading-4 text-content/70">
            <span className="min-w-0 flex-1">
              “{worktreeLabel(existing)}” already has a worktree.
            </span>
            <button
              type="button"
              onClick={() => onOpenWorktree(existing.path)}
              className="shrink-0 rounded-md bg-content/10 px-2 py-1 text-[11px] font-medium text-content hover:bg-content/20"
            >
              Open it
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="flex flex-col gap-2">
            <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] leading-4 text-red-400/90">
              {error}
            </p>
            {conflict ? (
              <button
                type="button"
                onClick={() => onOpenWorktree(conflict)}
                className="self-start rounded-md bg-content/10 px-2 py-1 text-[11px] font-medium text-content hover:bg-content/20"
              >
                Open {prettyCwd(conflict)}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void create(false)}
            className="inline-flex items-center gap-1.5 rounded-md bg-content/10 px-3 py-1.5 text-[12px] font-medium text-content hover:bg-content/15 disabled:opacity-40"
          >
            {busy === "create" ? (
              <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
            ) : null}
            Create
          </button>
          <button
            type="button"
            title="↩"
            disabled={!canSubmit}
            onClick={() => void create(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
          >
            {busy === "open" ? (
              <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
            ) : null}
            Create & open
          </button>
        </div>
      </div>

      {baseOpen ? (
        <BaseBranchMenu
          anchor={baseRef}
          current={baseBranch}
          branches={(branches?.branches ?? []).map((entry) => ({
            name: entry.name,
            remote: entry.remote,
          }))}
          onPick={(name) => {
            setBase(name);
            setBaseOpen(false);
          }}
          onDismiss={() => setBaseOpen(false)}
        />
      ) : null}
    </div>,
    document.body,
  );
}

type BaseBranch = { name: string; remote: string | null };

function BaseBranchMenu({
  anchor,
  current,
  branches,
  onPick,
  onDismiss,
}: {
  anchor: { current: HTMLElement | null };
  current: string | null;
  branches: BaseBranch[];
  onPick: (name: string) => void;
  onDismiss: () => void;
}) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    search.current?.focus();
  }, []);

  const needle = query.trim().toLowerCase();
  const rows = needle
    ? branches.filter((entry) =>
        (entry.remote ? `${entry.remote}/${entry.name}` : entry.name)
          .toLowerCase()
          .includes(needle),
      )
    : branches;

  return (
    <Popover
      anchor={anchor}
      side="bottom"
      align="start"
      width={BASE_MENU_WIDTH}
      maxHeight={260}
      layer={LAYER.dialog + 1}
      onDismiss={onDismiss}
      role="dialog"
      aria-label="Base branch"
      className="flex flex-col overflow-hidden"
    >
      <label className="flex shrink-0 items-center gap-2 border-b border-content/10 px-2 py-2.5 text-content/50">
        <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
        <input
          ref={search}
          type="text"
          value={query}
          placeholder="Search branches..."
          aria-label="Search branches"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/40"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const first = rows[0];
            if (first) onPick(first.remote ? `${first.remote}/${first.name}` : first.name);
          }}
        />
      </label>
      <div role="listbox" aria-label="Branches" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-content/50">No matching branches</p>
        ) : (
          rows.map((entry) => {
            const value = entry.remote ? `${entry.remote}/${entry.name}` : entry.name;
            const selected = value === current || (!entry.remote && entry.name === current);
            return (
              <button
                key={`${entry.remote ?? "local"}:${entry.name}`}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onPick(value)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                  selected ? "bg-content/10 text-content" : "text-content hover:bg-content/5"
                }`}
              >
                {selected ? (
                  <Check className="size-3.5 shrink-0" strokeWidth={1.75} />
                ) : (
                  <GitBranch className="size-3.5 shrink-0 text-content/50" strokeWidth={1.75} />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{entry.name}</span>
                {entry.remote ? (
                  <span className="shrink-0 text-[10px] text-content/40">{entry.remote}</span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </Popover>
  );
}
