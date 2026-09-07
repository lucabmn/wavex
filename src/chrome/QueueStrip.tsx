import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, CornerDownRight, ListEnd, Pause, Pencil, Play, Trash2, X } from "./icons";
import type { QueuedPrompt } from "../lib/promptQueue";

type Props = {
  /** Prompts waiting on the running turn, oldest first. */
  queued: QueuedPrompt[];
  /** The queue waits for a deliberate resume after the user stopped the turn. */
  paused?: boolean;
  /** A per-row steer can join the running turn instead of waiting behind it. */
  canSteer?: boolean;
  onRemove?: (promptId: string) => void;
  onEdit?: (promptId: string, text: string) => void;
  onEditingChange?: (promptId?: string) => void;
  /** Steer one row into the running turn now. Falls back to `onSend`. */
  onSteer?: (promptId: string) => void;
  /** Send one row now. */
  onSend?: (promptId: string) => void;
  onResume?: () => void;
};

/**
 * Follow-ups waiting on the running turn, stacked on the composer like the
 * review bar: one row per prompt, in the order it will be sent.
 *
 * Shared by both composers: a follow-up typed mid-turn behaves the same in a
 * project chat and in Work, and in neither can it vanish without a trace.
 */
export function QueueStrip({
  queued,
  paused = false,
  canSteer = false,
  onRemove,
  onEdit,
  onEditingChange,
  onSteer,
  onSend,
  onResume,
}: Props) {
  const [editingId, setEditingId] = useState<string>();
  const [editDraft, setEditDraft] = useState("");
  const onEditingChangeRef = useRef(onEditingChange);
  onEditingChangeRef.current = onEditingChange;
  const editingIdRef = useRef(editingId);
  editingIdRef.current = editingId;
  useEffect(() => {
    return () => {
      if (editingIdRef.current) onEditingChangeRef.current?.();
    };
  }, []);
  if (queued.length === 0) return null;

  const startEdit = (prompt: QueuedPrompt) => {
    setEditingId(prompt.id);
    setEditDraft(prompt.text);
    onEditingChange?.(prompt.id);
  };
  const cancelEdit = () => {
    setEditingId(undefined);
    setEditDraft("");
    onEditingChange?.();
  };
  const saveEdit = (prompt: QueuedPrompt) => {
    if (!editDraft.trim() && prompt.attachments.length === 0) return;
    onEdit?.(prompt.id, editDraft);
    setEditingId(undefined);
    setEditDraft("");
  };

  return (
    <div className="px-2 text-content/55" data-message-queue>
      <div
        className="relative z-0 rounded-t-[10px] border border-b-0 border-content/10 bg-content/3 px-2 py-1"
        data-message-queue-card
      >
        {paused ? (
          <div className="flex h-7 items-center gap-2 border-b border-content/10 text-[12px]">
            <Pause className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">Queue paused because you interrupted</span>
            <button
              type="button"
              onClick={onResume}
              className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content"
            >
              <Play className="size-3.5" />
              Resume
            </button>
          </div>
        ) : null}
        {queued.map((prompt, index) => {
          const editing = editingId === prompt.id;
          const label =
            prompt.text.trim() ||
            (prompt.attachments.length === 1
              ? "1 attachment"
              : `${prompt.attachments.length} attachments`);
          const steering = canSteer && onSteer;
          return (
            <div
              key={prompt.id}
              className={`flex min-h-7 items-center gap-2 text-[12px] ${
                index > 0 ? "border-t border-content/10" : ""
              }`}
            >
              <ListEnd className="size-3.5 shrink-0" />
              {editing ? (
                <>
                  <textarea
                    autoFocus
                    aria-label="Edit queued prompt"
                    value={editDraft}
                    rows={1}
                    onChange={(event) => setEditDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEdit();
                      } else if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        saveEdit(prompt);
                      }
                    }}
                    className="min-h-6 min-w-0 flex-1 resize-none rounded-md border border-content/15 bg-content/5 px-1.5 py-0.5 text-[12px] text-content outline-none focus:border-content/30"
                  />
                  <button
                    type="button"
                    title="Save queued prompt"
                    aria-label="Save queued prompt"
                    disabled={!editDraft.trim() && prompt.attachments.length === 0}
                    onClick={() => saveEdit(prompt)}
                    className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content disabled:opacity-30"
                  >
                    <Check className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Cancel queued prompt edit"
                    aria-label="Cancel queued prompt edit"
                    onClick={cancelEdit}
                    className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
                  >
                    <X className="size-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-content/80" title={prompt.text}>
                    {label}
                  </span>
                  {steering ? (
                    <button
                      type="button"
                      onClick={() => onSteer?.(prompt.id)}
                      className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content"
                    >
                      <CornerDownRight className="size-3.5" />
                      Steer
                    </button>
                  ) : onSend ? (
                    <button
                      type="button"
                      title="Send now"
                      aria-label="Send now"
                      onClick={() => onSend(prompt.id)}
                      className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
                    >
                      <ArrowUp className="size-3.5" strokeWidth={2.25} />
                    </button>
                  ) : null}
                  {onEdit ? (
                    <button
                      type="button"
                      title="Edit queued prompt"
                      aria-label="Edit queued prompt"
                      onClick={() => startEdit(prompt)}
                      className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  ) : null}
                  {onRemove ? (
                    <button
                      type="button"
                      title="Remove from queue"
                      aria-label="Remove from queue"
                      onClick={() => onRemove(prompt.id)}
                      className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
