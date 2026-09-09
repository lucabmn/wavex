import {
  Archive,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock,
  FolderOpen,
  BarChart,
  Bot,
  GitBranch,
  Inbox,
  MoreHorizontal,
  Pin,
  PinOff,
  File,
  Plus,
  Search,
  Trash2,
} from "./icons";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useDragResize } from "../hooks/useDragResize";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useProjectDiffStats } from "../hooks/useProjectDiffStats";
import { useSortable } from "../hooks/useSortable";
import { useTabGroupLogos } from "../hooks/useTabGroupLogos";
import { useWorktrees } from "../hooks/useWorktrees";
import {
  loadProjectRailWidth,
  PROJECT_RAIL_WIDTH_DEFAULT,
  PROJECT_RAIL_WIDTH_MAX,
  PROJECT_RAIL_WIDTH_MIN,
  saveProjectRailWidth,
} from "../lib/appearance";
import { basename, revealPath, type GitDiffStats } from "../lib/fs";
import { canRevealPath, MOD, revealLabel } from "../lib/platform";
import { hostIdForProject } from "../lib/transport";
import type { HostId } from "../lib/host";
import { projectKey } from "../lib/host";
import { projectName } from "../lib/paths";
import {
  collectRailProjects,
  loadPinnedProjects,
  loadProjectRailOrder,
  projectRailSections,
  sameProjectPath,
  savePinnedProjects,
  saveProjectRailOrder,
  syncProjectRailOrder,
  type RecentProject,
} from "../lib/recents";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupColorIndex,
  resolveTabGroupCustomColor,
  resolveTabGroupLabel,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
  saveTabGroupColor,
  saveTabGroupCustomColor,
  saveTabGroupLabel,
  saveTabGroupMascot,
} from "../lib/workspace/tabGroups";
import { formatLiveElapsed, type LiveAgent } from "../lib/liveAgents";
import { formatCompactCount } from "../lib/sessionStatus";
import { worktreeRepo } from "../lib/worktrees/worktreeIndex";
import { CreateWorktreeDialog } from "./CreateWorktreeDialog";
import { WorktreeList } from "./WorktreeList";
import { HarnessIcon } from "./HarnessIcon";
import { ProjectLogoIcon } from "./ProjectLogoIcon";
import { ProjectMascot } from "./ProjectMascot";
import { RailAction, RailSearch } from "./RailAction";
import { ModeSwitch } from "./ModeSwitch";
import type { AppMode } from "../lib/workspace/appMode";
import { RemoveProjectDialog } from "./RemoveProjectDialog";
import type { InstalledUpdate } from "../lib/updates/updateNotice";
import { WorkspaceSidebarFooter } from "./WorkspaceSidebarFooter";
import { SettingsNav } from "./SettingsRail";
import { Shimmer } from "../surfaces/Shimmer";
import { TabGroupMenu, type TabGroupMenuExtraItem } from "./TabGroupMenu";
import { useNow } from "../lib/motion";
import { TerminalSpinner } from "./TerminalSpinner";
import type { SettingsSectionId } from "../lib/settings";

function projectMenuExtraItems(
  pinned: boolean,
  canRemove: boolean,
  hostId: HostId,
): TabGroupMenuExtraItem[] {
  const items: TabGroupMenuExtraItem[] = [
    { id: "worktree", label: "New worktree…", icon: GitBranch },
    pinned
      ? { id: "unpin", label: "Unpin project", icon: PinOff }
      : { id: "pin", label: "Pin project", icon: Pin },
    // A file manager opens where the user is, not on the host.
    ...(canRevealPath(hostId)
      ? [{ id: "reveal", label: revealLabel(hostId), icon: FolderOpen }]
      : []),
  ];
  if (canRemove) {
    items.push(
      { id: "archive", label: "Archive", icon: Archive, sepBefore: true },
      { id: "delete", label: "Delete", icon: Trash2, danger: true },
    );
  }
  return items;
}

type Props = {
  cwd: string;
  recents: RecentProject[];
  inboxUnseen?: boolean;
  busyPaths?: Iterable<string>;
  onSearch?: () => void;
  searchActive?: boolean;
  onOpenInbox?: () => void;
  inboxActive?: boolean;
  notesEnabled?: boolean;
  onOpenNotes?: () => void;
  notesActive?: boolean;
  onOpenUsage?: () => void;
  usageActive?: boolean;
  onOpenActivity?: () => void;
  onOpenAutomations?: () => void;
  activityActive?: boolean;
  automationsActive?: boolean;
  onSelectProject: (path: string) => void;
  onOpenProject: () => void;
  onRemoveProject?: (path: string, options: { purgeData: boolean }) => void;
  liveAgents?: LiveAgent[];
  activeSessionId?: string;
  onSelectAgent?: (sessionId: string) => void;
  settingsOpen?: boolean;
  settingsSection?: SettingsSectionId;
  onOpenSettings?: () => void;
  profileMenuOpen?: boolean;
  onProfileMenuOpenChange?: (open: boolean) => void;
  onSwitchProfile?: (profileId: string) => void;
  onManageProfiles?: () => void;
  onSelectSettingsSection?: (section: SettingsSectionId) => void;
  onCloseSettings?: () => void;
  updateNotice?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
  /** The session/files sidebar is visible beside this rail. */
  besideSidebar?: boolean;
  mode?: AppMode;
  onModeChange?: (mode: AppMode) => void;
};

export function ProjectRail({
  cwd,
  recents,
  mode,
  onModeChange,
  inboxUnseen = false,
  busyPaths,
  onSearch,
  searchActive = false,
  onOpenInbox,
  inboxActive = false,
  notesEnabled = true,
  onOpenNotes,
  notesActive = false,
  onOpenUsage,
  usageActive = false,
  onOpenActivity,
  onOpenAutomations,
  activityActive = false,
  automationsActive = false,
  onSelectProject,
  onOpenProject,
  onRemoveProject,
  liveAgents = [],
  activeSessionId,
  onSelectAgent,
  settingsOpen = false,
  settingsSection = "general",
  onOpenSettings,
  profileMenuOpen = false,
  onProfileMenuOpenChange,
  onSwitchProfile,
  onManageProfiles,
  onSelectSettingsSection,
  onCloseSettings,
  updateNotice = null,
  onOpenWhatsNew,
  onDismissUpdate,
  besideSidebar = false,
}: Props) {
  const resize = useDragResize({
    min: PROJECT_RAIL_WIDTH_MIN,
    max: () =>
      Math.min(
        PROJECT_RAIL_WIDTH_MAX,
        Math.floor(window.innerWidth * (besideSidebar ? 0.225 : 0.35)),
      ),
    defaultWidth: PROJECT_RAIL_WIDTH_DEFAULT,
    initial: loadProjectRailWidth(),
    onCommit: saveProjectRailWidth,
  });
  const [railOrder, setRailOrder] = useState(loadProjectRailOrder);
  const [pinnedPaths, setPinnedPaths] = useState(loadPinnedProjects);
  const [groupLabels, setGroupLabels] = useState(loadTabGroupLabels);
  const [groupColors, setGroupColors] = useState(loadTabGroupColors);
  const [groupMascots, setGroupMascots] = useState(loadTabGroupMascots);
  const [groupCustomColors, setGroupCustomColors] = useState(loadTabGroupCustomColors);
  const [projectMenu, setProjectMenu] = useState<{
    x: number;
    y: number;
    path: string;
    projectKey: string;
  } | null>(null);
  const [removing, setRemoving] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const [creatingWorktreeFor, setCreatingWorktreeFor] = useState<string | null>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const groupLogos = useTabGroupLogos();
  const allProjects = useMemo(() => collectRailProjects(recents, cwd), [cwd, recents]);
  const attentionCount = useMemo(
    () => liveAgents.filter((agent) => agent.needsApproval).length,
    [liveAgents],
  );
  const sections = useMemo(
    () => projectRailSections(recents, cwd, railOrder, pinnedPaths),
    [cwd, pinnedPaths, railOrder, recents],
  );
  const busy = useMemo(() => {
    const set = new Set<string>();
    for (const path of busyPaths ?? []) set.add(path);
    return set;
  }, [busyPaths]);
  // A worktree is listed under the repository it belongs to, so opening one
  // expands that repository rather than adding a project beside it.
  const activeRepo = useMemo(() => worktreeRepo(cwd) ?? cwd, [cwd]);
  const { worktrees } = useWorktrees(activeRepo, true);

  useEffect(() => {
    setRailOrder((prev) => {
      const synced = syncProjectRailOrder(prev, allProjects);
      if (synced.join("\0") === prev.join("\0")) return prev;
      saveProjectRailOrder(synced);
      return synced;
    });
  }, [allProjects]);

  useEffect(() => {
    setPinnedPaths((prev) => {
      const next = prev.filter((path) => allProjects.has(projectKey(path)));
      if (next.length === prev.length) return prev;
      savePinnedProjects(next);
      return next;
    });
  }, [allProjects]);

  useEffect(() => {
    if (!projectMenu) return;
    const onScroll = () => setProjectMenu(null);
    const scrollParent = scrollRef.current ?? window;
    scrollParent.addEventListener("scroll", onScroll, true);
    return () => scrollParent.removeEventListener("scroll", onScroll, true);
  }, [projectMenu]);

  const openProjectMenu = (path: string, x: number, y: number) => {
    setProjectMenu({
      x,
      y,
      path,
      projectKey: projectName(path),
    });
  };

  const onProjectContextMenu = (path: string, event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openProjectMenu(path, event.clientX, event.clientY);
  };

  const onProjectRename = (projectKey: string, label: string) => {
    saveTabGroupLabel(projectKey, label);
    setGroupLabels(loadTabGroupLabels());
  };

  const onProjectColorChange = (projectKey: string, colorIndex: number | null) => {
    saveTabGroupColor(projectKey, colorIndex);
    setGroupColors(loadTabGroupColors());
    setGroupCustomColors(loadTabGroupCustomColors());
  };

  const onProjectMascotChange = (projectKey: string, name: string | null) => {
    saveTabGroupMascot(projectKey, name);
    setGroupMascots(loadTabGroupMascots());
  };

  const onProjectCustomColorChange = (projectKey: string, color: string) => {
    saveTabGroupCustomColor(projectKey, color);
    setGroupColors(loadTabGroupColors());
    setGroupCustomColors(loadTabGroupCustomColors());
  };

  const reorderSubset = (fullOrder: string[], subsetOrder: string[], subsetPaths: Set<string>) => {
    const next: string[] = [];
    let subsetIndex = 0;
    for (const path of fullOrder) {
      if (!subsetPaths.has(path)) {
        next.push(path);
        continue;
      }
      if (subsetIndex < subsetOrder.length) {
        next.push(subsetOrder[subsetIndex++]);
      }
    }
    return next;
  };

  const onReorderPinned = (ids: string[]) => {
    const subset = new Set(sections.pinned.map((item) => item.path));
    const next = reorderSubset(railOrder, ids, subset);
    setRailOrder(next);
    saveProjectRailOrder(next);
  };

  const onReorderProjects = (ids: string[]) => {
    const subset = new Set(sections.projects.map((item) => item.path));
    const next = reorderSubset(railOrder, ids, subset);
    setRailOrder(next);
    saveProjectRailOrder(next);
  };

  const onTogglePin = (path: string) => {
    const isPinned = pinnedPaths.some((pinned) => sameProjectPath(pinned, path));
    const next = isPinned
      ? pinnedPaths.filter((pinned) => !sameProjectPath(pinned, path))
      : [...pinnedPaths, path];
    setPinnedPaths(next);
    savePinnedProjects(next);
  };

  const onProjectMenuPick = (action: string) => {
    if (!projectMenu) return;
    const { path, projectKey } = projectMenu;
    if (action === "worktree") setCreatingWorktreeFor(path);
    else if (action === "pin" || action === "unpin") onTogglePin(path);
    else if (action === "reveal") void revealPath(path, hostIdForProject(path));
    else if (action === "archive") {
      onRemoveProject?.(path, { purgeData: false });
    } else if (action === "delete") {
      setRemoving({
        path,
        name: resolveTabGroupLabel(projectKey, groupLabels, basename(path)),
      });
    }
  };

  const onConfirmDelete = () => {
    if (!removing) return;
    onRemoveProject?.(removing.path, { purgeData: true });
    setRemoving(null);
  };

  /** Only the open repository expands: every row polls git for its own stats. */
  const renderWorktrees = (path: string): ReactNode =>
    sameProjectPath(path, activeRepo) && worktrees.length > 0 ? (
      <WorktreeList
        repoPath={activeRepo}
        worktrees={worktrees}
        cwd={cwd}
        isBusy={(candidate) => isBusyPath(candidate, busy)}
        onSelect={onSelectProject}
        onCreate={() => setCreatingWorktreeFor(activeRepo)}
        onRemoved={(removed) => {
          if (sameProjectPath(removed, cwd)) onSelectProject(activeRepo);
        }}
      />
    ) : null;

  // A project list under a surface is a list nobody is looking at, so the
  // rows drop their highlight the same way they do under search.
  const surfaceCovering =
    searchActive ||
    inboxActive ||
    notesActive ||
    usageActive ||
    activityActive ||
    automationsActive;

  const pinnedIds = sections.pinned.map((item) => item.path);
  const projectIds = sections.projects.map((item) => item.path);
  const pinnedSortable = useSortable(pinnedIds, onReorderPinned, {
    axis: "y",
    onActivate: onSelectProject,
  });
  const projectSortable = useSortable(projectIds, onReorderProjects, {
    axis: "y",
    onActivate: onSelectProject,
  });
  return (
    <nav
      ref={resize.setPaneRef}
      aria-label="Projects"
      className="sidebar-glass ui-rule-r relative flex shrink-0 flex-col"
    >
      {settingsOpen ? (
        <SettingsNav
          section={settingsSection}
          onSelect={(next) => onSelectSettingsSection?.(next)}
          onClose={() => onCloseSettings?.()}
        />
      ) : (
        <>
          {mode && onModeChange ? (
            <div className="ui-rule-b flex h-10 shrink-0 items-stretch px-2">
              <ModeSwitch mode={mode} onChange={onModeChange} stretch />
            </div>
          ) : null}
          <div className="flex shrink-0 flex-col gap-px px-2 pb-2 pt-2">
            <RailSearch
              label="Search"
              icon={Search}
              onClick={onSearch}
              active={searchActive}
              shortcut={`${MOD}K`}
              ariaLabel={`Search (${MOD}K)`}
            />
            <div className="mt-0.5" />
            <RailAction
              label="Inbox"
              icon={Inbox}
              onClick={onOpenInbox}
              active={inboxActive}
              dot={inboxUnseen}
              ariaLabel={inboxUnseen ? "Inbox, new items" : "Inbox"}
            />
            {notesEnabled ? (
              <RailAction
                label="Notes"
                icon={File}
                onClick={onOpenNotes}
                active={notesActive}
                ariaLabel="Notes"
              />
            ) : null}
            <RailAction
              label="Usage"
              icon={BarChart}
              onClick={onOpenUsage}
              active={usageActive}
              ariaLabel="Usage"
            />
            <RailAction
              label="Automations"
              icon={Clock}
              onClick={onOpenAutomations}
              active={automationsActive}
              ariaLabel="Automations"
            />
            <RailAction
              label="Activity"
              icon={Bot}
              onClick={onOpenActivity}
              active={activityActive}
              badge={attentionCount || undefined}
              ariaLabel={
                attentionCount > 0
                  ? `Agent activity, ${attentionCount} ${attentionCount === 1 ? "item needs you" : "items need you"}`
                  : "Agent activity"
              }
            />
          </div>

          <div
            ref={(el) => {
              lockOverscroll(el);
              scrollRef.current = el;
            }}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-none pb-2"
          >
            {sections.pinned.length > 0 ? (
              <ProjectSection
                label="Pinned"
                items={sections.pinned}
                cwd={cwd}
                activeRepo={activeRepo}
                busy={busy}
                sortable={pinnedSortable}
                pinned
                searchActive={surfaceCovering}
                onSelect={onSelectProject}
                onTogglePin={onTogglePin}
                onContextMenu={onProjectContextMenu}
                onOpenMenu={openProjectMenu}
                groupLabels={groupLabels}
                groupColors={groupColors}
                groupCustomColors={groupCustomColors}
                groupLogos={groupLogos}
                groupMascots={groupMascots}
                renderAfter={renderWorktrees}
              />
            ) : null}

            <ProjectSection
              label="Projects"
              items={sections.projects}
              emptyLabel="No projects yet"
              onAdd={onOpenProject}
              cwd={cwd}
              activeRepo={activeRepo}
              busy={busy}
              sortable={projectSortable}
              pinned={false}
              searchActive={surfaceCovering}
              onSelect={onSelectProject}
              onTogglePin={onTogglePin}
              onContextMenu={onProjectContextMenu}
              onOpenMenu={openProjectMenu}
              groupLabels={groupLabels}
              groupColors={groupColors}
              groupCustomColors={groupCustomColors}
              groupLogos={groupLogos}
              groupMascots={groupMascots}
              renderAfter={renderWorktrees}
            />
          </div>
          <LiveAgentsPreview
            agents={liveAgents}
            activeSessionId={activeSessionId}
            onSelect={onSelectAgent}
            groupLabels={groupLabels}
            groupColors={groupColors}
            groupCustomColors={groupCustomColors}
            groupMascots={groupMascots}
          />
          <WorkspaceSidebarFooter
            profileMenuOpen={profileMenuOpen}
            onProfileMenuOpenChange={onProfileMenuOpenChange}
            onSwitchProfile={onSwitchProfile}
            onManageProfiles={onManageProfiles}
            update={updateNotice}
            onOpenWhatsNew={onOpenWhatsNew}
            onDismissUpdate={onDismissUpdate}
            onOpenSettings={onOpenSettings}
          />
        </>
      )}
      {projectMenu ? (
        <TabGroupMenu
          x={projectMenu.x}
          y={projectMenu.y}
          groupId={projectMenu.projectKey}
          label={resolveTabGroupLabel(
            projectMenu.projectKey,
            groupLabels,
            basename(projectMenu.path),
          )}
          colorIndex={resolveTabGroupColorIndex(
            projectMenu.projectKey,
            groupColors,
            groupCustomColors,
          )}
          customColor={resolveTabGroupCustomColor(projectMenu.projectKey, groupCustomColors)}
          currentColor={resolveTabGroupColor(
            projectMenu.projectKey,
            groupColors,
            groupCustomColors,
            projectMenu.projectKey,
          )}
          logoPath={resolveTabGroupLogo(projectMenu.projectKey, groupLogos)}
          logoProject={projectMenu.projectKey}
          mascotName={resolveTabGroupMascot(projectMenu.projectKey, groupMascots)}
          mascotProject={projectMenu.projectKey}
          onRename={onProjectRename}
          onColorChange={onProjectColorChange}
          onCustomColorChange={onProjectCustomColorChange}
          onMascotChange={onProjectMascotChange}
          onLogoChange={() => {}}
          onPick={() => {}}
          onClose={() => setProjectMenu(null)}
          showActions={false}
          extraItems={projectMenuExtraItems(
            pinnedPaths.some((pinned) => sameProjectPath(pinned, projectMenu.path)),
            Boolean(onRemoveProject),
            hostIdForProject(projectMenu.path),
          )}
          onExtraPick={onProjectMenuPick}
        />
      ) : null}
      {creatingWorktreeFor ? (
        <CreateWorktreeDialog
          repoPath={creatingWorktreeFor}
          onCancel={() => setCreatingWorktreeFor(null)}
          onCreated={(worktree, open) => {
            setCreatingWorktreeFor(null);
            if (open) onSelectProject(worktree.path);
          }}
          onOpenWorktree={(path) => {
            setCreatingWorktreeFor(null);
            onSelectProject(path);
          }}
        />
      ) : null}
      {removing ? (
        <RemoveProjectDialog
          name={removing.name}
          path={removing.path}
          onConfirm={onConfirmDelete}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Resize project sidebar"
        aria-valuenow={resize.width}
        aria-valuetext={`${resize.width} pixels`}
        aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Home End Enter"
        aria-valuemin={PROJECT_RAIL_WIDTH_MIN}
        aria-valuemax={resize.maxWidth}
        className={`absolute inset-y-0 -right-px z-10 w-1.5 cursor-col-resize touch-none focus-visible:bg-accent/60 focus-visible:outline-none ${
          resize.dragging ? "bg-content/15" : "hover:bg-hover"
        }`}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
        onKeyDown={resize.onKeyDown}
      />
    </nav>
  );
}

type SortableHandle = ReturnType<typeof useSortable>;

const LIVE_AGENT_MIN = 2;
const LIVE_AGENT_CAP = 4;

function LiveAgentsPreview({
  agents,
  activeSessionId,
  onSelect,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupMascots,
}: {
  agents: LiveAgent[];
  activeSessionId?: string;
  onSelect?: (sessionId: string) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupMascots: Record<string, string>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const lockList = useLockOverscroll<HTMLDivElement>();
  const ticking =
    !collapsed &&
    agents.length >= LIVE_AGENT_MIN &&
    agents.some((agent) => !agent.done && agent.startedAt != null);

  const now = useNow(ticking);

  if (agents.length < LIVE_AGENT_MIN) return null;

  const extra = agents.length - LIVE_AGENT_CAP;
  const visible = expanded || extra <= 0 ? agents : agents.slice(0, LIVE_AGENT_CAP);

  return (
    <div className="shrink-0 px-2">
      <div
        role="status"
        aria-label="Working agents"
        className="overflow-hidden rounded-lg bg-content/5"
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand working agents" : "Collapse working agents"}
          onClick={() => setCollapsed((closed) => !closed)}
          className="flex w-full items-center gap-2 px-3.5 py-1.5 text-left hover:bg-hover"
        >
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent animate-pulse" />
          <span className="min-w-0 flex-1 truncate text-xs text-faint">Working</span>
          <span className="text-[11.5px] tabular-nums text-dim">{agents.length}</span>
          {collapsed ? (
            <ChevronDown className="size-3 shrink-0 text-dim" strokeWidth={1.75} />
          ) : (
            <ChevronUp className="size-3 shrink-0 text-dim" strokeWidth={1.75} />
          )}
        </button>
        {collapsed ? null : (
          <>
            <div
              ref={expanded ? lockList : undefined}
              className={`flex flex-col gap-px px-1 ${
                extra > 0 ? "" : "pb-1"
              } ${expanded ? "max-h-[45vh] overflow-y-auto overscroll-none" : ""}`}
            >
              {visible.map((agent) => (
                <LiveAgentCard
                  key={agent.id}
                  agent={agent}
                  now={now}
                  selected={agent.id === activeSessionId}
                  onSelect={onSelect}
                  groupLabels={groupLabels}
                  groupColors={groupColors}
                  groupCustomColors={groupCustomColors}
                  groupMascots={groupMascots}
                />
              ))}
            </div>
            {extra > 0 ? (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded((open) => !open)}
                className="flex w-full items-center justify-center gap-1 px-2 py-1.5 text-[11.5px] text-faint hover:bg-hover hover:text-content"
              >
                {expanded ? (
                  <ChevronUp className="size-3" strokeWidth={1.75} />
                ) : (
                  <ChevronDown className="size-3" strokeWidth={1.75} />
                )}
                {expanded ? "Show less" : `${extra} more`}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function LiveAgentCard({
  agent,
  now,
  selected,
  onSelect,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupMascots,
}: {
  agent: LiveAgent;
  now: number;
  selected: boolean;
  onSelect?: (sessionId: string) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupMascots: Record<string, string>;
}) {
  // An agent in a worktree still belongs to its repository: keying on the
  // folder would give every branch its own color, mascot and name, and drop the
  // project's own label.
  const repo = worktreeRepo(agent.cwd);
  const projectKey = projectName(repo ?? agent.cwd);
  const worktree = repo ? basename(agent.cwd) : null;
  const project = resolveTabGroupLabel(projectKey, groupLabels, projectKey);
  const color = resolveTabGroupColor(projectKey, groupColors, groupCustomColors, projectKey);
  const elapsed = agent.done
    ? agent.durationMs != null
      ? formatLiveElapsed(0, agent.durationMs)
      : ""
    : agent.startedAt != null
      ? formatLiveElapsed(agent.startedAt, now)
      : "";
  const activity = agent.needsApproval ? "Need approval" : agent.done ? "Done" : agent.activity;
  const live = !agent.needsApproval && !agent.done;
  const where = worktree ? `${project} · ${worktree}` : project;
  const title = [agent.title, where, activity, elapsed].filter(Boolean).join("\n");

  return (
    <button
      type="button"
      title={title}
      aria-label={[agent.title, where, activity, elapsed].filter(Boolean).join(", ")}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect?.(agent.id)}
      data-selected={selected ? "true" : undefined}
      className="ui-row ui-focus relative flex w-full flex-col rounded-md px-2 py-1.5 text-left"
    >
      <span className="flex min-w-0 items-center gap-2">
        <ProjectMascot
          project={projectKey}
          color={color}
          name={resolveTabGroupMascot(projectKey, groupMascots)}
          className="size-2 shrink-0"
          active={live}
        />
        {live ? (
          <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold leading-snug">
            {agent.title}
          </p>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold leading-snug">
            {agent.title}
          </span>
        )}
      </span>
      <span
        className={`mt-1 flex min-w-0 items-center gap-1.5 pl-4 text-[11.5px] leading-tight ${
          agent.needsApproval ? "text-amber-400" : agent.done ? "text-emerald-400" : "text-faint"
        }`}
      >
        {agent.needsApproval ? (
          <CircleAlert className="size-3 shrink-0" strokeWidth={1.75} />
        ) : agent.done ? (
          <Check className="size-3 shrink-0" strokeWidth={2.25} />
        ) : (
          <TerminalSpinner className="inline-block w-3 select-none text-center text-[11.5px] leading-none" />
        )}
        <span className="min-w-0 truncate">{activity}</span>
      </span>
      <span className="mt-1 flex min-w-0 items-center gap-1.5 pl-4 text-[11.5px] leading-tight text-faint">
        <HarnessIcon harness={agent.harness} className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {project}
          {worktree ? <span className="text-dim"> · {worktree}</span> : null}
        </span>
        {elapsed ? <span className="shrink-0 tabular-nums">{elapsed}</span> : null}
      </span>
    </button>
  );
}

function ProjectSection({
  label,
  items,
  emptyLabel,
  onAdd,
  cwd,
  activeRepo,
  busy,
  sortable,
  pinned,
  searchActive,
  onSelect,
  onTogglePin,
  onContextMenu,
  onOpenMenu,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupLogos,
  groupMascots,
  renderAfter,
}: {
  label: string;
  items: RecentProject[];
  emptyLabel?: string;
  onAdd?: () => void;
  cwd: string;
  /** Repository the open folder belongs to — the repository itself, or the one
   *  behind the open worktree. */
  activeRepo: string;
  busy: Set<string>;
  sortable: SortableHandle;
  pinned: boolean;
  searchActive: boolean;
  onSelect: (path: string) => void;
  onTogglePin: (path: string) => void;
  onContextMenu: (path: string, event: MouseEvent<HTMLElement>) => void;
  onOpenMenu: (path: string, x: number, y: number) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupLogos: ReturnType<typeof useTabGroupLogos>;
  groupMascots: Record<string, string>;
  /** Extra rows under one project — the repository's worktrees. */
  renderAfter?: (path: string) => ReactNode;
}) {
  return (
    <div className="shrink-0 mb-2">
      <div className="flex items-center gap-1 px-3 pb-1.5 pt-1">
        <span className="min-w-0 flex-1 truncate px-1 text-xs text-faint">{label}</span>
        {onAdd ? (
          <button
            type="button"
            title="Open project"
            aria-label="Open project"
            onClick={onAdd}
            className="ui-focus grid size-5 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-content"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      {items.length === 0 && emptyLabel ? (
        <p className="px-4 pb-1 text-[11.5px] leading-tight text-dim">{emptyLabel}</p>
      ) : null}
      <div className="flex flex-col gap-px px-2">
        {items.map((item, index) => (
          <Fragment key={item.path}>
            <ProjectCard
              item={item}
              selected={!searchActive && sameProjectPath(item.path, cwd)}
              expanded={!searchActive && sameProjectPath(item.path, activeRepo)}
              busy={isBusyPath(item.path, busy)}
              pinned={pinned}
              sortable={sortable}
              index={index}
              onSelect={onSelect}
              onTogglePin={onTogglePin}
              onContextMenu={onContextMenu}
              onOpenMenu={onOpenMenu}
              groupLabels={groupLabels}
              groupColors={groupColors}
              groupCustomColors={groupCustomColors}
              groupLogos={groupLogos}
              groupMascots={groupMascots}
            />
            {renderAfter?.(item.path)}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// The name keeps a floor so a dirty checkout's diff stat can never shrink it
// to zero width, which renders as nothing rather than as an ellipsis.
const nameClassName = "min-w-14 flex-1 truncate text-sm font-medium leading-tight";

function ProjectCard({
  item,
  selected,
  expanded,
  busy,
  pinned,
  sortable,
  index,
  onSelect,
  onTogglePin,
  onContextMenu,
  onOpenMenu,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupLogos,
  groupMascots,
}: {
  item: RecentProject;
  selected: boolean;
  /** One of this project's worktrees is the open folder. */
  expanded: boolean;
  busy: boolean;
  pinned: boolean;
  sortable: SortableHandle;
  index: number;
  onSelect: (path: string) => void;
  onTogglePin: (path: string) => void;
  onContextMenu: (path: string, event: MouseEvent<HTMLElement>) => void;
  onOpenMenu: (path: string, x: number, y: number) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupLogos: ReturnType<typeof useTabGroupLogos>;
  groupMascots: Record<string, string>;
}) {
  const fallbackName = basename(item.path);
  const projectKey = projectName(item.path);
  const name = resolveTabGroupLabel(projectKey, groupLabels, fallbackName);
  const logoPath = resolveTabGroupLogo(projectKey, groupLogos);
  const color = resolveTabGroupColor(projectKey, groupColors, groupCustomColors, projectKey);
  const dragging = sortable.draggingId === item.path;
  const showStart =
    sortable.draggingId &&
    sortable.toIndex === index &&
    sortable.fromIndex !== null &&
    sortable.toIndex < sortable.fromIndex;
  const showEnd =
    sortable.draggingId &&
    sortable.toIndex === index &&
    sortable.fromIndex !== null &&
    sortable.toIndex > sortable.fromIndex;
  const diffEnabled = Boolean(item.path) && item.path !== "~";
  const stats = useProjectDiffStats(item.path, diffEnabled);
  const files = stats?.files ?? 0;
  const additions = stats?.additions ?? 0;
  const deletions = stats?.deletions ?? 0;
  const hasChanges = files > 0 || additions > 0 || deletions > 0;
  const cardTitle = projectCardTitle(item.path, name, stats, busy);
  const cardAriaLabel = projectCardAriaLabel(name, stats, busy);

  return (
    <div
      ref={(el) => sortable.setItemRef(item.path, el)}
      data-selected={selected ? "true" : undefined}
      className={`ui-row group relative flex h-8 touch-none items-stretch rounded-md px-2 ${
        expanded || selected ? "" : "opacity-75"
      } ${dragging ? "opacity-40" : ""} cursor-default`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
          return;
        }
        sortable.onItemPointerDown(item.path, event);
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
          return;
        }
        if (sortable.consumeClick()) return;
        onSelect(item.path);
      }}
      onContextMenu={(event) => onContextMenu(item.path, event)}
    >
      {showStart ? (
        <div className="pointer-events-none absolute inset-x-2 top-0 z-20 h-0.5 bg-accent" />
      ) : null}
      {showEnd ? (
        <div className="pointer-events-none absolute inset-x-2 bottom-0 z-20 h-0.5 bg-accent" />
      ) : null}
      <button
        type="button"
        title={cardTitle}
        aria-label={cardAriaLabel}
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 cursor-default items-center gap-2 text-left group-hover:pr-6"
      >
        <div className="grid size-4 shrink-0 place-items-center transition-opacity group-hover:opacity-0">
          {logoPath && !busy ? (
            <ProjectLogoIcon
              path={logoPath}
              className="size-4 rounded-sm"
              imageClassName="size-4"
            />
          ) : (
            <ProjectMascot
              project={projectKey}
              color={color}
              name={resolveTabGroupMascot(projectKey, groupMascots)}
              className="size-3"
              active={busy}
            />
          )}
        </div>
        {busy ? (
          <Shimmer as="span" duration={1.4} className={nameClassName}>
            {name}
          </Shimmer>
        ) : (
          <span className={nameClassName}>{name}</span>
        )}
        {hasChanges ? (
          <span className="min-w-0 group-hover:hidden">
            <ProjectDiffStat additions={additions} deletions={deletions} files={files} />
          </span>
        ) : stats ? (
          <span
            className="shrink-0 text-emerald-400/70 group-hover:hidden"
            title="No uncommitted changes"
            aria-label="No uncommitted changes"
          >
            <Check className="size-3 shrink-0" strokeWidth={2.25} />
          </span>
        ) : null}
      </button>
      <button
        type="button"
        data-no-drag
        title="Project options"
        aria-label="Project options"
        aria-haspopup="menu"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onOpenMenu(item.path, event.clientX, event.clientY);
        }}
        className="ui-focus absolute right-1 top-1/2 hidden size-6 -translate-y-1/2 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-content group-hover:grid"
      >
        <MoreHorizontal className="size-4" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        data-no-drag
        title={pinned ? "Unpin project" : "Pin project"}
        aria-label={pinned ? "Unpin project" : "Pin project"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onTogglePin(item.path);
        }}
        className="absolute left-2 top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-faint opacity-0 pointer-events-none transition-opacity hover:text-content group-hover:pointer-events-auto group-hover:opacity-100"
      >
        {pinned ? (
          <PinOff className="size-3.5" strokeWidth={1.75} />
        ) : (
          <Pin className="size-3.5" strokeWidth={1.75} />
        )}
      </button>
    </div>
  );
}

function isBusyPath(path: string, busy: Set<string>): boolean {
  for (const other of busy) {
    if (sameProjectPath(path, other)) return true;
  }
  return false;
}

function ProjectDiffStat({
  additions,
  deletions,
  files = 0,
}: {
  additions: number;
  deletions: number;
  files?: number;
}) {
  if (additions <= 0 && deletions <= 0 && files <= 0) return null;

  const label = [
    files > 0 ? `${files} ${files === 1 ? "file" : "files"} changed` : "",
    additions > 0 ? `+${additions}` : "",
    deletions > 0 ? `-${deletions}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      title={`${label} uncommitted`}
      aria-label={`${label} uncommitted`}
      className="flex min-w-0 items-center gap-1 overflow-hidden font-mono text-[11.5px] font-semibold tabular-nums"
    >
      {files > 0 ? (
        <span className="truncate font-sans font-medium text-faint">{files} changed</span>
      ) : null}
      {additions > 0 ? (
        <span className="shrink-0 text-emerald-400">+{formatCompactCount(additions)}</span>
      ) : null}
      {deletions > 0 ? (
        <span className="shrink-0 text-red-400">-{formatCompactCount(deletions)}</span>
      ) : null}
    </span>
  );
}

function projectCardTitle(
  path: string,
  name: string,
  stats: GitDiffStats | null,
  busy: boolean,
): string {
  const parts = [name, path];
  if (busy) parts.push("Working");
  const files = stats?.files ?? 0;
  const additions = stats?.additions ?? 0;
  const deletions = stats?.deletions ?? 0;
  if (stats) {
    if (files > 0 || additions > 0 || deletions > 0) {
      parts.push(
        [
          files > 0 ? `${files} ${files === 1 ? "file" : "files"} changed` : "",
          additions > 0 ? `+${additions}` : "",
          deletions > 0 ? `-${deletions}` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } else {
      parts.push("Clean");
    }
  }
  return parts.join("\n");
}

function projectCardAriaLabel(name: string, stats: GitDiffStats | null, busy: boolean): string {
  const parts = [name];
  if (busy) parts.push("working");
  const files = stats?.files ?? 0;
  const additions = stats?.additions ?? 0;
  const deletions = stats?.deletions ?? 0;
  if (stats) {
    if (files > 0) {
      parts.push(`${files} ${files === 1 ? "file" : "files"} changed`);
    } else {
      parts.push("clean");
    }
  }
  if (additions > 0) parts.push(`+${additions}`);
  if (deletions > 0) parts.push(`-${deletions}`);
  return parts.join(", ");
}
