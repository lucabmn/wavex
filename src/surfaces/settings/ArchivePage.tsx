import { useEffect, useMemo, useState } from "react";
import { HarnessIcon } from "../../chrome/HarnessIcon";
import { RemoveProjectDialog } from "../../chrome/RemoveProjectDialog";
import { EmptyNote, Row, SecondaryButton, Section } from "../../chrome/SettingsRow";
import { prettyCwd, projectName } from "../../lib/paths";
import {
  loadArchivedProjects,
  looksLikeProject,
  subscribeArchivedProjects,
  type ArchivedProject,
} from "../../lib/recents";
import { sessionDisplayTitle } from "../../lib/session";
import {
  loadSessionSidebarFilters,
  saveSessionSidebarFilters,
} from "../../lib/sessions/sessionFilters";
import type { SessionSummary } from "../../lib/sessions/sessionStore";
import { loadTabGroupLabels, resolveTabGroupLabel } from "../../lib/workspace/tabGroups";
import { Toggle } from "../../chrome/SettingsRow";

function useArchivedProjects(): ArchivedProject[] {
  const [items, setItems] = useState(loadArchivedProjects);
  useEffect(() => subscribeArchivedProjects(() => setItems(loadArchivedProjects())), []);
  return items;
}

function archivedProjectLabel(path: string): string {
  return resolveTabGroupLabel(projectName(path), loadTabGroupLabels(), projectName(path));
}

export function ArchivePage({
  cwd,
  sessions,
  onOpenSession,
  onArchiveSession,
  onDeleteSession,
  onRestoreProject,
  onDeleteProject,
}: {
  cwd: string;
  sessions: SessionSummary[];
  onOpenSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string, archived: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
  onRestoreProject?: (path: string) => void;
  onDeleteProject?: (path: string) => void;
}) {
  const [filters, setFilters] = useState(loadSessionSidebarFilters);
  const [deleting, setDeleting] = useState<ArchivedProject | null>(null);
  const archivedProjects = useArchivedProjects();
  const archived = useMemo(
    () => sessions.filter((session) => session.archived).sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );

  const onShowArchived = (showArchived: boolean) => {
    const next = { ...filters, showArchived };
    saveSessionSidebarFilters(next);
    setFilters(next);
  };

  return (
    <>
      <Section title="Archived projects">
        {archivedProjects.length === 0 ? (
          <EmptyNote>
            Archive a project from the rail to keep its chats without listing it in the sidebar.
          </EmptyNote>
        ) : (
          archivedProjects.map((project) => (
            <div
              key={project.path}
              className="flex items-center gap-3 border-b border-edge px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px]">{archivedProjectLabel(project.path)}</div>
                <div className="truncate text-[11.5px] text-content/40">
                  {prettyCwd(project.path)}
                </div>
              </div>
              {onRestoreProject ? (
                <SecondaryButton onClick={() => onRestoreProject(project.path)}>
                  Restore
                </SecondaryButton>
              ) : null}
              {onDeleteProject ? (
                <SecondaryButton danger onClick={() => setDeleting(project)}>
                  Delete
                </SecondaryButton>
              ) : null}
            </div>
          ))
        )}
      </Section>

      <Section
        title={looksLikeProject(cwd) ? `Archived in ${projectName(cwd)}` : "Archived conversations"}
      >
        {!looksLikeProject(cwd) ? (
          <EmptyNote>Open a project to see its archived conversations.</EmptyNote>
        ) : archived.length === 0 ? (
          <EmptyNote>No archived conversations in this project.</EmptyNote>
        ) : (
          archived.map((session) => (
            <div
              key={session.id}
              className="flex items-center gap-3 border-b border-edge px-4 py-2.5 last:border-b-0"
            >
              <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
              <button
                type="button"
                onClick={() => onOpenSession(session.id)}
                className="min-w-0 flex-1 truncate text-left text-[13.5px] hover:text-content"
              >
                {sessionDisplayTitle(session.title, session.harness)}
              </button>
              <span className="shrink-0 text-[11.5px] text-content/35 tabular-nums">
                {formatDate(session.updatedAt)}
              </span>
              <SecondaryButton onClick={() => onArchiveSession(session.id, false)}>
                Unarchive
              </SecondaryButton>
              <SecondaryButton danger onClick={() => onDeleteSession(session.id)}>
                Delete
              </SecondaryButton>
            </div>
          ))
        )}
      </Section>

      <Section title="Sidebar">
        <Row
          label="Show archived in the sidebar"
          description="Keep archived conversations listed alongside the active ones."
        >
          <Toggle
            label="Show archived in the sidebar"
            on={filters.showArchived}
            onChange={onShowArchived}
          />
        </Row>
      </Section>

      {deleting ? (
        <RemoveProjectDialog
          name={archivedProjectLabel(deleting.path)}
          path={deleting.path}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDeleteProject?.(deleting.path);
            setDeleting(null);
          }}
        />
      ) : null}
    </>
  );
}

function formatDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}
