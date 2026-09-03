import { CircleAlert, GitBranch, MoreHorizontal, Plus } from "./icons";
import { useState, type MouseEvent } from "react";
import { copyText } from "../lib/clipboard";
import { notifyGitChanged, revealPath, type GitDiffStats } from "../lib/fs";
import { REVEAL_LABEL } from "../lib/platform";
import { sameProjectPath } from "../lib/recents";
import { gitWorktreePrune, worktreeLabel, type Worktree } from "../lib/worktrees/worktrees";
import { useProjectDiffStats } from "../hooks/useProjectDiffStats";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";
import { RemoveWorktreeDialog } from "./RemoveWorktreeDialog";
import { Shimmer } from "../surfaces/Shimmer";

type Props = {
  /** Main checkout of the repository these worktrees belong to. */
  repoPath: string;
  worktrees: Worktree[];
  /** Active project — either the repository or one of its worktrees. */
  cwd: string;
  isBusy: (path: string) => boolean;
  onSelect: (path: string) => void;
  onCreate: () => void;
  /** A worktree's folder is gone; the caller decides where to send the user. */
  onRemoved: (path: string) => void;
};

type Menu = { x: number; y: number; worktree: Worktree };

/**
 * The repository's other checkouts, listed under it. Only the open project's
 * worktrees are rendered: every row polls git for its diff stats, and twenty
 * rows across every project in the rail would be a subprocess storm on focus.
 */
export function WorktreeList({
  repoPath,
  worktrees,
  cwd,
  isBusy,
  onSelect,
  onCreate,
  onRemoved,
}: Props) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [removing, setRemoving] = useState<Worktree | null>(null);
  const [pruning, setPruning] = useState(false);

  const linked = worktrees.filter((worktree) => !worktree.main && !worktree.bare);
  const stale = linked.filter((worktree) => worktree.missing || worktree.prunable).length;

  const onMenuPick = (id: string) => {
    const worktree = menu?.worktree;
    setMenu(null);
    if (!worktree) return;
    if (id === "open") onSelect(worktree.path);
    else if (id === "reveal") void revealPath(worktree.path);
    else if (id === "copy") void copyText(worktree.path);
    else if (id === "remove") setRemoving(worktree);
  };

  const prune = async () => {
    if (pruning) return;
    setPruning(true);
    try {
      await gitWorktreePrune(repoPath);
      notifyGitChanged();
    } finally {
      setPruning(false);
    }
  };

  return (
    <div className="flex flex-col gap-px pl-3">
      {linked.map((worktree) => (
        <WorktreeRow
          key={worktree.path}
          worktree={worktree}
          selected={sameProjectPath(worktree.path, cwd)}
          busy={isBusy(worktree.path)}
          onSelect={onSelect}
          onOpenMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenu({ x: event.clientX, y: event.clientY, worktree });
          }}
        />
      ))}

      <button
        type="button"
        title="New worktree"
        aria-label="New worktree"
        onClick={onCreate}
        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-content/45 hover:bg-content/5 hover:text-content"
      >
        <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[12px] leading-tight">New worktree</span>
      </button>

      {stale > 0 ? (
        <button
          type="button"
          disabled={pruning}
          onClick={() => void prune()}
          className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-content/45 hover:bg-content/5 hover:text-content disabled:opacity-40"
        >
          <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-[12px] leading-tight">
            {stale === 1 ? "Clean up 1 missing worktree" : `Clean up ${stale} missing worktrees`}
          </span>
        </button>
      ) : null}

      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          ariaLabel="Worktree actions"
          items={worktreeMenuItems(menu.worktree)}
          onPick={onMenuPick}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {removing ? (
        <RemoveWorktreeDialog
          repoPath={repoPath}
          worktree={removing}
          busy={isBusy(removing.path)}
          onCancel={() => setRemoving(null)}
          onRemoved={(path) => {
            setRemoving(null);
            onRemoved(path);
          }}
        />
      ) : null}
    </div>
  );
}

function worktreeMenuItems(worktree: Worktree): ExplorerMenuItem[] {
  return [
    { kind: "item", id: "open", label: "Open worktree" },
    { kind: "item", id: "reveal", label: REVEAL_LABEL, disabled: worktree.missing },
    { kind: "item", id: "copy", label: "Copy path" },
    { kind: "sep" },
    {
      kind: "item",
      id: "remove",
      label: "Remove worktree…",
      danger: true,
      disabled: worktree.locked,
    },
  ];
}

function WorktreeRow({
  worktree,
  selected,
  busy,
  onSelect,
  onOpenMenu,
}: {
  worktree: Worktree;
  selected: boolean;
  busy: boolean;
  onSelect: (path: string) => void;
  onOpenMenu: (event: MouseEvent<HTMLElement>) => void;
}) {
  const label = worktreeLabel(worktree);
  const stats = useProjectDiffStats(worktree.path, !worktree.missing);

  return (
    <div
      className={`group relative flex h-7 items-stretch rounded-md px-2 ${
        selected ? "bg-content/12 text-content" : "opacity-65 hover:bg-content/5 hover:text-content"
      }`}
      onContextMenu={onOpenMenu}
    >
      <button
        type="button"
        title={worktreeRowTitle(worktree, stats, busy)}
        aria-label={label}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(worktree.path)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left group-hover:pr-6"
      >
        {worktree.missing ? (
          <CircleAlert className="size-3 shrink-0 text-amber-400" strokeWidth={1.75} />
        ) : (
          <GitBranch className="size-3 shrink-0 text-content/50" strokeWidth={1.75} />
        )}
        {busy ? (
          <Shimmer as="span" duration={1.4} className={labelClassName}>
            {label}
          </Shimmer>
        ) : (
          <span className={labelClassName}>{label}</span>
        )}
        {stats && (stats.additions > 0 || stats.deletions > 0) ? (
          <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] font-semibold tabular-nums group-hover:hidden">
            {stats.additions > 0 ? (
              <span className="text-emerald-400">+{stats.additions}</span>
            ) : null}
            {stats.deletions > 0 ? <span className="text-red-400">-{stats.deletions}</span> : null}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        title="Worktree options"
        aria-label="Worktree options"
        aria-haspopup="menu"
        onClick={onOpenMenu}
        className="absolute right-1 top-1/2 hidden size-5 -translate-y-1/2 place-items-center rounded-md text-content/55 hover:bg-content/8 hover:text-content group-hover:grid"
      >
        <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

const labelClassName = "min-w-0 flex-1 truncate font-mono text-[12px] leading-tight";

function worktreeRowTitle(worktree: Worktree, stats: GitDiffStats | null, busy: boolean): string {
  const parts = [worktreeLabel(worktree), worktree.path];
  if (worktree.missing) parts.push("Folder is missing");
  if (worktree.locked)
    parts.push(worktree.lockReason ? `Locked: ${worktree.lockReason}` : "Locked");
  if (busy) parts.push("Working");
  const files = stats?.files ?? 0;
  if (files > 0) parts.push(`${files} ${files === 1 ? "file" : "files"} changed`);
  return parts.join("\n");
}
