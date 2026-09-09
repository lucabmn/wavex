import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Folder,
  GitCompare,
  Globe,
  MessageMultiple,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Plus,
  Terminal,
} from "../chrome/icons";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ExplorerMenu } from "../chrome/ExplorerMenu";
import { FileTree } from "../chrome/FileTree";
import { ProjectSearch } from "../chrome/ProjectSearch";
import { SessionList, type SessionListProps } from "../chrome/SessionList";
import { SourceControl } from "../chrome/SourceControl";
import { SurfaceTabs } from "../chrome/SurfaceTabs";
import { PlaceholderButton, SurfacePlaceholder } from "../chrome/SurfacePlaceholder";
import { IconButton } from "../chrome/TitleBar";
import { useGitFileStatuses } from "../hooks/useGitFileStatuses";
import type { GitHistoryCommit } from "../lib/fs";
import {
  DOCK_SURFACES,
  DOCK_SURFACE_LABEL,
  clampDockSize,
  defaultDockSize,
  isVerticalDock,
  type DockSide,
  type DockSurface,
  type ProjectDock,
} from "../lib/workspace/projectDock";
import type { BrowserHistory } from "../lib/workspace/browserHistory";
import { MOD } from "../lib/platform";
import type { HarnessId } from "../lib/session";
import type { TerminalMetaPatch } from "../lib/terminal/terminalTab";
import { DockBrowser } from "./DockBrowser";
import { TerminalView } from "./TerminalView";

/** Everything the Files and Review surfaces need from the open project. */
export type DockProject = {
  gitCwd: string;
  /** Find in Project has taken over the Files surface. */
  searchOpen: boolean;
  searchFocusToken: number;
  onSearchOpenChange: (open: boolean) => void;
  textHarness?: HarnessId;
  selectedDiffPath?: string;
  selectedCommitSha?: string;
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string) => void;
  onOpenCommit: (commit: GitHistoryCommit) => void;
  onOpenTerminal: (cwd: string) => void;
  onFileMoved: (from: string, to: string) => void;
  onFileDeleted: (path: string) => void;
  onSearch: () => void;
};

type Props = {
  dock: ProjectDock;
  focused: boolean;
  /** Whether this dock's project is the one the window is showing. */
  visible: boolean;
  project: DockProject;
  /**
   * Everything the Sessions surface needs. `active` is the panel's own, so the
   * list is only clocked and polled while it is the surface on screen.
   */
  sessions?: Omit<SessionListProps, "active">;
  onFocus: () => void;
  onHide: () => void;
  onSideChange: (side: DockSide) => void;
  onSurfaceChange: (surface: DockSurface) => void;
  onBrowserChange: (browser: BrowserHistory) => void;
  onSizePaint: (size: number) => void;
  onSizeCommit: (size: number) => void;
  onAddTerminal: () => void;
  onSelectTerminal: (fileId: string) => void;
  onCloseTerminal: (fileId: string) => void;
  onReorderTerminals: (ids: string[]) => void;
  onTerminalMetaChange?: (fileId: string, patch: TerminalMetaPatch) => void;
};

const SIDE_ITEMS: { id: DockSide; label: string }[] = [
  { id: "bottom", label: "Dock Bottom" },
  { id: "top", label: "Dock Top" },
  { id: "left", label: "Dock Left" },
  { id: "right", label: "Dock Right" },
];

const SURFACE_ICON: Record<
  DockSurface,
  ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  sessions: MessageMultiple,
  browser: Globe,
  terminal: Terminal,
  files: Folder,
  review: GitCompare,
};

function sideIcon(side: DockSide) {
  if (side === "top") return PanelTop;
  if (side === "left") return PanelLeft;
  if (side === "right") return PanelRight;
  return PanelBottom;
}

function hideIcon(side: DockSide) {
  if (side === "top") return ChevronUp;
  if (side === "left") return ChevronLeft;
  if (side === "right") return ChevronRight;
  return ChevronDown;
}

/**
 * The project's side panel: a browser, its terminals, the file tree, and the
 * working tree, behind one switcher.
 *
 * Every surface the user has opened stays mounted for as long as the panel
 * does, because switching away from a page mid-form, a terminal mid-command, or
 * a tree mid-expansion and finding it reset is the failure this panel exists to
 * avoid. A surface that has never been opened is not mounted at all, so a
 * project that only ever uses terminals pays for nothing else.
 */
export function DockPanel({
  dock,
  focused,
  visible,
  project,
  sessions,
  onFocus,
  onHide,
  onSideChange,
  onSurfaceChange,
  onBrowserChange,
  onSizePaint,
  onSizeCommit,
  onAddTerminal,
  onSelectTerminal,
  onCloseTerminal,
  onReorderTerminals,
  onTerminalMetaChange,
}: Props) {
  const vertical = isVerticalDock(dock.side);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const sideButton = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; size: number } | null>(null);
  const sizeRef = useRef(dock.size);
  sizeRef.current = dock.size;
  const pending = useRef(dock.size);
  const frame = useRef<number | null>(null);
  const SideIcon = sideIcon(dock.side);
  const HideIcon = hideIcon(dock.side);
  const opened = useOpenedSurfaces(visible ? dock.surface : null);
  const gitStatuses = useGitFileStatuses(
    project.gitCwd,
    visible && dock.open && dock.surface === "files",
  );

  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = vertical ? "row-resize" : "col-resize";
    return () => {
      document.body.style.cursor = previous;
    };
  }, [dragging, vertical]);

  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const viewport = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const paint = (next: number) => {
    pending.current = next;
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      onSizePaint(pending.current);
    });
  };

  const commit = () => {
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    onSizeCommit(pending.current);
  };

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      start: vertical ? event.clientY : event.clientX,
      size: sizeRef.current,
    };
    pending.current = sizeRef.current;
    setDragging(true);
  };

  const onResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const point = vertical ? event.clientY : event.clientX;
    const delta = point - drag.current.start;
    const signed = dock.side === "bottom" || dock.side === "right" ? -delta : delta;
    paint(clampDockSize(dock.side, drag.current.size + signed, viewport()));
  };

  const onResizePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    commit();
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const sash =
    dock.side === "top"
      ? "absolute inset-x-0 -bottom-px z-10 h-1.5 cursor-row-resize touch-none"
      : dock.side === "bottom"
        ? "absolute inset-x-0 -top-px z-10 h-1.5 cursor-row-resize touch-none"
        : dock.side === "left"
          ? "absolute inset-y-0 -right-px z-10 w-1.5 cursor-col-resize touch-none"
          : "absolute inset-y-0 -left-px z-10 w-1.5 cursor-col-resize touch-none";

  return (
    <section
      data-project-dock=""
      className={`@container/dock relative flex h-full min-h-0 min-w-0 flex-col ${
        focused ? "bg-content/3" : "bg-content/2"
      } ${
        dock.side === "top"
          ? "border-b"
          : dock.side === "bottom"
            ? "border-t"
            : dock.side === "left"
              ? "border-r"
              : "border-l"
      } border-content/10`}
      onMouseDown={onFocus}
    >
      <div
        role="separator"
        aria-orientation={vertical ? "horizontal" : "vertical"}
        aria-label="Resize panel"
        aria-valuenow={dock.size}
        className={`${sash} ${dragging ? "bg-content/15" : "hover:bg-content/10"}`}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        onDoubleClick={() => {
          pending.current = defaultDockSize(dock.side);
          commit();
        }}
      />
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-content/10 px-1.5">
        <DockSurfaceSwitch surface={dock.surface} onChange={onSurfaceChange} />
        <div className="min-w-0 flex-1" />
        <div ref={sideButton} className="shrink-0">
          <IconButton
            label="Move Panel"
            onClick={() => {
              const rect = sideButton.current?.getBoundingClientRect();
              if (!rect) return;
              setMenu({ x: rect.left, y: rect.bottom + 4 });
            }}
          >
            <SideIcon className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        </div>
        <IconButton label={`Hide Panel (${MOD}J)`} onClick={onHide}>
          <HideIcon className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className="relative min-h-0 min-w-0 flex-1">
        {/* The list belongs to the project on screen, so a dock whose project
            is not the one showing holds no sessions to paint. */}
        <Surface
          show={dock.surface === "sessions"}
          mounted={visible && opened.has("sessions") && Boolean(sessions)}
        >
          {sessions ? (
            <SessionList
              {...sessions}
              active={visible && dock.open && dock.surface === "sessions"}
            />
          ) : null}
        </Surface>
        <Surface show={dock.surface === "browser"} mounted={opened.has("browser")}>
          <DockBrowser
            browser={dock.browser}
            active={visible && dock.open && dock.surface === "browser"}
            onChange={onBrowserChange}
          />
        </Surface>
        {/* Terminals are never taken down by surface bookkeeping: a running
            process must outlive a look at the browser or the file tree. */}
        <Surface
          show={dock.surface === "terminal"}
          mounted={opened.has("terminal") || dock.pane.files.length > 0}
        >
          <div className="flex h-full min-h-0 min-w-0 flex-col">
            {dock.pane.files.length > 0 ? (
              <>
                <SurfaceTabs
                  files={dock.pane.files}
                  activeFileId={dock.pane.activeFileId}
                  dirtyFileIds={EMPTY_IDS}
                  fileErrorCounts={EMPTY_ERRORS}
                  label="Terminals"
                  onSelectFile={onSelectTerminal}
                  onCloseFile={onCloseTerminal}
                  onReorder={onReorderTerminals}
                  trailing={
                    <div className="flex shrink-0 items-center gap-0.5 border-l border-content/10 px-1">
                      <IconButton label={`New Terminal (${MOD}\`)`} onClick={onAddTerminal}>
                        <Plus className="size-3.5" strokeWidth={1.75} />
                      </IconButton>
                    </div>
                  }
                />
                <div className="relative min-h-0 min-w-0 flex-1">
                  {dock.pane.files.map((file) => (
                    <div
                      key={file.id}
                      aria-hidden={file.id !== dock.pane.activeFileId}
                      className={
                        file.id === dock.pane.activeFileId ? "absolute inset-0 h-full" : "hidden"
                      }
                    >
                      <TerminalView
                        id={file.id}
                        cwd={file.cwd}
                        active={
                          focused &&
                          dock.surface === "terminal" &&
                          file.id === dock.pane.activeFileId
                        }
                        onMetaChange={(patch) => onTerminalMetaChange?.(file.id, patch)}
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <NoTerminals onAddTerminal={onAddTerminal} />
            )}
          </div>
        </Surface>
        <Surface show={dock.surface === "files"} mounted={visible && opened.has("files")}>
          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            {project.searchOpen ? (
              <ProjectSearch
                cwd={project.gitCwd}
                focusToken={project.searchFocusToken}
                onOpenFile={project.onOpenFile}
                onClose={() => project.onSearchOpenChange(false)}
              />
            ) : (
              <FileTree
                cwd={project.gitCwd}
                onOpenFile={project.onOpenFile}
                onOpenTerminal={project.onOpenTerminal}
                onFileMoved={project.onFileMoved}
                onFileDeleted={project.onFileDeleted}
                onSearch={project.onSearch}
                gitStatuses={gitStatuses}
                sourceControlActive={dock.surface === "review"}
                onShowSourceControl={() => onSurfaceChange("review")}
              />
            )}
          </div>
        </Surface>
        <Surface show={dock.surface === "review"} mounted={visible && opened.has("review")}>
          <SourceControl
            cwd={project.gitCwd}
            enabled={visible && dock.open && dock.surface === "review"}
            textHarness={project.textHarness}
            selectedPath={project.selectedDiffPath}
            selectedSha={project.selectedCommitSha}
            onOpenFile={project.onOpenDiff}
            onOpenCommit={project.onOpenCommit}
          />
        </Surface>
      </div>
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          ariaLabel="Move panel"
          items={SIDE_ITEMS.map((item) => ({
            kind: "item" as const,
            id: item.id,
            label: item.label,
            checked: item.id === dock.side,
          }))}
          onPick={(id) => {
            if (id === "top" || id === "bottom" || id === "left" || id === "right") {
              onSideChange(id);
            }
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * Which surfaces have been shown at least once, so the panel can keep their
 * state without paying for a file tree and a git poll the user never asked for.
 * A dock whose project is not the one on screen has shown nothing.
 */
function useOpenedSurfaces(surface: DockSurface | null): Set<DockSurface> {
  const [opened, setOpened] = useState<Set<DockSurface>>(() => new Set(surface ? [surface] : []));
  useEffect(() => {
    if (!surface) return;
    setOpened((prev) => (prev.has(surface) ? prev : new Set(prev).add(surface)));
  }, [surface]);
  return opened;
}

function Surface({
  show,
  mounted,
  children,
}: {
  show: boolean;
  mounted: boolean;
  children: ReactNode;
}) {
  if (!mounted) return null;
  // `hidden` is the whole guard: a display:none subtree is already unreachable
  // by pointer, focus, and the accessibility tree, and adding `inert` on top
  // risks marking the surface that *is* showing.
  return <div className={show ? "absolute inset-0 h-full" : "hidden"}>{children}</div>;
}

/**
 * Plain pills rather than a boxed segmented control, matching the mode switch
 * and every other tab row in the app.
 */
function DockSurfaceSwitch({
  surface,
  onChange,
}: {
  surface: DockSurface;
  onChange: (surface: DockSurface) => void;
}) {
  const tabs = useRef(new Map<DockSurface, HTMLButtonElement | null>());

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    const index = DOCK_SURFACES.indexOf(surface);
    const next = DOCK_SURFACES[(index + step + DOCK_SURFACES.length) % DOCK_SURFACES.length];
    onChange(next);
    tabs.current.get(next)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Panel surface"
      onKeyDown={onKeyDown}
      className="flex min-w-0 shrink items-center gap-0.5 overflow-hidden"
    >
      {DOCK_SURFACES.map((value) => {
        const selected = value === surface;
        const Icon = SURFACE_ICON[value];
        return (
          <button
            key={value}
            ref={(el) => {
              tabs.current.set(value, el);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            // Roving tabindex: one stop for the row, arrows move within it.
            tabIndex={selected ? 0 : -1}
            title={DOCK_SURFACE_LABEL[value]}
            aria-label={DOCK_SURFACE_LABEL[value]}
            className={`flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              selected
                ? "bg-content/10 text-content"
                : "text-content/50 hover:bg-content/5 hover:text-content"
            }`}
            onClick={() => onChange(value)}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
            {/* Five labels need about 480px and the panel opens at 360, so a
                narrow panel names only the surface it is showing — five bare
                icons would leave the user counting positions to read the row. */}
            <span className={selected ? "" : "@max-[30rem]/dock:hidden"}>
              {DOCK_SURFACE_LABEL[value]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function NoTerminals({ onAddTerminal }: { onAddTerminal: () => void }) {
  return (
    <SurfacePlaceholder icon={Terminal} description="No terminal is running in this project.">
      <PlaceholderButton onClick={onAddTerminal}>New Terminal</PlaceholderButton>
    </SurfacePlaceholder>
  );
}

const EMPTY_IDS = new Set<string>();
const EMPTY_ERRORS = new Map<string, number>();
