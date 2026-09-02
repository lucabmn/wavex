import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChatComposer, type ChatComposerHandle } from "../chrome/ChatComposer";
import { ModeSwitch } from "../chrome/ModeSwitch";
import { WindowControls } from "../chrome/WindowControls";
import { MessageSquare, PenLine, Plus, Search, Trash2, X } from "../chrome/icons";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { IS_MAC, MOD } from "../lib/platform";
import type { AppMode } from "../lib/workspace/appMode";
import {
  createWorkChat,
  deleteWorkChat,
  findWorkChat,
  getWorkChatState,
  loadWorkChats,
  regenerateWorkChatTurn,
  renameWorkChat,
  resendWorkChatTurn,
  respondWorkChatApproval,
  respondWorkChatQuestion,
  selectWorkChat,
  sendWorkChatTurn,
  setWorkChatModel,
  setWorkChatModelSettings,
  stopWorkChat,
  subscribeWorkChats,
} from "../lib/sessions/workChatStore";
import { filterWorkChats, workChatListItems } from "../lib/sessions/workChats";
import { AgentTranscript } from "./AgentTranscript";

type Props = {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
};

/**
 * The Work surface: a chat list and a single-thread transcript, with no
 * project, cwd, worktree, file, or source-control affordances. The whole
 * window belongs to it, so it carries its own top chrome.
 */
export function WorkView({ mode, onModeChange }: Props) {
  const state = useSyncExternalStore(subscribeWorkChats, getWorkChatState);
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
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
  const visible = useMemo(() => filterWorkChats(items, query), [items, query]);
  const active = state.activeId ? findWorkChat(state.activeId) : null;

  const onNewChat = useCallback(() => {
    void createWorkChat().then(() => composer.current?.focus());
  }, []);

  const step = useCallback(
    (delta: 1 | -1) => {
      if (visible.length === 0) return;
      const index = visible.findIndex((item) => item.id === state.activeId);
      const next = visible[(index + delta + visible.length) % visible.length];
      if (next) void selectWorkChat(next.id);
    },
    [state.activeId, visible],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (!event.shiftKey && !event.altKey && (key === "t" || key === "n")) {
        event.preventDefault();
        event.stopPropagation();
        onNewChat();
        return;
      }
      if (!event.shiftKey && !event.altKey && key === "l") {
        event.preventDefault();
        event.stopPropagation();
        composer.current?.focus();
        return;
      }
      if (!event.shiftKey && !event.altKey && key === "f") {
        event.preventDefault();
        event.stopPropagation();
        searchField.current?.focus();
        searchField.current?.select();
        return;
      }
      if (event.shiftKey && !event.altKey) {
        if (event.key === "]" || event.key === "}") {
          event.preventDefault();
          event.stopPropagation();
          step(1);
          return;
        }
        if (event.key === "[" || event.key === "{") {
          event.preventDefault();
          event.stopPropagation();
          step(-1);
        }
      }
    };
    // Capture, so the coding-mode workspace bindings behind this surface never
    // see a key meant for the chat list.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onNewChat, step]);

  return (
    <div
      role="region"
      aria-label="Work"
      data-app-work
      className="flex h-full min-h-0 min-w-0 flex-1 text-content"
    >
      <aside className="flex w-64 shrink-0 flex-col border-r border-content/10">
        <div
          className="flex h-10 shrink-0 select-none items-center gap-2 px-1.5"
          data-tauri-drag-region="deep"
        >
          {IS_MAC ? <div className="w-[68px] shrink-0" /> : null}
          <ModeSwitch mode={mode} onChange={onModeChange} />
        </div>

        <div className="flex items-center gap-1 px-2 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-content/10 bg-content/5 px-2">
            <Search className="size-3.5 shrink-0 text-content/40" strokeWidth={1.75} />
            <input
              ref={searchField}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search chats (${MOD}F)`}
              aria-label="Search chats"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[12px] outline-none placeholder:text-content/35"
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
            title={`New chat (${MOD}T)`}
            aria-label="New chat"
            onClick={onNewChat}
            className="grid size-7 shrink-0 place-items-center rounded-md border border-content/10 text-content/60 hover:bg-content/10 hover:text-content"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>

        <div
          ref={listLock}
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-none px-2 pb-2"
        >
          {state.loading && items.length === 0 ? (
            <p className="px-1 py-2 text-[12px] text-content/45">Loading…</p>
          ) : null}
          {state.error ? (
            <p className="px-1 py-2 text-[12px] text-red-400/90">{state.error}</p>
          ) : null}
          {!state.loading && visible.length === 0 ? (
            <p className="px-1 py-2 text-[12px] text-content/45">
              {query ? "No chats match." : "No chats yet."}
            </p>
          ) : null}
          {visible.map((item) => (
            <ChatRow
              key={item.id}
              title={item.title}
              active={item.id === state.activeId}
              renaming={renamingId === item.id}
              busy={findWorkChat(item.id)?.busy === true}
              onSelect={() => void selectWorkChat(item.id)}
              onRenameStart={() => setRenamingId(item.id)}
              onRenameCancel={() => setRenamingId(null)}
              onRenameCommit={(title) => {
                setRenamingId(null);
                void renameWorkChat(item.id, title);
              }}
              onDelete={() => void deleteWorkChat(item.id)}
            />
          ))}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          className="flex h-10 shrink-0 select-none items-center px-3"
          data-tauri-drag-region="deep"
        >
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
              onSubmit={(text, attachments) => void sendWorkChatTurn(active.id, text, attachments)}
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
              onClick={onNewChat}
              className="rounded-md bg-content px-3 py-1.5 text-[12px] text-background-base hover:bg-content/80"
            >
              New chat
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function ChatRow({
  title,
  active,
  busy,
  renaming,
  onSelect,
  onRenameStart,
  onRenameCancel,
  onRenameCommit,
  onDelete,
}: {
  title: string;
  active: boolean;
  busy: boolean;
  renaming: boolean;
  onSelect: () => void;
  onRenameStart: () => void;
  onRenameCancel: () => void;
  onRenameCommit: (title: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(title);

  useEffect(() => {
    if (renaming) setDraft(title);
  }, [renaming, title]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onRenameCommit(draft);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onRenameCancel();
    }
  };

  if (renaming) {
    return (
      <input
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- rename is an explicit user action
        autoFocus
        value={draft}
        aria-label="Chat title"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => onRenameCommit(draft)}
        className="w-full rounded-md border border-content/20 bg-content/5 px-2 py-1.5 text-[12.5px] outline-none"
      />
    );
  }

  return (
    <div
      className={`group flex items-center gap-1 rounded-md pr-1 ${
        active ? "bg-content/10 text-content" : "text-content/75 hover:bg-content/5"
      }`}
    >
      <button
        type="button"
        title={title}
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
        onDoubleClick={onRenameStart}
        className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[12.5px]"
      >
        {title}
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
  );
}
