import { ArrowUp, X } from "./icons";
import { queueSummary, type QueuedPrompt } from "../lib/promptQueue";

type Props = {
  queued: QueuedPrompt[];
  onRemove?: (promptId: string) => void;
  onSend?: (promptId: string) => void;
};

/**
 * Prompts waiting on the running turn, in the order they will be sent.
 *
 * Shared by both composers: a follow-up typed mid-turn behaves the same in a
 * project chat and in Work, and in neither can it vanish without a trace.
 */
export function QueueStrip({ queued, onRemove, onSend }: Props) {
  if (queued.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 px-1.5 pb-1.5">
      <span className="shrink-0 rounded-md bg-content/10 px-1.5 py-0.5 text-[11px] text-content/60">
        {queueSummary(queued.length)}
      </span>
      {queued.map((prompt) => (
        <span
          key={prompt.id}
          className="flex max-w-[240px] min-w-0 items-center gap-1 rounded-md border border-content/10 bg-content/5 py-0.5 pr-0.5 pl-1.5"
        >
          <span className="min-w-0 truncate text-[11px] text-content/70" title={prompt.text}>
            {prompt.text || attachmentLabel(prompt.attachments.length)}
          </span>
          {onSend ? (
            <button
              type="button"
              title="Send now"
              aria-label="Send now"
              onClick={() => onSend(prompt.id)}
              className="grid size-4 shrink-0 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
            >
              <ArrowUp className="size-2.5" strokeWidth={2.25} />
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              title="Remove from queue"
              aria-label="Remove from queue"
              onClick={() => onRemove(prompt.id)}
              className="grid size-4 shrink-0 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
            >
              <X className="size-2.5" strokeWidth={2} />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function attachmentLabel(count: number): string {
  return count === 1 ? "1 attachment" : `${count} attachments`;
}
