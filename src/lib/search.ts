import { getDefaultHostId, invokeOn } from "./transport";
import { hostPathArgs, type HostId } from "./host";
import { pathKey } from "./paths";

export type ProjectSearchMatch = {
  path: string;
  relative: string;
  line: number;
  column: number;
  preview: string;
};

export type ProjectSearchResult = {
  matches: ProjectSearchMatch[];
  truncated: boolean;
};

export type ProjectSearchOptions = {
  cwd: string;
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  include?: string;
  exclude?: string;
};

export type EditorNavigation = {
  line: number;
  column?: number;
};

export type EditorNavigationTarget = EditorNavigation & {
  path: string;
  token: number;
};

export type OpenFileFn = (path: string, navigation?: EditorNavigation) => void;

export function normalizeEditorPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "") || path;
}

export function editorPathsEqual(a: string, b: string): boolean {
  // `pathKey`, not the raw normalizer: the same file reaches the editor from
  // git, from search, and from the tree, and on Windows those disagree on case.
  return pathKey(a) === pathKey(b);
}

export function searchProject(
  options: ProjectSearchOptions,
  hostId?: HostId,
): Promise<ProjectSearchResult> {
  const target = hostPathArgs(options.cwd, hostId, getDefaultHostId());
  return invokeOn<ProjectSearchResult>(target.hostId, "search_project", {
    options: { ...options, cwd: target.path },
  });
}
