import { Check, CircleAlert, GitBranch, Lock, MoreHorizontal, Plus } from "./icons";
import { useState, type MouseEvent } from "react";
import { copyText } from "../lib/clipboard";
import { notifyGitChanged, revealPath } from "../lib/fs";
import { canRevealPath, revealLabel } from "../lib/platform";
import { hostIdForProject } from "../lib/transport";
import type { HostId } from "../lib/host";
import { sameProjectPath } from "../lib/recents";
import {
  formatChangedFiles,
  formatCompactCount,
  worktreeStatusTooltip,
} from "../lib/sessionStatus";
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
    else if (id === "reveal") void revealPath(worktree.path, hostIdForProject(repoPath));
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
        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-content/45 hover:bg-hover hover:text-content"
      >
        <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] leading-tight">New worktree</span>
      </button>

      {stale > 0 ? (
        <button
          type="button"
          disabled={pruning}
          onClick={() => void prune()}
          className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-content/45 hover:bg-hover hover:text-content disabled:opacity-40"
        >
          <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] leading-tight">
            {stale === 1 ? "Clean up 1 missing worktree" : `Clean up ${stale} missing worktrees`}
          </span>
        </button>
      ) : null}

      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          ariaLabel="Worktree actions"
          items={worktreeMenuItems(menu.worktree, hostIdForProject(repoPath))}
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

function worktreeMenuItems(worktree: Worktree, hostId: HostId): ExplorerMenuItem[] {
  return [
    { kind: "item", id: "open", label: "Open worktree" },
    // A file manager opens where the user is, not on the host.
    ...(canRevealPath(hostId)
      ? [
          {
            kind: "item" as const,
            id: "reveal",
            label: revealLabel(hostId),
            disabled: worktree.missing,
          },
        ]
      : []),
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
  const files = stats?.files ?? 0;
  const dirty = files > 0 || (stats?.additions ?? 0) > 0 || (stats?.deletions ?? 0) > 0;
  const changed = formatChangedFiles(files);
  const title = worktreeStatusTooltip({
    label,
    path: worktree.path,
    busy,
    missing: worktree.missing,
    locked: worktree.locked,
    lockReason: worktree.lockReason,
    git: stats ? { files, additions: stats.additions, deletions: stats.deletions } : null,
  });

  return (
    <div
      className={`group relative flex h-7 items-stretch rounded-md px-2 ${
        selected ? "bg-selected text-content" : "opacity-65 hover:bg-hover hover:text-content"
      }`}
      onContextMenu={onOpenMenu}
    >
      <button
        type="button"
        title={title}
        aria-label={title}
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
        {worktree.missing ? (
          <span className="shrink-0 text-[10px] font-medium text-amber-400 group-hover:hidden">
            Missing
          </span>
        ) : null}
        {worktree.locked && !worktree.missing ? (
          <span
            className="flex shrink-0 items-center gap-0.5 text-content/50 group-hover:hidden"
            title={worktree.lockReason ? `Locked: ${worktree.lockReason}` : "Locked"}
          >
            <Lock className="size-3" strokeWidth={1.75} />
          </span>
        ) : null}
        {busy ? (
          <span className="shrink-0 text-[10px] font-medium text-accent group-hover:hidden">
            Working
          </span>
        ) : null}
        {!worktree.missing && stats && dirty ? (
          <span
            className="flex min-w-0 items-center gap-1 overflow-hidden font-mono text-[10px] font-semibold tabular-nums group-hover:hidden"
            title={`${changed} uncommitted`}
          >
            <span className="truncate font-sans font-medium text-content/55">{changed}</span>
            {stats.additions > 0 ? (
              <span className="shrink-0 text-emerald-400">
                +{formatCompactCount(stats.additions)}
              </span>
            ) : null}
            {stats.deletions > 0 ? (
              <span className="shrink-0 text-red-400">-{formatCompactCount(stats.deletions)}</span>
            ) : null}
          </span>
        ) : null}
        {!worktree.missing && stats && !dirty && !busy ? (
          <span
            className="flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-content/45 group-hover:hidden"
            title="No uncommitted changes"
          >
            <Check className="size-3 text-emerald-400/80" strokeWidth={2.25} />
            <span>Clean</span>
          </span>
        ) : null}
      </button>
      <button
        type="button"
        title="Worktree options"
        aria-label="Worktree options"
        aria-haspopup="menu"
        onClick={onOpenMenu}
        className="absolute right-1 top-1/2 hidden size-5 -translate-y-1/2 place-items-center rounded-md text-content/55 hover:bg-hover hover:text-content group-hover:grid"
      >
        <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

// A floor, so the badges to its right can never squeeze the label to zero
// width — a zero-width `truncate` renders nothing, not an ellipsis.
const labelClassName = "min-w-14 flex-1 truncate font-mono text-[12.5px] leading-tight";
