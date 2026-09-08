import { useEffect, useState } from "react";
import { ArrowDownCircle, Loader, RefreshCw } from "../../chrome/icons";
import { Row, SecondaryButton, Section, Segmented, Toggle } from "../../chrome/SettingsRow";
import {
  loadClaudeHooks,
  loadDiffViewer,
  loadFollowUpBehavior,
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  saveClaudeHooks,
  saveDiffViewer,
  saveFollowUpBehavior,
  saveLiveAgentsEnabled,
  saveNotesEnabled,
  type DiffViewer,
  type FollowUpBehavior,
} from "../../lib/settings";
import { loadSoundsEnabled, saveSoundsEnabled } from "../../lib/sounds";
import {
  installPendingUpdate,
  readAppVersion,
  runUpdateFlow,
  UPDATES_SUPPORTED,
  type UpdaterSnapshot,
} from "../../lib/updates/updater";

export function GeneralPage({ onOpenWhatsNew }: { onOpenWhatsNew: (version: string) => void }) {
  const [diffViewer, setDiffViewer] = useState<DiffViewer>(loadDiffViewer);
  const [followUpBehavior, setFollowUpBehavior] = useState<FollowUpBehavior>(loadFollowUpBehavior);
  const [notesEnabled, setNotesEnabled] = useState(loadNotesEnabled);
  const [liveAgentsEnabled, setLiveAgentsEnabled] = useState(loadLiveAgentsEnabled);
  const [soundsEnabled, setSoundsEnabled] = useState(loadSoundsEnabled);
  const [claudeHooks, setClaudeHooks] = useState(loadClaudeHooks);

  const onDiffViewer = (next: DiffViewer) => {
    saveDiffViewer(next);
    setDiffViewer(next);
  };

  const onFollowUpBehavior = (next: FollowUpBehavior) => {
    saveFollowUpBehavior(next);
    setFollowUpBehavior(next);
  };

  const onNotesEnabled = (next: boolean) => {
    saveNotesEnabled(next);
    setNotesEnabled(next);
  };

  const onLiveAgentsEnabled = (next: boolean) => {
    saveLiveAgentsEnabled(next);
    setLiveAgentsEnabled(next);
  };

  const onSoundsEnabled = (next: boolean) => {
    saveSoundsEnabled(next);
    setSoundsEnabled(next);
  };

  const onClaudeHooks = (next: boolean) => {
    saveClaudeHooks(next);
    setClaudeHooks(next);
  };

  return (
    <>
      <Section title="Conversations" description="How a turn behaves while it is running.">
        <Row
          label="Follow-up behavior"
          description="Queue follow-ups until the active turn finishes, or steer the active turn immediately."
        >
          <Segmented
            label="Follow-up behavior"
            value={followUpBehavior}
            options={[
              { value: "queue", label: "Queue" },
              { value: "steer", label: "Steer" },
            ]}
            onChange={onFollowUpBehavior}
          />
        </Row>
        <Row
          label="Diff view"
          description="Editor keeps working-tree changes in the file. Unified stacks every changed file in one review, with sticky headers and collapsed unchanged lines."
        >
          <Segmented
            label="Diff view"
            value={diffViewer}
            options={[
              { value: "editor", label: "Editor" },
              { value: "unified", label: "Unified" },
            ]}
            onChange={onDiffViewer}
          />
        </Row>
        <Row
          label="Claude Code hooks"
          description="Run the hooks configured in your settings.json files — PreToolUse command rewrites, blocks, notifications, and the rest — just as the Claude Code CLI would. Turn this off if a hook is misbehaving and you need the session back. Takes effect on the next turn."
        >
          <Toggle label="Claude Code hooks" on={claudeHooks} onChange={onClaudeHooks} />
        </Row>
      </Section>

      <Section title="Workspace" description="Which parts of the app are on the rail at all.">
        <Row
          label="Notes"
          description="A global markdown notebook on the project rail. Save a finished turn from the transcript, then mention it later with @note or add it to chat. Turn this off to hide Notes from the UI."
        >
          <Toggle label="Notes" on={notesEnabled} onChange={onNotesEnabled} />
        </Row>
        <Row
          label="Working agents"
          description="When two or more chats are in flight, a card on the project rail lists them so you can jump across projects. Finished turns stay until you open that session. Turn this off to hide the card."
        >
          <Toggle label="Working agents" on={liveAgentsEnabled} onChange={onLiveAgentsEnabled} />
        </Row>
        <Row
          label="Sounds"
          description="Short cues when a turn finishes, a new inbox item appears on the project rail, or an update is available. Switches and Copy on a finished turn also play."
        >
          <Toggle label="Sounds" on={soundsEnabled} onChange={onSoundsEnabled} />
        </Row>
      </Section>

      <Section title="About">
        <UpdateRow onOpenWhatsNew={onOpenWhatsNew} />
      </Section>
    </>
  );
}

function UpdateRow({ onOpenWhatsNew }: { onOpenWhatsNew: (version: string) => void }) {
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot>({
    phase: "idle",
    currentVersion: "…",
  });

  useEffect(() => {
    let cancelled = false;
    void readAppVersion().then((currentVersion) => {
      if (cancelled) return;
      setSnapshot((current) => ({ ...current, currentVersion }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const busy = snapshot.phase === "checking" || snapshot.phase === "downloading";
  const hasUpdate = snapshot.phase === "available";

  const onClick = async () => {
    if (busy) return;
    if (hasUpdate) {
      await installPendingUpdate(setSnapshot);
      return;
    }
    await runUpdateFlow(true, setSnapshot);
  };

  const status =
    snapshot.phase === "available"
      ? `Version ${snapshot.availableVersion} is available.`
      : snapshot.phase === "downloading"
        ? `Downloading${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`
        : snapshot.phase === "checking"
          ? "Checking for updates…"
          : snapshot.phase === "current"
            ? "You're on the latest version."
            : snapshot.phase === "error"
              ? (snapshot.error ?? "Update check failed.")
              : UPDATES_SUPPORTED
                ? "wavex updates itself from the release feed."
                : "This host updates itself; a browser client follows whatever it runs.";

  return (
    <Row
      label={
        <span className="flex items-baseline gap-2">
          Version
          <span className="font-mono text-[12.5px] text-content/45">{snapshot.currentVersion}</span>
        </span>
      }
      description={status}
    >
      <div className="flex items-center gap-2">
        <SecondaryButton
          onClick={() => onOpenWhatsNew(snapshot.currentVersion)}
          disabled={snapshot.currentVersion === "…"}
        >
          What's new
        </SecondaryButton>
        {UPDATES_SUPPORTED ? (
          <SecondaryButton onClick={() => void onClick()} disabled={busy}>
            {busy ? (
              <Loader className="size-3.5 animate-spin" aria-hidden />
            ) : hasUpdate ? (
              <ArrowDownCircle className="size-3.5 text-accent" aria-hidden />
            ) : (
              <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
            )}
            {hasUpdate ? "Download" : "Check for updates"}
          </SecondaryButton>
        ) : null}
      </div>
    </Row>
  );
}
