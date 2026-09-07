import { listProjectFiles, type ProjectFile } from "../fs";
import { scorePath, type FuzzyHit } from "../fuzzy";
import { hostIdForProject } from "../transport";
import { hostPathKey, type HostId } from "../host";
import { resolveWorkspacePath } from "../paths";
import { looksLikeProject } from "../recents";
import { normalizeEditorPath } from "../search";

const MAX_RECENTS = 30;
const MAX_RESULTS = 80;

type Cache = {
  key: string;
  files: ProjectFile[];
};

let cache: Cache | null = null;
let inflight: { key: string; promise: Promise<ProjectFile[]> } | null = null;
let epoch = 0;
const recentsByCwd = new Map<string, string[]>();

/** A project index belongs to one host's checkout, never to a path alone. */
/**
 * A project index belongs to one host's checkout. The root arrives as the
 * string the workspace holds, so an unnamed host is read out of the reference
 * rather than assumed to be this device — otherwise a remote project and a
 * local one at the same path share a slot.
 */
function normCwd(cwd: string, hostId: HostId | undefined): string {
  return hostPathKey(hostId ?? hostIdForProject(cwd), cwd);
}

export function peekProjectFiles(cwd: string, hostId?: HostId): ProjectFile[] | null {
  return cache?.key === normCwd(cwd, hostId) ? cache.files : null;
}

export function invalidateProjectFiles(cwd?: string, hostId?: HostId) {
  if (!cwd || cache?.key === normCwd(cwd, hostId)) cache = null;
}

export function rememberOpenedFile(cwd: string, path: string, hostId?: HostId) {
  if (!path) return;
  const key = normCwd(cwd, hostId);
  const prev = recentsByCwd.get(key) ?? [];
  recentsByCwd.set(key, [path, ...prev.filter((item) => item !== path)].slice(0, MAX_RECENTS));
}

export function recentOpenedFiles(cwd: string, hostId?: HostId): string[] {
  return recentsByCwd.get(normCwd(cwd, hostId)) ?? [];
}

export function prefetchProjectFiles(cwd: string, hostId?: HostId) {
  if (!looksLikeProject(cwd)) return;
  void loadProjectFiles(cwd, false, hostId);
}

export function loadProjectFiles(
  cwd: string,
  refresh = false,
  hostId?: HostId,
): Promise<ProjectFile[]> {
  if (!looksLikeProject(cwd)) return Promise.resolve([]);
  const key = normCwd(cwd, hostId);
  if (!refresh && cache?.key === key) return Promise.resolve(cache.files);
  if (inflight?.key === key) return inflight.promise;

  const id = ++epoch;
  const promise = listProjectFiles(cwd, hostId)
    .then((files) => {
      if (id === epoch) cache = { key, files };
      return files;
    })
    .finally(() => {
      if (inflight?.key === key) inflight = null;
    });
  inflight = { key, promise };
  return promise;
}

export type RankedFile = ProjectFile & FuzzyHit;

export function rankProjectFiles(
  files: ProjectFile[],
  query: string,
  recents: string[],
  limit = MAX_RESULTS,
): RankedFile[] {
  const recentRank = new Map(recents.map((path, index) => [path, index]));

  if (!query.trim()) {
    const byPath = new Map(files.map((file) => [file.path, file]));
    const out: RankedFile[] = [];
    const seen = new Set<string>();
    for (const path of recents) {
      if (seen.has(path)) continue;
      seen.add(path);
      const file = byPath.get(path);
      if (!file) continue;
      out.push({ ...file, score: 0, positions: [] });
      if (out.length >= limit) break;
    }
    return out;
  }

  const scored: RankedFile[] = [];
  for (const file of files) {
    const hit = scorePath(query, file.relative, file.name);
    if (!hit) continue;
    const recency = recentRank.get(file.path);
    const score = hit.score + (recency == null ? 0 : (MAX_RECENTS - recency) * 8);
    scored.push({ ...file, score, positions: hit.positions });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.relative.length !== b.relative.length) {
      return a.relative.length - b.relative.length;
    }
    return a.relative.localeCompare(b.relative);
  });
  return scored.slice(0, limit);
}

/** Resolve a transcript or markdown file link to an existing project file. */
export async function resolveOpenablePath(
  cwd: string,
  href: string,
  hostId?: HostId,
): Promise<string | undefined> {
  const direct = resolveWorkspacePath(href, cwd);
  if (!direct) return undefined;

  const files = await loadProjectFiles(cwd, false, hostId);
  if (files.length === 0) return direct;

  const byPath = new Map(files.map((file) => [normalizeEditorPath(file.path), file]));
  const normalizedDirect = normalizeEditorPath(direct);
  const exact = byPath.get(normalizedDirect);
  if (exact) return exact.path;

  const relHint = relativePathHint(href, cwd, direct);
  const exactRelative = files.find(
    (file) => file.relative === relHint || normalizeEditorPath(file.relative) === relHint,
  );
  if (exactRelative) return exactRelative.path;

  const suffixMatches = files.filter(
    (file) =>
      file.relative === relHint ||
      file.relative.endsWith(`/${relHint}`) ||
      relHint.endsWith(file.relative),
  );
  if (suffixMatches.length === 1) return suffixMatches[0].path;

  const baseName = relHint.split("/").filter(Boolean).pop() ?? relHint;
  const byName = files.filter((file) => file.name === baseName);
  if (byName.length === 0) return direct;
  if (byName.length === 1) return byName[0].path;

  return pickOpenableFile(byName, cwd, relHint).path;
}

function relativePathHint(href: string, cwd: string, direct: string): string {
  let value = href.trim().replace(/\\/g, "/");
  value = value.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L\d+)?)$/, "");
  if (value.startsWith("file://")) {
    try {
      value = decodeURIComponent(value.slice("file://".length));
    } catch {
      value = value.slice("file://".length);
    }
    value = value.replace(/\\/g, "/");
  }
  value = value.replace(/^\.\//, "").replace(/^\/+/, "");

  const base = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedDirect = normalizeEditorPath(direct);
  if (base && base !== "~" && normalizedDirect.startsWith(`${base}/`)) {
    return normalizedDirect.slice(base.length + 1);
  }
  return value;
}

function pickOpenableFile(candidates: ProjectFile[], cwd: string, relHint: string): ProjectFile {
  const recents = recentOpenedFiles(cwd);
  for (const recent of recents) {
    const normalizedRecent = normalizeEditorPath(recent);
    const hit = candidates.find((file) => normalizeEditorPath(file.path) === normalizedRecent);
    if (hit) return hit;
  }

  const suffixMatches = candidates.filter(
    (file) => file.relative === relHint || file.relative.endsWith(`/${relHint}`),
  );
  if (suffixMatches.length > 0) {
    return suffixMatches.sort((a, b) => a.relative.length - b.relative.length)[0];
  }

  return candidates.sort((a, b) => a.relative.length - b.relative.length)[0];
}
