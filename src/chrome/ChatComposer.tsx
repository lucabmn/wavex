import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ArrowUp, ImagePlus, Square, WandSparkles } from "./icons";
import { AttachmentChip } from "./AttachmentChip";
import { ModelPicker } from "./ModelPicker";
import { ModelSettings } from "./ModelSettings";
import { QuestionForm } from "./QuestionForm";
import {
  MAX_ATTACHMENTS,
  attachmentsFromFiles,
  attachmentsFromPaths,
  filesFromClipboard,
  mergeAttachments,
  revokeAttachment,
} from "../lib/attachments";
import { pickFiles } from "../lib/fs";
import { harnessGeneratesImages } from "../lib/harness/imageGeneration";
import { harnessSupportsAttachments, type Attachment, type HarnessId } from "../lib/session";
import type { UserQuestionPrompt, UserQuestionReply } from "../lib/userQuestion";

export type ChatComposerHandle = {
  focus: () => void;
};

type Props = {
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
  busy?: boolean;
  /** Resets the draft when the surface switches to another chat. */
  chatId: string;
  /** Live clarifying question from the harness, answered above the field. */
  question?: UserQuestionPrompt;
  onQuestionReply?: (requestId: number, reply: UserQuestionReply) => void;
  handleRef?: Ref<ChatComposerHandle>;
  onModelChange: (harness: HarnessId, model: string) => void;
  onModelSettingsChange: (settings: Record<string, string>) => void;
  onSubmit: (text: string, attachments: Attachment[], options: { image: boolean }) => void;
  onStop: () => void;
};

const MAX_ROWS_PX = 200;

/**
 * The Work surface's composer. Deliberately not `Composer`: that one carries a
 * project picker, a branch picker, skills, file mentions, and a runtime-access
 * control, all of which assume a checkout a work chat does not have.
 */
export function ChatComposer({
  harness,
  model,
  modelSettings,
  busy = false,
  chatId,
  question,
  onQuestionReply,
  handleRef,
  onModelChange,
  onModelSettingsChange,
  onSubmit,
  onStop,
}: Props) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [hasText, setHasText] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const attachmentsSupported = harnessSupportsAttachments(harness);
  const canGenerateImages = harnessGeneratesImages(harness);

  useImperativeHandle(handleRef, () => ({ focus: () => field.current?.focus() }), []);

  // A draft belongs to the chat it was typed in, not to the surface.
  useEffect(() => {
    const el = field.current;
    if (el) {
      el.value = "";
      el.style.height = "auto";
    }
    setHasText(false);
    setImageMode(false);
    setAttachments((current) => {
      for (const file of current) revokeAttachment(file);
      return [];
    });
  }, [chatId]);

  useEffect(() => {
    if (!canGenerateImages) setImageMode(false);
  }, [canGenerateImages]);

  const resize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, []);

  const addAttachments = useCallback(
    (incoming: Attachment[]) => {
      if (!attachmentsSupported || incoming.length === 0) return;
      setAttachments((current) => mergeAttachments(current, incoming));
    },
    [attachmentsSupported],
  );

  const submit = useCallback(() => {
    const el = field.current;
    const text = el?.value ?? "";
    // An image request needs words; there is nothing to draw from a bare file.
    if (!text.trim() && (imageMode || attachments.length === 0)) return;
    onSubmit(text, attachments, { image: imageMode });
    if (el) {
      el.value = "";
      resize(el);
    }
    setHasText(false);
    // Ownership moves to the transcript; the chips must not be revoked here.
    setAttachments([]);
  }, [attachments, imageMode, onSubmit, resize]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "Escape" && busy) {
      event.preventDefault();
      onStop();
    }
  };

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesFromClipboard(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void attachmentsFromFiles(files).then(addAttachments);
  };

  return (
    <div className="shrink-0 px-3 pb-3">
      {question && onQuestionReply ? (
        <QuestionForm prompt={question} onReply={onQuestionReply} />
      ) : null}
      <div
        className={`overflow-hidden rounded-xl border bg-background-base/60 backdrop-blur-md ${
          dragging ? "border-accent/60" : "border-content/10"
        }`}
        onDragOver={(event) => {
          if (!attachmentsSupported) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          setDragging(false);
          if (!attachmentsSupported) return;
          const files = [...(event.dataTransfer?.files ?? [])];
          if (files.length === 0) return;
          event.preventDefault();
          void attachmentsFromFiles(files).then(addAttachments);
        }}
      >
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1 px-2 pt-2">
            {attachments.map((file) => (
              <AttachmentChip
                key={file.id}
                attachment={file}
                onRemove={() =>
                  setAttachments((current) => {
                    const next = current.filter((item) => item.id !== file.id);
                    revokeAttachment(file);
                    return next;
                  })
                }
              />
            ))}
          </div>
        ) : null}

        <textarea
          ref={field}
          rows={1}
          spellCheck={false}
          placeholder={imageMode ? "Describe an image…" : "Ask anything…"}
          aria-label="Message"
          className="max-h-50 w-full resize-none overflow-x-hidden whitespace-pre-wrap break-words bg-transparent px-3 py-3 font-sans text-sm leading-5.5 outline-none"
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onInput={(event) => {
            const el = event.currentTarget;
            resize(el);
            setHasText(el.value.trim().length > 0);
          }}
        />

        <div className="flex items-center gap-1 px-2 pb-2">
          <button
            type="button"
            title={attachmentsSupported ? "Attach images" : `${harness} does not support images`}
            aria-label="Attach images"
            disabled={!attachmentsSupported}
            className="grid size-6.5 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content disabled:cursor-default disabled:text-content/20 disabled:hover:bg-transparent"
            onClick={() => {
              void pickFiles().then((paths) => {
                if (!paths?.length) return;
                void attachmentsFromPaths(paths.slice(0, MAX_ATTACHMENTS)).then(addAttachments);
              });
            }}
          >
            <ImagePlus className="size-3.5" strokeWidth={1.5} />
          </button>

          {canGenerateImages ? (
            <button
              type="button"
              aria-pressed={imageMode}
              title={
                imageMode
                  ? "Answer with an image — click to go back to text"
                  : "Answer with an image"
              }
              aria-label="Answer with an image"
              className={`grid size-6.5 place-items-center rounded-md ${
                imageMode
                  ? "bg-content/15 text-content"
                  : "text-content/50 hover:bg-content/10 hover:text-content"
              }`}
              onClick={() => {
                setImageMode((on) => !on);
                field.current?.focus();
              }}
            >
              <WandSparkles className="size-3.5" strokeWidth={1.5} />
            </button>
          ) : null}

          <div className="flex min-w-0 flex-1 items-center gap-1">
            <ModelPicker
              harness={harness}
              model={model}
              onChange={onModelChange}
              onClose={() => field.current?.focus()}
            />
            <ModelSettings
              harness={harness}
              model={model}
              values={modelSettings}
              onChange={onModelSettingsChange}
              onClose={() => field.current?.focus()}
            />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {busy ? (
              <button
                type="button"
                title="Stop (Esc)"
                aria-label="Stop"
                onClick={onStop}
                className="grid size-6.5 place-items-center rounded-md bg-white text-black hover:bg-white/90"
              >
                <Square className="size-2.5 fill-current" strokeWidth={0} />
              </button>
            ) : null}
            <button
              type="button"
              title="Send"
              aria-label="Send"
              disabled={!hasText && (imageMode || attachments.length === 0)}
              onClick={submit}
              className="grid size-6.5 place-items-center rounded-md bg-white text-black hover:bg-white/90 disabled:cursor-default disabled:bg-white/30 disabled:text-black/40 disabled:hover:bg-white/30"
            >
              <ArrowUp className="size-3.5" strokeWidth={2.25} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
