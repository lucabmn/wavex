import { filterInboxItems, inboxItemStatus, type InboxItem, type InboxKind } from "./githubTasks";
import { normalizeProjectPath } from "./recents";
import { timeFilterStart, type SessionTimeFilter } from "./sessionFilters";

export type InboxTimeFilter = SessionTimeFilter;

export type InboxStatusFilter = {
  open: boolean;
  draft: boolean;
  closed: boolean;
  merged: boolean;
};

export type InboxFilters = {
  assignedToMe: boolean;
  hiddenProjects: string[];
  hiddenKinds: InboxKind[];
  time: InboxTimeFilter;
  status: InboxStatusFilter;
};

export const DEFAULT_INBOX_STATUS_FILTER: InboxStatusFilter = {
  open: false,
  draft: false,
  closed: false,
  merged: false,
};

export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  assignedToMe: false,
  hiddenProjects: [],
  hiddenKinds: [],
  time: "all",
  status: DEFAULT_INBOX_STATUS_FILTER,
};

const FILTERS_KEY = "wavex.inboxFilters";

export function loadInboxFilters(): InboxFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_INBOX_FILTERS;
    const parsed = JSON.parse(raw) as Partial<InboxFilters>;
    return {
      assignedToMe: parsed.assignedToMe === true,
      hiddenProjects: Array.isArray(parsed.hiddenProjects)
        ? parsed.hiddenProjects.filter(
            (path): path is string => typeof path === "string" && path.length > 0,
          )
        : [],
      hiddenKinds: Array.isArray(parsed.hiddenKinds)
        ? parsed.hiddenKinds.filter(isGithubInboxKind)
        : [],
      time: isTimeFilter(parsed.time) ? parsed.time : "all",
      status: {
        open: parsed.status?.open === true,
        draft: parsed.status?.draft === true,
        closed: parsed.status?.closed === true,
        merged: parsed.status?.merged === true,
      },
    };
  } catch {
    return DEFAULT_INBOX_FILTERS;
  }
}

export function saveInboxFilters(filters: InboxFilters) {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // private mode / quota
  }
}

export function pruneInboxFilters(
  filters: InboxFilters,
  projectPaths: Iterable<string>,
): InboxFilters {
  const known = new Set([...projectPaths].map((path) => normalizeProjectPath(path)));
  const hiddenProjects = filters.hiddenProjects.filter((path) =>
    known.has(normalizeProjectPath(path)),
  );
  if (hiddenProjects.length === filters.hiddenProjects.length) return filters;
  return { ...filters, hiddenProjects };
}

export function hasActiveInboxFilters(filters: InboxFilters): boolean {
  const statusActive =
    filters.status.open || filters.status.draft || filters.status.closed || filters.status.merged;
  return (
    filters.assignedToMe ||
    filters.hiddenProjects.length > 0 ||
    filters.hiddenKinds.length > 0 ||
    filters.time !== "all" ||
    statusActive
  );
}

/** No status box checked means "no restriction", so the fetch has to widen with it. */
export function inboxFetchState(filters: InboxFilters): "open" | "all" {
  const { open, draft, closed, merged } = filters.status;
  if (closed || merged) return "all";
  return open || draft ? "open" : "all";
}

export function filterInboxByProject(
  items: readonly InboxItem[],
  hiddenProjects: Iterable<string>,
): InboxItem[] {
  const hidden = new Set([...hiddenProjects].map((path) => normalizeProjectPath(path)));
  if (hidden.size === 0) return [...items];
  return items.filter((item) => {
    const path = normalizeProjectPath(item.projectPath);
    if (!path) return true;
    return !hidden.has(path);
  });
}

export function filterInboxByKind(
  items: readonly InboxItem[],
  hiddenKinds: Iterable<InboxKind>,
): InboxItem[] {
  const hidden = new Set(hiddenKinds);
  if (hidden.size === 0) return [...items];
  return items.filter((item) => !hidden.has(item.kind));
}

export function filterInboxByStatus(
  items: readonly InboxItem[],
  status: InboxStatusFilter,
): InboxItem[] {
  const any = status.open || status.draft || status.closed || status.merged;
  if (!any) return [...items];
  return items.filter((item) => {
    const label = inboxItemStatus(item);
    if (status.open && label === "Open") return true;
    if (status.draft && label === "Draft") return true;
    if (status.closed && label === "Closed") return true;
    if (status.merged && label === "Merged") return true;
    return false;
  });
}

export function filterInboxByTime(
  items: readonly InboxItem[],
  time: InboxTimeFilter,
  now: number,
): InboxItem[] {
  if (time === "all") return [...items];
  const start = timeFilterStart(time, now);
  return items.filter((item) => {
    const updated = Date.parse(item.updatedAt);
    return Number.isFinite(updated) && updated >= start;
  });
}

export function applyInboxFilters(
  items: readonly InboxItem[],
  filters: InboxFilters,
  query: string,
  now = Date.now(),
): InboxItem[] {
  return filterInboxItems(
    filterInboxByStatus(
      filterInboxByTime(
        filterInboxByKind(
          filterInboxByProject([...items], filters.hiddenProjects),
          filters.hiddenKinds,
        ),
        filters.time,
        now,
      ),
      filters.status,
    ),
    query,
  );
}

function isGithubInboxKind(value: unknown): value is InboxKind {
  return value === "issue" || value === "pr";
}

function isTimeFilter(value: unknown): value is InboxTimeFilter {
  return value === "all" || value === "today" || value === "7d" || value === "30d";
}
