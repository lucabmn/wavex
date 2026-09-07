/**
 * Shared vocabulary for session, tab, and worktree states.
 *
 * Every state in here renders through icon + text + tooltip, never through
 * color alone, so a working agent, a dirty checkout, or a failing check stays
 * legible without color vision. Keep this module pure: components in
 * `src/chrome/StatusBadges.tsx` translate these values into markup.
 */

/** What one agent is doing right now, highest priority first. */
export type AgentStatus = "working" | "needs-approval" | "unread" | "idle";

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  working: "Working",
  "needs-approval": "Needs approval",
  unread: "New reply",
  idle: "Idle",
};

export function resolveAgentStatus(state: {
  busy: boolean;
  needsApproval: boolean;
  unread: boolean;
}): AgentStatus {
  if (state.needsApproval) return "needs-approval";
  if (state.busy) return "working";
  if (state.unread) return "unread";
  return "idle";
}

export type GitState = {
  files: number;
  additions: number;
  deletions: number;
};

export function gitDirty(state: GitState | null | undefined): boolean {
  if (!state) return false;
  return state.files > 0 || state.additions > 0 || state.deletions > 0;
}

/** "1 file changed" / "3 files changed". Empty when there is nothing to count. */
export function formatChangedFiles(files: number): string {
  if (!Number.isFinite(files) || files <= 0) return "";
  return files === 1 ? "1 file changed" : `${files} files changed`;
}

/** "Clean" for a pristine checkout, otherwise "N files changed". */
export function gitStateLabel(state: GitState | null | undefined): string {
  const files = state?.files ?? 0;
  return files > 0 ? formatChangedFiles(files) : "Clean";
}

/** Compact "+12 -3" diff stat. Empty when there is nothing uncommitted. */
export function gitStatShort(state: GitState | null | undefined): string {
  const additions = state?.additions ?? 0;
  const deletions = state?.deletions ?? 0;
  return [additions > 0 ? `+${additions}` : "", deletions > 0 ? `-${deletions}` : ""]
    .filter(Boolean)
    .join(" ");
}

/**
 * Narrow-chip count: `942`, `1.2k`, `8k`, `12k`. A checkout worked in directly
 * reaches four and five digits, which is wide enough to squeeze a row's name
 * out of the layout entirely, so rails render this and keep the exact number
 * in the tooltip.
 */
export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const count = Math.trunc(value);
  if (count < 1000) return String(count);
  const [scaled, suffix] = count < 1_000_000 ? [count / 1000, "k"] : [count / 1_000_000, "m"];
  const text = scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, "") : String(Math.round(scaled));
  return `${text}${suffix}`;
}

/** Lint/diagnostic problems for open files. Zero means the checks pass. */
export function checkLabel(errors: number): string {
  if (!Number.isFinite(errors) || errors <= 0) return "No problems";
  return errors === 1 ? "1 problem" : `${errors} problems`;
}

/** Join tooltip parts, skipping empties. */
export function statusTooltip(parts: Array<string | undefined | null | false>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" · ");
}

/** Full non-color tooltip for one session card: title, agent, branch, git, checks. */
export function sessionStatusTooltip(options: {
  title: string;
  branch?: string;
  repo?: string;
  agent: AgentStatus;
  git?: GitState | null;
  checkErrors?: number;
}): string {
  const git = options.git;
  const changed = formatChangedFiles(git?.files ?? 0);
  const stat = gitStatShort(git);
  const checks =
    options.checkErrors != null && options.checkErrors > 0
      ? checkLabel(options.checkErrors)
      : undefined;
  return statusTooltip([
    options.title,
    AGENT_STATUS_LABEL[options.agent],
    options.branch || options.repo
      ? [options.repo, options.branch].filter(Boolean).join("/")
      : undefined,
    changed && stat ? `${changed} (${stat})` : changed || undefined,
    !changed && git ? "Clean" : undefined,
    checks,
  ]);
}

/** Full non-color tooltip for one worktree row. */
export function worktreeStatusTooltip(options: {
  label: string;
  path: string;
  busy: boolean;
  missing: boolean;
  locked: boolean;
  lockReason?: string | null;
  git?: GitState | null;
}): string {
  const changed = formatChangedFiles(options.git?.files ?? 0);
  const stat = gitStatShort(options.git);
  return statusTooltip([
    options.label,
    options.path,
    options.missing ? "Folder is missing" : undefined,
    options.locked ? (options.lockReason ? `Locked: ${options.lockReason}` : "Locked") : undefined,
    options.busy ? "Working" : "Idle",
    changed && stat ? `${changed} (${stat})` : changed || (!options.missing ? "Clean" : undefined),
  ]);
}

/** Full non-color tooltip for one workspace tab. */
export function tabStatusTooltip(options: {
  project: string;
  conversation?: string;
  more?: string[];
  files?: string[];
  dirty: boolean;
  working: boolean;
  needsApproval: boolean;
  unread: boolean;
  branch?: string;
  git?: GitState | null;
  checkErrors?: number;
}): string {
  const changed = formatChangedFiles(options.git?.files ?? 0);
  const stat = gitStatShort(options.git);
  return statusTooltip([
    options.project,
    options.conversation || undefined,
    ...(options.more ?? []),
    ...(options.files ?? []),
    options.needsApproval ? AGENT_STATUS_LABEL["needs-approval"] : undefined,
    options.working ? AGENT_STATUS_LABEL.working : undefined,
    options.unread ? AGENT_STATUS_LABEL.unread : undefined,
    options.branch ? `Branch ${options.branch}` : undefined,
    changed && stat ? `${changed} (${stat})` : changed || undefined,
    !changed && options.git ? "Clean" : undefined,
    options.dirty ? "Unsaved changes" : undefined,
    options.checkErrors != null && options.checkErrors > 0
      ? checkLabel(options.checkErrors)
      : undefined,
  ]);
}
