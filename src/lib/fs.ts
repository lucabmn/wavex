import { getDefaultHostId, invokeOn } from "./transport";
import { hostPathArgs, isRemoteHostId, type HostId } from "./host";
import { openDialog as open } from "./native";
import { slash } from "./paths";

export type FsEntry = {
  name: string;
  path: string;
  isDir: boolean;
  ignored: boolean;
};

export type ProjectFile = {
  name: string;
  path: string;
  relative: string;
  isDir?: boolean;
};

export function listDir(path: string, hostId?: HostId): Promise<FsEntry[]> {
  const target = hostPathArgs(path, hostId, getDefaultHostId());
  return invokeOn<FsEntry[]>(target.hostId, "list_dir", { path: target.path });
}

export type DiscoveredSkill = {
  name: string;
  description: string;
  path: string;
  scope: "project" | "user" | "builtin";
  source:
    | "agents"
    | "claude"
    | "cursor"
    | "codex"
    | "opencode"
    | "pi"
    | "omp"
    | "fx"
    | "grok"
    | "wavex";
};

export function listSkills(cwd: string, hostId?: HostId): Promise<DiscoveredSkill[]> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<DiscoveredSkill[]>(target.hostId, "list_skills", { cwd: target.path });
}

export function listProjectFiles(cwd: string, hostId?: HostId): Promise<ProjectFile[]> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<ProjectFile[]>(target.hostId, "list_project_files", { cwd: target.path });
}

export type GitDiffStats = {
  files: number;
  additions: number;
  deletions: number;
};

export function gitDiffStats(cwd: string, hostId?: HostId): Promise<GitDiffStats> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<GitDiffStats>(target.hostId, "git_diff_stats", { cwd: target.path });
}

export type GitChangedFile = {
  path: string;
  relative: string;
  status: "modified" | "added" | "deleted" | "untracked" | string;
  additions: number;
  deletions: number;
  staged: boolean;
  unstaged: boolean;
};

export type GitDiffIndex = {
  branch: string | null;
  files: GitChangedFile[];
  additions: number;
  deletions: number;
  remote: string | null;
  upstream: string | null;
  defaultBranch: string | null;
  ahead: number;
  behind: number;
  aheadOfDefault: number;
};

export function gitDiffIndex(cwd: string, hostId?: HostId): Promise<GitDiffIndex> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<GitDiffIndex>(target.hostId, "git_diff_index", { cwd: target.path });
}

export type GitFileDiff = {
  path: string;
  relative: string;
  status: string;
  original: string;
  current: string;
  binary: boolean;
  tooLarge: boolean;
};

export function gitFileDiff(cwd: string, relative: string, hostId?: HostId): Promise<GitFileDiff> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<GitFileDiff>(target.hostId, "git_file_diff", { cwd: target.path, relative });
}

export type GitHistoryRef = {
  name: string;
  kind: "local" | "remote" | "tag" | string;
};

export type GitHistoryCommit = {
  sha: string;
  shortSha: string;
  parents: string[];
  author: string;
  timestamp: number;
  subject: string;
  refs: GitHistoryRef[];
  head: boolean;
};

export type GitHistory = {
  head: string | null;
  commits: GitHistoryCommit[];
};

export function gitHistory(cwd: string, limit = 200, hostId?: HostId): Promise<GitHistory> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<GitHistory>(target.hostId, "git_history", { cwd: target.path, limit });
}

export function gitCommitFiles(
  cwd: string,
  sha: string,
  hostId?: HostId,
): Promise<GitChangedFile[]> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<GitChangedFile[]>(target.hostId, "git_commit_files", { cwd: target.path, sha });
}

export function gitCommitFileDiff(
  cwd: string,
  sha: string,
  relative: string,
  hostId?: HostId,
): Promise<GitFileDiff> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<GitFileDiff>(target.hostId, "git_commit_file_diff", {
    cwd: target.path,
    sha,
    relative,
  });
}

export function gitStageContents(
  cwd: string,
  relative: string,
  contents: string,
  hostId?: HostId,
): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<void>(target.hostId, "git_stage_contents", {
    cwd: target.path,
    relative,
    contents,
  });
}

export function gitStageFile(cwd: string, relative: string, hostId?: HostId): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<void>(target.hostId, "git_stage_file", { cwd: target.path, relative });
}

export function gitUnstageFile(cwd: string, relative: string, hostId?: HostId): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<void>(target.hostId, "git_unstage_file", { cwd: target.path, relative });
}

export function gitDiscardFile(cwd: string, relative: string, hostId?: HostId): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<void>(target.hostId, "git_discard_file", { cwd: target.path, relative });
}

export function gitDiscardAll(cwd: string, hostId?: HostId): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<void>(target.hostId, "git_discard_all", { cwd: target.path });
}

export function gitStageAll(cwd: string, hostId?: HostId): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<void>(target.hostId, "git_stage_all", { cwd: target.path });
}

export function gitUnstageAll(cwd: string, hostId?: HostId): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<void>(target.hostId, "git_unstage_all", { cwd: target.path });
}

export function gitCommit(cwd: string, message: string, hostId?: HostId): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<void>(target.hostId, "git_commit", { cwd: target.path, message });
}

export type GitStagedContext = {
  branch: string | null;
  summary: string;
  patch: string;
};

export function gitStagedContext(cwd: string, hostId?: HostId): Promise<GitStagedContext> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<GitStagedContext>(target.hostId, "git_staged_context", { cwd: target.path });
}

export function gitPush(cwd: string, hostId?: HostId): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<void>(target.hostId, "git_push", { cwd: target.path });
}

export function gitPull(cwd: string, hostId?: HostId): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<void>(target.hostId, "git_pull", { cwd: target.path });
}

export function gitSync(cwd: string, hostId?: HostId): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<void>(target.hostId, "git_sync", { cwd: target.path });
}

export type GitRangeContext = {
  base: string;
  head: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
};

export function gitRangeContext(cwd: string, hostId?: HostId): Promise<GitRangeContext> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<GitRangeContext>(target.hostId, "git_range_context", { cwd: target.path });
}

export type GitPr = {
  number: number;
  title: string;
  url: string;
  state: string;
};

export function gitPrStatus(cwd: string, hostId?: HostId): Promise<GitPr | null> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<GitPr | null>(target.hostId, "git_pr_status", { cwd: target.path });
}

export function gitPrCreate(
  cwd: string,
  title: string,
  body: string,
  base: string,
  head: string,
  hostId?: HostId,
): Promise<string> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<string>(target.hostId, "git_pr_create", {
    cwd: target.path,
    title,
    body,
    base,
    head,
  });
}

export type GitBranchInfo = {
  name: string;
  current: boolean;
  remote: string | null;
};

export type GitBranches = {
  current: string | null;
  detached: boolean;
  branches: GitBranchInfo[];
};

export function gitBranches(cwd: string, hostId?: HostId): Promise<GitBranches> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<GitBranches>(target.hostId, "git_branches", { cwd: target.path });
}

export function gitCheckout(
  cwd: string,
  name: string,
  remote?: string | null,
  hostId?: HostId,
): Promise<string> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<string>(target.hostId, "git_checkout", {
    cwd: target.path,
    name,
    remote: remote ?? null,
  });
}

export function gitCreateBranch(cwd: string, name: string, hostId?: HostId): Promise<string> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<string>(target.hostId, "git_create_branch", { cwd: target.path, name });
}

export function gitStash(cwd: string, message?: string, hostId?: HostId): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<void>(target.hostId, "git_stash", { cwd: target.path, message: message ?? null });
}

/** Git refused a checkout because the working tree would be overwritten. */
export function isCheckoutBlockedByChanges(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("would be overwritten") ||
    text.includes("commit your changes or stash") ||
    text.includes("please move or remove them before")
  );
}

/** Drop leftover session-worktree pins. The composer now switches this folder. */
export function restoreSessionCheckout<
  T extends { cwd: string; branch?: string; worktreeCwd?: string; providerSessionId?: string },
>(session: T): T {
  if (!session.branch && !session.worktreeCwd) return session;
  return {
    ...session,
    branch: undefined,
    worktreeCwd: undefined,
    ...(session.worktreeCwd ? { providerSessionId: undefined } : {}),
  };
}

const GIT_CHANGED = "wavex-git-changed";

/** Tell git UIs (diff pane, branch picker) to reload after a local git mutation. */
export function notifyGitChanged() {
  window.dispatchEvent(new Event(GIT_CHANGED));
}

export function subscribeGitChanged(listener: () => void): () => void {
  window.addEventListener(GIT_CHANGED, listener);
  return () => window.removeEventListener(GIT_CHANGED, listener);
}

export function createPath(
  parent: string,
  name: string,
  isDir: boolean,
  hostId: HostId = getDefaultHostId(),
): Promise<string> {
  return invokeOn<string>(hostId, "create_path", { parent, name, isDir });
}

export function renamePath(
  path: string,
  name: string,
  hostId: HostId = getDefaultHostId(),
): Promise<string> {
  return invokeOn<string>(hostId, "rename_path", { path, name });
}

export function deletePath(path: string, hostId: HostId = getDefaultHostId()): Promise<void> {
  return invokeOn<void>(hostId, "delete_path", { path });
}

export function copyPath(
  from: string,
  destParent: string,
  hostId: HostId = getDefaultHostId(),
): Promise<string> {
  return invokeOn<string>(hostId, "copy_path", { from, destParent });
}

export function movePath(
  from: string,
  destParent: string,
  hostId: HostId = getDefaultHostId(),
): Promise<string> {
  return invokeOn<string>(hostId, "move_path", { from, destParent });
}

export function revealPath(path: string, hostId: HostId = getDefaultHostId()): Promise<void> {
  return invokeOn<void>(hostId, "reveal_path", { path });
}

export function homeDir(hostId: HostId = getDefaultHostId()): Promise<string> {
  return invokeOn<string>(hostId, "home_dir");
}

export async function pickFolder(title = "Open project"): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });
  return typeof selected === "string" && selected ? slash(selected) : null;
}

/** Store an image a turn generated, and return where it landed. */
export function writeGeneratedImage(
  name: string,
  data: string,
  hostId: HostId = getDefaultHostId(),
): Promise<string> {
  return invokeOn(hostId, "write_generated_image", { name, data });
}

export function readFileBase64(path: string, hostId: HostId = getDefaultHostId()): Promise<string> {
  return invokeOn(hostId, "read_file_base64", { path });
}

export function writeFileBase64(
  path: string,
  data: string,
  hostId: HostId = getDefaultHostId(),
): Promise<void> {
  return invokeOn(hostId, "write_file_base64", { path, data });
}

export async function pickFiles(title = "Attach files"): Promise<string[] | null> {
  const selected = await open({
    multiple: true,
    directory: false,
    title,
  });
  if (Array.isArray(selected)) {
    const paths = selected.filter((path): path is string => Boolean(path)).map(slash);
    return paths.length > 0 ? paths : null;
  }
  if (typeof selected === "string" && selected) return [slash(selected)];
  return null;
}

export function cloneRepo(
  url: string,
  parent: string,
  hostId: HostId = getDefaultHostId(),
): Promise<string> {
  return invokeOn<string>(hostId, "clone_repo", { url, parent });
}

export function readFilePreview(
  path: string,
  maxLines = 6,
  startLine?: number,
  hostId: HostId = getDefaultHostId(),
): Promise<string[]> {
  return invokeOn<string[]>(hostId, "read_file_preview", {
    path,
    maxLines,
    startLine,
  });
}

export type FileMtime = {
  path: string;
  mtimeMs: number | null;
};

export function statFiles(
  paths: string[],
  hostId: HostId = getDefaultHostId(),
): Promise<FileMtime[]> {
  if (paths.length === 0) return Promise.resolve([]);
  return invokeOn<FileMtime[]>(hostId, "stat_files", { paths });
}

export function readTextFile(path: string, hostId: HostId = getDefaultHostId()): Promise<string> {
  return invokeOn<string>(hostId, "read_text_file", { path });
}

/**
 * Raw bytes for the image viewer.
 *
 * `read_binary_file` answers in raw bytes rather than JSON, so it is not on
 * the connection allowlist and never will be: the wire carries JSON frames.
 * A remote host therefore goes through `read_file_base64`, which is already
 * allowed, and pays a third more bytes plus a decode. That is the deliberate
 * trade — a bounded cost on the one command that reads a whole file — rather
 * than a second binary channel for image previews alone.
 */
export async function readBinaryFile(
  path: string,
  hostId: HostId = getDefaultHostId(),
): Promise<Uint8Array> {
  if (isRemoteHostId(hostId)) return decodeBase64(await readFileBase64(path, hostId));
  const buffer = await invokeOn<ArrayBuffer>(hostId, "read_binary_file", { path });
  return new Uint8Array(buffer);
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function writeTextFile(
  path: string,
  content: string,
  hostId: HostId = getDefaultHostId(),
): Promise<void> {
  return invokeOn<void>(hostId, "write_text_file", { path, content });
}

/** Last path segment, or `/` for the filesystem root. */
export function basename(path: string): string {
  const trimmed = slash(path).replace(/\/+$/, "") || "/";
  if (/^[A-Za-z]:$/.test(trimmed)) return trimmed;
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}
