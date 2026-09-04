import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChatComposer, type ChatComposerHandle } from "../chrome/ChatComposer";
import { queuedFor } from "../lib/promptQueue";
import { Modal } from "../chrome/Modal";
import { ModeSwitch } from "../chrome/ModeSwitch";
import { DevModeSlot, IconButton, TabVisitNav } from "../chrome/TitleBar";
import { WorkspaceSidebarFooter } from "../chrome/WorkspaceSidebarFooter";
import { WindowControls } from "../chrome/WindowControls";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  MessageSquare,
  PanelLeft,
  PenLine,
  Pin,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Undo2,
  X,
} from "../chrome/icons";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { setGrabbing, suppressTextSelection } from "../lib/drag";
import { LAYER } from "../lib/layers";
import { IS_MAC, MOD } from "../lib/platform";
import type { InstalledUpdate } from "../lib/updates/updateNotice";
import type { AppMode } from "../lib/workspace/appMode";
import {
  createChatFolder,
  createWorkChat,
  deleteChatFolder,
  deleteWorkChat,
  dropChatOnTarget,
  getWorkChatState,
  isWorkChatQueuePaused,
  removeWorkChatQueuedPrompt,
  resumeWorkChatQueue,
  sendWorkChatQueuedPrompt,
  setWorkChatQueuedEditing,
  loadWorkChats,
  regenerateWorkChatTurn,
  renameChatFolder,
  renameWorkChat,
  resendWorkChatTurn,
  respondWorkChatApproval,
  respondWorkChatQuestion,
  selectWorkChat,
  sendWorkChatTurn,
  setChatFolderCollapsed,
  setChatFolderPrompt,
  setWorkChatArchived,
  setWorkChatModel,
  setWorkChatModelSettings,
  setWorkChatPinned,
  stopWorkChat,
  subscribeWorkChats,
  updateWorkChatQueuedPrompt,
} from "../lib/sessions/workChatStore";
import {
  buildWorkChatList,
  flattenWorkChatList,
  type WorkChatDropTarget,
  type WorkChatFolder,
} from "../lib/sessions/workChatFolders";
import {
  WORK_CHAT_COMMAND_EVENT,
  filterWorkChats,
  beginWorkChatCommands,
  endWorkChatCommands,
  requestWorkChatCommand,
  visibleWorkChats,
  workChatListItems,
  type WorkChatCommand,
  type WorkChatListItem,
} from "../lib/sessions/workChats";
import { AgentTranscript } from "./AgentTranscript";

type Props = {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  onOpenSettings?: () => void;
  profileMenuOpen?: boolean;
  onProfileMenuOpenChange?: (open: boolean) => void;
  onSwitchProfile?: (profileId: string) => void;
  onManageProfiles?: () => void;
  updateNotice?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
};

/**
 * The Work surface: a chat list and a single-thread transcript, with no
 * project, cwd, worktree, file, or source-control affordances. The whole
 * window belongs to it, so it carries its own top chrome.
 */
export function WorkView({
  mode,
  onModeChange,
  onOpenSettings,
  profileMenuOpen,
  onProfileMenuOpenChange,
  onSwitchProfile,
  onManageProfiles,
  updateNotice,
  onOpenWhatsNew,
  onDismissUpdate,
}: Props) {
  const state = useSyncExternalStore(subscribeWorkChats, getWorkChatState);
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [promptFolderId, setPromptFolderId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<WorkChatDropTarget | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const composer = useRef<ChatComposerHandle>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const listLock = useLockOverscroll<HTMLDivElement>();

  useEffect(() => {
    void loadWorkChats();
  }, []);

  const items = useMemo(
    () => workChatListItems(state.summaries, state.chats),
    [state.chats, state.summaries],
  );
  const searching = query.trim().length > 0;
  const entries = useMemo(() => {
    const listed = visibleWorkChats(items, showArchived);
    // An empty project still paints so it can be filled by drag — except in a
    // search, where nothing inside it matched and it is not a drop target. A
    // project being named is the exception to the exception: hiding it would
    // unmount the rename field the user is typing into.
    return buildWorkChatList(state.folders, filterWorkChats(listed, query), {
      hideEmptyFolders: searching && renamingFolderId == null,
    });
  }, [items, query, renamingFolderId, searching, showArchived, state.folders]);
  const order = useMemo(() => flattenWorkChatList(entries), [entries]);
  const archivedCount = useMemo(() => items.filter((item) => item.archived).length, [items]);
  // Read the subscribed snapshot, never the store's module state: rendering
  // from the global would paint values React was not told changed, and a
  // per-row lookup would repeat for every streamed token.
  const byId = useMemo(() => new Map(state.chats.map((chat) => [chat.id, chat])), [state.chats]);
  const active = state.activeId ? (byId.get(state.activeId) ?? null) : null;
  const promptFolder = promptFolderId
    ? (state.folders.find((folder) => folder.id === promptFolderId) ?? null)
    : null;

  const onNewChat = useCallback((folderId?: string) => {
    void createWorkChat(undefined, undefined, folderId).then(() => composer.current?.focus());
  }, []);

  const onNewFolder = useCallback(() => {
    setRenamingFolderId(createChatFolder());
  }, []);

  const onDrop = useCallback((draggedId: string, target: WorkChatDropTarget) => {
    const createdId = dropChatOnTarget(draggedId, target);
    if (createdId) setRenamingFolderId(createdId);
  }, []);

  const step = useCallback(
    (delta: 1 | -1) => {
      if (order.length === 0) return;
      const index = order.indexOf(state.activeId ?? "");
      const next = order[(index + delta + order.length) % order.length];
      if (next) void selectWorkChat(next);
    },
    [order, state.activeId],
  );

  const runCommand = useCallback(
    (command: WorkChatCommand) => {
      if (command === "new") onNewChat();
      else if (command === "next") step(1);
      else if (command === "previous") step(-1);
      else {
        searchField.current?.focus();
        searchField.current?.select();
      }
    },
    [onNewChat, step],
  );

  useEffect(() => {
    const onCommand = (event: Event) => {
      runCommand((event as CustomEvent<WorkChatCommand>).detail);
    };
    window.addEventListener(WORK_CHAT_COMMAND_EVENT, onCommand);
    const pending = beginWorkChatCommands();
    if (pending) runCommand(pending);
    return () => {
      window.removeEventListener(WORK_CHAT_COMMAND_EVENT, onCommand);
      endWorkChatCommands();
    };
  }, [runCommand]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey) return;
      const key = event.key.toLowerCase();
      const command: WorkChatCommand | null = event.shiftKey
        ? event.key === "]" || event.key === "}"
          ? "next"
          : event.key === "[" || event.key === "{"
            ? "previous"
            : null
        : key === "t" || key === "n"
          ? "new"
          : key === "f"
            ? "find"
            : null;

      if (command) {
        event.preventDefault();
        event.stopPropagation();
        // Through the shared dispatcher, so a keystroke the macOS menu also
        // reports does not run the command twice.
        requestWorkChatCommand(command);
        return;
      }
      if (!event.shiftKey && key === "l") {
        event.preventDefault();
        event.stopPropagation();
        composer.current?.focus();
      }
    };
    // Capture, so the coding-mode workspace bindings behind this surface never
    // see a key meant for the chat list.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const renderChat = (item: WorkChatListItem) => (
    <ChatRow
      key={item.id}
      item={item}
      active={item.id === state.activeId}
      renaming={renamingId === item.id}
      busy={byId.get(item.id)?.busy === true}
      dropTarget={dropTarget?.kind === "chat" && dropTarget.id === item.id}
      onSelect={() => void selectWorkChat(item.id)}
      onDrag={onDrop}
      onDragTargetChange={setDropTarget}
      onRenameStart={() => setRenamingId(item.id)}
      onRenameCancel={() => setRenamingId(null)}
      onRenameCommit={(title) => {
        setRenamingId(null);
        void renameWorkChat(item.id, title);
      }}
      onPin={() => void setWorkChatPinned(item.id, !item.pinned)}
      onArchive={() => void setWorkChatArchived(item.id, !item.archived)}
      onDelete={() => void deleteWorkChat(item.id)}
    />
  );

  return (
    <div
      role="region"
      aria-label="Work"
      data-app-work
      className="flex h-full min-h-0 min-w-0 flex-1 text-content"
    >
      {/* Work replaces the project rail rather than sitting beside it, so this
          column owns the traffic lights and carries the mode switch itself.
          `sidebar-glass` is what makes it opaque — without it the window's
          macOS vibrancy shows whatever is behind wavex.
          The header repeats the rail's row exactly so switching modes does not
          move the traffic lights, the dev badge, or the nav icons. */}
      <aside
        className={`sidebar-glass ${
          listOpen ? "flex w-64" : "flex w-auto"
        } shrink-0 flex-col border-r border-content/10`}
      >
        <div
          className="flex h-10 shrink-0 select-none items-center pr-1.5"
          data-tauri-drag-region="deep"
        >
          {IS_MAC ? <div className="w-[78px] shrink-0" /> : null}
          <DevModeSlot />
          {/* Work has no tab-visit history, so back and forward stay disabled;
              they are here to keep the row identical across a mode switch. */}
          <TabVisitNav
            onTogglePanel={() => setListOpen((open) => !open)}
            panelActive={listOpen}
            panelLabel="Toggle Chats"
          />
        </div>

        {listOpen ? (
          <div className="flex shrink-0 flex-col gap-px px-2 pb-2 pt-0.5">
            <div className="pb-1.5">
              <ModeSwitch mode={mode} onChange={onModeChange} stretch />
            </div>

            <div className="flex items-center gap-1">
              <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-content/10 bg-content/5 px-2">
                <Search className="size-3.5 shrink-0 text-content/40" strokeWidth={1.75} />
                <input
                  ref={searchField}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search chats (${MOD}F)`}
                  aria-label="Search chats"
                  className="h-full min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-content/35"
                />
                {query ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                    className="shrink-0 text-content/40 hover:text-content"
                  >
                    <X className="size-3" strokeWidth={2} />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                title="New project"
                aria-label="New project"
                onClick={onNewFolder}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-content/10 text-content/60 hover:bg-content/10 hover:text-content"
              >
                <FolderPlus className="size-3.5" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                title={`New chat (${MOD}T)`}
                aria-label="New chat"
                onClick={() => onNewChat()}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-content/10 text-content/60 hover:bg-content/10 hover:text-content"
              >
                <Plus className="size-3.5" strokeWidth={1.75} />
              </button>
            </div>
          </div>
        ) : null}

        <div
          ref={listLock}
          data-work-chat-root
          className={`min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-none px-2 pb-2 ${
            listOpen ? "flex" : "hidden"
          }`}
        >
          {state.loading && items.length === 0 ? (
            <p className="px-1 py-2 text-[12px] text-content/45">Loading…</p>
          ) : null}
          {state.error ? (
            <p className="px-1 py-2 text-[12px] text-red-400/90">{state.error}</p>
          ) : null}
          {!state.loading && entries.length === 0 ? (
            <p className="px-1 py-2 text-[12px] text-content/45">
              {query ? "No chats match." : "No chats yet."}
            </p>
          ) : null}
          {entries.map((entry) =>
            entry.kind === "chat" ? (
              renderChat(entry.chat)
            ) : (
              <FolderSection
                key={entry.folder.id}
                folder={entry.folder}
                count={entry.chats.length}
                renaming={renamingFolderId === entry.folder.id}
                dropTarget={dropTarget?.kind === "folder" && dropTarget.id === entry.folder.id}
                onToggle={() => setChatFolderCollapsed(entry.folder.id, !entry.folder.collapsed)}
                onRenameStart={() => setRenamingFolderId(entry.folder.id)}
                onRenameCancel={() => setRenamingFolderId(null)}
                onRenameCommit={(name) => {
                  setRenamingFolderId(null);
                  renameChatFolder(entry.folder.id, name);
                }}
                onEditPrompt={() => setPromptFolderId(entry.folder.id)}
                onNewChat={() => onNewChat(entry.folder.id)}
                onDelete={() => deleteChatFolder(entry.folder.id)}
              >
                {entry.folder.collapsed ? null : entry.chats.length === 0 ? (
                  <p className="px-2 py-1.5 text-[11.5px] text-content/35">Drag chats here.</p>
                ) : (
                  entry.chats.map(renderChat)
                )}
              </FolderSection>
            ),
          )}
          {archivedCount > 0 ? (
            <button
              type="button"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((on) => !on)}
              className="mt-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11.5px] text-content/45 hover:bg-content/5 hover:text-content/80"
            >
              <Archive className="size-3 shrink-0" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate">
                {showArchived ? "Hide archived" : `Archived (${archivedCount})`}
              </span>
            </button>
          ) : null}
        </div>

        {listOpen ? (
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
        ) : null}
      </aside>

      <section className="body-glass flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          className="flex h-10 shrink-0 select-none items-center gap-2 px-3"
          data-tauri-drag-region="deep"
        >
          {listOpen ? null : (
            <>
              <IconButton label="Toggle Chats" onClick={() => setListOpen(true)}>
                <PanelLeft className="size-3.5" strokeWidth={1.75} />
              </IconButton>
              <ModeSwitch mode={mode} onChange={onModeChange} />
            </>
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] text-content/70">
            {active ? active.title : "Work"}
          </span>
          {IS_MAC ? null : <WindowControls />}
        </div>

        {active ? (
          <>
            <AgentTranscript
              blocks={active.blocks}
              busy={active.busy}
              harness={active.harness}
              pendingQuestion={Boolean(active.pendingQuestion)}
              onApproval={(requestId, decision) =>
                respondWorkChatApproval(active.id, requestId, decision)
              }
              onEditTurn={(blockId, text) => void resendWorkChatTurn(active.id, blockId, text)}
              onRegenerateTurn={(blockId) => void regenerateWorkChatTurn(active.id, blockId)}
            />
            <ChatComposer
              chatId={active.id}
              handleRef={composer}
              harness={active.harness}
              model={active.model}
              modelSettings={active.modelSettings}
              busy={active.busy}
              question={active.pendingQuestion}
              onQuestionReply={(requestId, reply) =>
                respondWorkChatQuestion(active.id, requestId, reply)
              }
              onModelChange={(harness, model) => setWorkChatModel(active.id, harness, model)}
              onModelSettingsChange={(settings) => setWorkChatModelSettings(active.id, settings)}
              onSubmit={(text, attachments, options) =>
                void sendWorkChatTurn(active.id, text, attachments, options)
              }
              queued={queuedFor(state.queues, active.id)}
              queuePaused={isWorkChatQueuePaused(active.id)}
              onRemoveQueued={(promptId) => removeWorkChatQueuedPrompt(active.id, promptId)}
              onEditQueued={(promptId, text) =>
                updateWorkChatQueuedPrompt(active.id, promptId, text)
              }
              onQueuedEditingChange={(promptId) => setWorkChatQueuedEditing(active.id, promptId)}
              onSendQueued={(promptId) => sendWorkChatQueuedPrompt(active.id, promptId)}
              onResumeQueue={() => resumeWorkChatQueue(active.id)}
              onStop={() => void stopWorkChat(active.id)}
            />
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <MessageSquare className="size-6 text-content/25" strokeWidth={1.5} />
            <p className="text-[13px] text-content/50">
              Thinking, drafting, questions — work that is not code.
            </p>
            <button
              type="button"
              onClick={() => onNewChat()}
              className="rounded-md bg-content px-3 py-1.5 text-[12px] text-background-base hover:bg-content/80"
            >
              New chat
            </button>
          </div>
        )}
      </section>

      {promptFolder ? (
        <FolderPromptDialog
          folder={promptFolder}
          onClose={() => setPromptFolderId(null)}
          onSave={(prompt) => {
            setChatFolderPrompt(promptFolder.id, prompt);
            setPromptFolderId(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Which project or chat the pointer is over, resolved from the DOM rather than
 * from React state — the list re-renders while a drag is in flight, so a
 * captured element reference would go stale.
 */
function workChatDropFromPoint(x: number, y: number, draggedId: string): WorkChatDropTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const chat = el.closest("[data-work-chat]") as HTMLElement | null;
  const chatId = chat?.dataset.workChat;
  if (chatId === draggedId) return null;
  const folder = el.closest("[data-work-folder]") as HTMLElement | null;
  const folderId = folder?.dataset.workFolder;
  if (folderId && chatId && chat && folder.contains(chat)) {
    return { kind: "folder", id: folderId };
  }
  if (chatId) return { kind: "chat", id: chatId };
  if (folderId) return { kind: "folder", id: folderId };
  // Bare list background: dropping there takes the chat out of its project.
  if (el.closest("[data-work-chat-root]")) return { kind: "root" };
  return null;
}

function dropKey(target: WorkChatDropTarget | null): string {
  if (target == null) return "";
  return target.kind === "root" ? "root" : `${target.kind}:${target.id}`;
}

function FolderSection({
  folder,
  count,
  renaming,
  dropTarget,
  onToggle,
  onRenameStart,
  onRenameCancel,
  onRenameCommit,
  onEditPrompt,
  onNewChat,
  onDelete,
  children,
}: {
  folder: WorkChatFolder;
  count: number;
  renaming: boolean;
  dropTarget: boolean;
  onToggle: () => void;
  onRenameStart: () => void;
  onRenameCancel: () => void;
  onRenameCommit: (name: string) => void;
  onEditPrompt: () => void;
  onNewChat: () => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  return (
    <div data-work-folder={folder.id} className="flex flex-col">
      {renaming ? (
        <RenameField
          value={folder.name}
          label="Project name"
          onCancel={onRenameCancel}
          onCommit={onRenameCommit}
        />
      ) : (
        <div
          className={`group relative flex items-center gap-1 rounded-md pr-1 ${
            dropTarget ? "bg-accent/20 text-content" : "text-content/80 hover:bg-content/5"
          }`}
        >
          <button
            type="button"
            title={folder.prompt ? `${folder.name} — has a brief` : folder.name}
            aria-expanded={!folder.collapsed}
            onClick={onToggle}
            onDoubleClick={onRenameStart}
            onKeyDown={(event) => {
              if (event.key !== "F2") return;
              event.preventDefault();
              onRenameStart();
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1.5 text-left"
          >
            <span className="grid size-3.5 shrink-0 place-items-center text-content/55">
              {folder.collapsed ? (
                <ChevronRight className="size-3.5" strokeWidth={1.75} />
              ) : (
                <ChevronDown className="size-3.5" strokeWidth={1.75} />
              )}
            </span>
            <Folder className="size-3.5 shrink-0 text-content/55" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{folder.name}</span>
            {folder.prompt ? (
              <StickyNote className="size-3 shrink-0 text-content/40" strokeWidth={1.75} />
            ) : null}
            <span className="shrink-0 text-[11px] tabular-nums text-content/40">{count}</span>
          </button>
          <button
            type="button"
            aria-label={`Edit brief for ${folder.name}`}
            title="Project brief"
            onClick={onEditPrompt}
            className="hidden shrink-0 rounded p-1 text-content/45 hover:text-content group-hover:block"
          >
            <StickyNote className="size-3" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label={`New chat in ${folder.name}`}
            onClick={onNewChat}
            className="hidden shrink-0 rounded p-1 text-content/45 hover:text-content group-hover:block"
          >
            <Plus className="size-3" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label={`Delete project ${folder.name}`}
            title="Delete project — its chats are kept"
            onClick={onDelete}
            className="hidden shrink-0 rounded p-1 text-content/45 hover:text-red-400 group-hover:block"
          >
            <Trash2 className="size-3" strokeWidth={1.75} />
          </button>
        </div>
      )}
      <div className="flex flex-col gap-0.5 pl-3">{children}</div>
    </div>
  );
}

function FolderPromptDialog({
  folder,
  onClose,
  onSave,
}: {
  folder: WorkChatFolder;
  onClose: () => void;
  onSave: (prompt: string) => void;
}) {
  const [draft, setDraft] = useState(folder.prompt);

  return (
    <Modal title="Project brief" description={folder.name} size="md" onClose={onClose}>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
        <p className="text-[12px] leading-snug text-content/55">
          Sent ahead of every message from a chat in this project, so each agent knows what it is
          working on.
        </p>
        <textarea
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to edit this field
          autoFocus
          value={draft}
          aria-label="Project brief"
          placeholder="We are redesigning the onboarding flow. Prefer short answers and cite files."
          onChange={(event) => setDraft(event.target.value)}
          className="h-48 w-full resize-none rounded-lg border border-content/10 bg-content/5 px-3 py-2 text-[12.5px] leading-relaxed outline-none focus-visible:border-content/25"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/5 hover:text-content"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            className="rounded-md bg-content px-3 py-1.5 text-[12px] text-background-base hover:bg-content/80"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RenameField({
  value,
  label,
  onCancel,
  onCommit,
}: {
  value: string;
  label: string;
  onCancel: () => void;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <input
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- rename is an explicit user action
      autoFocus
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(draft);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => onCommit(draft)}
      className="w-full rounded-md border border-content/20 bg-content/5 px-2 py-1.5 text-[12.5px] outline-none"
    />
  );
}

function ChatRow({
  item,
  active,
  busy,
  renaming,
  dropTarget,
  onSelect,
  onDrag,
  onDragTargetChange,
  onRenameStart,
  onRenameCancel,
  onRenameCommit,
  onPin,
  onArchive,
  onDelete,
}: {
  item: WorkChatListItem;
  active: boolean;
  busy: boolean;
  renaming: boolean;
  dropTarget: boolean;
  onSelect: () => void;
  onDrag: (draggedId: string, target: WorkChatDropTarget) => void;
  onDragTargetChange: (target: WorkChatDropTarget | null) => void;
  onRenameStart: () => void;
  onRenameCancel: () => void;
  onRenameCommit: (title: string) => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { id, title, pinned, archived } = item;
  const skipClickUntil = useRef(0);
  const row = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  /** Where inside the row the pointer grabbed it, and how wide the row was. */
  const grab = useRef({ x: 0, y: 0, width: 0 });
  /** Latest pointer position, so a re-render mid-drag repaints in place. */
  const point = useRef({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  // The preview is moved by writing `transform` straight onto the node. Going
  // through state would re-render the row — and the list around it — on every
  // pointer sample, for decoration that never changes anything else.
  const placeGhost = () => {
    const node = ghost.current;
    if (!node) return;
    node.style.transform = ghostTransform(point.current, grab.current);
  };

  // Pointer-driven rather than HTML5 drag: the composer on this surface binds
  // `drop` for file attachments, and a native drag would cross into it.
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let activeDrag = false;
    let last: WorkChatDropTarget | null = null;
    const rect = row.current?.getBoundingClientRect();
    grab.current = {
      x: rect ? startX - rect.left : 0,
      y: rect ? startY - rect.top : 0,
      width: rect?.width ?? 0,
    };
    point.current = { x: startX, y: startY };
    handle.setPointerCapture(pointerId);
    const restoreSelection = suppressTextSelection();

    const setTarget = (next: WorkChatDropTarget | null) => {
      if (dropKey(next) === dropKey(last)) return;
      last = next;
      onDragTargetChange(next);
    };

    const onMove = (moved: PointerEvent) => {
      point.current = { x: moved.clientX, y: moved.clientY };
      if (!activeDrag) {
        if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < 5) return;
        activeDrag = true;
        setGrabbing(true);
        setDragging(true);
      }
      placeGhost();
      setTarget(workChatDropFromPoint(moved.clientX, moved.clientY, id));
    };

    const onUp = () => finish(true);
    const onKey = (pressed: KeyboardEvent) => {
      if (pressed.key !== "Escape") return;
      pressed.preventDefault();
      finish(false);
    };

    function finish(commit: boolean) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
      restoreSelection();
      setGrabbing(false);
      setDragging(false);
      onDragTargetChange(null);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      const target = last;
      last = null;
      if (!activeDrag) return;
      // The pointer travelled, so the click that follows is the tail of a drag
      // and must not also open the chat.
      skipClickUntil.current = performance.now() + 400;
      if (commit && target) onDrag(id, target);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
  };

  if (renaming) {
    return (
      <RenameField
        value={title}
        label="Chat title"
        onCancel={onRenameCancel}
        onCommit={onRenameCommit}
      />
    );
  }

  return (
    <>
      {dragging
        ? createPortal(
            <div
              ref={ghost}
              aria-hidden
              style={{
                width: grab.current.width || undefined,
                transform: ghostTransform(point.current, grab.current),
                zIndex: LAYER.drag,
              }}
              className="pointer-events-none fixed left-0 top-0 flex items-center gap-1.5 rounded-md border border-content/15 bg-background-base/90 px-2 py-1.5 text-[12.5px] text-content shadow-lg backdrop-blur-sm"
            >
              {pinned ? (
                <Pin className="size-3 shrink-0 text-content/45" strokeWidth={1.75} />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{title}</span>
            </div>,
            document.body,
          )
        : null}
      <div
        ref={row}
        data-work-chat={id}
        className={`group flex items-center gap-1 rounded-md pr-1 ${
          dropTarget
            ? "bg-accent/20 text-content"
            : active
              ? "bg-content/10 text-content"
              : "text-content/75 hover:bg-content/5"
        } ${dragging ? "opacity-40" : ""} ${archived ? "opacity-60" : ""}`}
      >
        <button
          type="button"
          title={title}
          aria-current={active ? "true" : undefined}
          onPointerDown={onPointerDown}
          onClick={() => {
            if (performance.now() < skipClickUntil.current) return;
            onSelect();
          }}
          onDoubleClick={onRenameStart}
          className="flex min-w-0 flex-1 touch-none items-center gap-1.5 px-2 py-1.5 text-left text-[12.5px]"
        >
          {pinned ? <Pin className="size-3 shrink-0 text-content/45" strokeWidth={1.75} /> : null}
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </button>
        {busy ? (
          <span
            aria-label="Running"
            className="size-1.5 shrink-0 rounded-full bg-accent"
            title="Running"
          />
        ) : null}
        <button
          type="button"
          aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
          aria-pressed={pinned}
          onClick={onPin}
          className={`shrink-0 rounded p-1 text-content/45 hover:text-content group-hover:block ${
            pinned ? "block" : "hidden"
          }`}
        >
          <Pin className="size-3" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label={archived ? `Unarchive ${title}` : `Archive ${title}`}
          onClick={onArchive}
          className="hidden shrink-0 rounded p-1 text-content/45 hover:text-content group-hover:block"
        >
          {archived ? (
            <Undo2 className="size-3" strokeWidth={1.75} />
          ) : (
            <Archive className="size-3" strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          aria-label={`Rename ${title}`}
          onClick={onRenameStart}
          className="hidden shrink-0 rounded p-1 text-content/45 hover:text-content group-hover:block"
        >
          <PenLine className="size-3" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label={`Delete ${title}`}
          onClick={onDelete}
          className="hidden shrink-0 rounded p-1 text-content/45 hover:text-red-400 group-hover:block"
        >
          <Trash2 className="size-3" strokeWidth={1.75} />
        </button>
      </div>
    </>
  );
}

/** Keeps the preview under the exact spot on the row the pointer grabbed. */
function ghostTransform(point: { x: number; y: number }, grab: { x: number; y: number }): string {
  return `translate3d(${point.x - grab.x}px, ${point.y - grab.y}px, 0)`;
}
