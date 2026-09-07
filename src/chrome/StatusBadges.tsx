import { Check, CircleAlert, GitBranch, MessageMultiple } from "./icons";
import { TerminalSpinner } from "./TerminalSpinner";
import {
  checkLabel,
  formatChangedFiles,
  gitStateLabel,
  gitStatShort,
  type AgentStatus,
} from "../lib/sessionStatus";

/**
 * Status badges shared by the sidebar, the tab strip, and worktree rows.
 * Every badge pairs its color with an icon and a text or tooltip label, so
 * state never travels through color alone.
 */

export function AgentStatusBadge({
  status,
  compact = false,
}: {
  status: AgentStatus;
  compact?: boolean;
}) {
  if (status === "idle") return null;
  if (status === "working") {
    return (
      <span
        className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-accent"
        title="Agent is working"
        aria-label="Agent is working"
      >
        <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none text-accent" />
        {compact ? null : <span>Working…</span>}
      </span>
    );
  }
  if (status === "needs-approval") {
    return (
      <span
        className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-amber-400"
        title="Agent needs approval to continue"
        aria-label="Agent needs approval to continue"
      >
        <CircleAlert className="size-3" strokeWidth={1.75} />
        {compact ? null : <span>Needs approval</span>}
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-emerald-400"
      title="Agent finished — new reply to read"
      aria-label="Agent finished, new reply to read"
    >
      <MessageMultiple className="size-3" strokeWidth={1.75} />
      {compact ? null : <span>New reply</span>}
    </span>
  );
}

export function GitStatusBadge({
  branch,
  files = 0,
  additions = 0,
  deletions = 0,
  showBranch = true,
}: {
  branch?: string | null;
  files?: number;
  additions?: number;
  deletions?: number;
  showBranch?: boolean;
}) {
  const changed = formatChangedFiles(files);
  const stat = gitStatShort({ files, additions, deletions });
  const dirty = changed.length > 0;
  const title = [
    branch ? `Branch ${branch}` : "",
    changed && stat ? `${changed} (${stat} uncommitted)` : changed || "Clean",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-content/45"
      title={title}
      aria-label={title}
    >
      {showBranch && branch ? (
        <>
          <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 truncate">{branch}</span>
        </>
      ) : null}
      {dirty ? (
        <span className="flex shrink-0 items-center gap-1 tabular-nums">
          {showBranch && branch ? <span aria-hidden>·</span> : null}
          <span>{changed}</span>
          {stat ? <span className="font-mono">({stat})</span> : null}
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-1">
          {showBranch && branch ? <span aria-hidden>·</span> : null}
          <Check className="size-3 text-emerald-400/80" strokeWidth={2.25} />
          <span>{gitStateLabel({ files, additions, deletions })}</span>
        </span>
      )}
    </span>
  );
}

export function CheckBadge({ errors }: { errors: number }) {
  if (!Number.isFinite(errors) || errors <= 0) return null;
  const label = checkLabel(errors);
  return (
    <span
      className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-red-400"
      title={`${label} in open files`}
      aria-label={`${label} in open files`}
    >
      <CircleAlert className="size-3" strokeWidth={1.75} />
      <span>{label}</span>
    </span>
  );
}
