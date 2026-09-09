import { useEffect, useRef } from "react";
import { RotateCcw } from "../chrome/icons";
import { PageHeader } from "../chrome/SettingsRow";
import { WindowControls } from "../chrome/WindowControls";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { IS_MAC } from "../lib/platform";
import type { SessionSummary } from "../lib/sessions/sessionStore";
import {
  settingsSectionDescription,
  settingsSectionLabel,
  type SettingsSectionId,
} from "../lib/settings";
import { ConnectionsPage } from "./ConnectionsPage";
import { AppearancePage, useAppearanceSettings } from "./settings/AppearancePage";
import { ArchivePage } from "./settings/ArchivePage";
import { GeneralPage } from "./settings/GeneralPage";
import { KeybindingsPage } from "./settings/KeybindingsPage";
import { LanguageServersPage } from "./settings/LanguageServersPage";
import { McpPage } from "./settings/McpPage";
import { ProfilesPage } from "./settings/ProfilesPage";
import { ProvidersPage } from "./settings/ProvidersPage";
import { SkillsPage } from "./settings/SkillsPage";

type Props = {
  section: SettingsSectionId;
  cwd: string;
  sessions: SessionSummary[];
  besideRail?: boolean;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string, archived: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
  onRestoreProject?: (path: string) => void;
  onDeleteProject?: (path: string) => void;
  onSwitchProfile: (profileId: string) => void;
  onOpenWhatsNew: (version: string) => void;
};

export function SettingsView({
  section,
  cwd,
  sessions,
  besideRail = false,
  onClose,
  onOpenSession,
  onArchiveSession,
  onDeleteSession,
  onRestoreProject,
  onDeleteProject,
  onSwitchProfile,
  onOpenWhatsNew,
}: Props) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const appearance = useAppearanceSettings();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div
      role="region"
      aria-label="Settings"
      data-app-settings
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-content/10"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
          <span className="shrink-0 text-content/45">Settings</span>
          <span aria-hidden className="shrink-0 text-content/25">
            /
          </span>
          <span className="min-w-0 truncate text-content">{settingsSectionLabel(section)}</span>
        </div>
        {section === "appearance" ? (
          <button
            type="button"
            data-tauri-drag-region="false"
            onClick={appearance.restoreDefaults}
            className="mr-2 flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-content/50 hover:bg-content/10 hover:text-content"
          >
            <RotateCcw className="size-3.5" strokeWidth={1.75} />
            Restore defaults
          </button>
        ) : null}
        {IS_MAC ? null : <WindowControls />}
      </div>
      {section === "skills" ? (
        <SkillsPage cwd={cwd} />
      ) : (
        <div ref={lockOverscroll} className="min-h-0 flex-1 overflow-y-auto overscroll-none">
          <div className="mx-auto w-full max-w-3xl px-8 py-8">
            <PageHeader
              title={settingsSectionLabel(section)}
              description={settingsSectionDescription(section)}
            />
            {section === "general" ? <GeneralPage onOpenWhatsNew={onOpenWhatsNew} /> : null}
            {section === "profiles" ? <ProfilesPage onSwitchProfile={onSwitchProfile} /> : null}
            {section === "appearance" ? <AppearancePage appearance={appearance} /> : null}
            {section === "keybindings" ? <KeybindingsPage /> : null}
            {section === "providers" ? <ProvidersPage /> : null}
            {section === "connections" ? <ConnectionsPage /> : null}
            {section === "language-servers" ? <LanguageServersPage /> : null}
            {section === "mcp" ? <McpPage cwd={cwd} /> : null}
            {section === "archive" ? (
              <ArchivePage
                cwd={cwd}
                sessions={sessions}
                onOpenSession={onOpenSession}
                onArchiveSession={onArchiveSession}
                onDeleteSession={onDeleteSession}
                onRestoreProject={onRestoreProject}
                onDeleteProject={onDeleteProject}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
