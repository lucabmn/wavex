import { useId, useLayoutEffect, useRef, useState } from "react";

import { ChevronRight, Replace, Sparkles } from "./icons";
import { HARNESS_TITLE, type HarnessId } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";

const MIN_HEIGHT_PX = 96;
const MAX_HEIGHT_PX = 320;

type Props = {
  from: HarnessId;
  to: HarnessId;
  brief: string;
  /** The briefing was written by an agent, not assembled from the blocks. */
  briefed: boolean;
  onChange: (brief: string) => void;
  onSend: (brief: string) => void;
};

/**
 * The one place a handoff is editable. Edits go straight to the transcript
 * block: the card unmounts when the transcript windows it out, and sending
 * from the composer accepts whatever is on the block at that moment.
 */
export function HandoffReviewCard({ from, to, brief, briefed, onChange, onSend }: Props) {
  const [sent, setSent] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_HEIGHT_PX), MAX_HEIGHT_PX)}px`;
  }, [brief]);

  const send = (value: string) => {
    if (sent) return;
    setSent(true);
    onSend(value);
  };

  return (
    <div className="px-4 py-5 font-sans">
      <div className="mx-auto max-w-[44rem] rounded-lg border border-content/12 bg-content/4 p-3">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-content/50">
          <Replace className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="shrink-0">Handoff briefing</span>
          <span aria-hidden className="size-[3px] shrink-0 rounded-full bg-content/25" />
          <HarnessIcon harness={from} className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{HARNESS_TITLE[from]}</span>
          <ChevronRight className="size-3 shrink-0 text-content/35" strokeWidth={1.75} />
          <HarnessIcon harness={to} className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{HARNESS_TITLE[to]}</span>
          {briefed ? (
            <Sparkles
              className="size-3 shrink-0 text-content/35"
              strokeWidth={1.75}
              aria-label="Written by an agent"
            />
          ) : null}
        </div>

        <p id={hintId} className="mt-1.5 text-[12px] leading-4 text-content/45">
          {HARNESS_TITLE[to]} gets this instead of the transcript above. Edit it before it goes.
        </p>

        <textarea
          ref={area}
          value={brief}
          aria-label={`Briefing for ${HARNESS_TITLE[to]}`}
          aria-describedby={hintId}
          spellCheck={false}
          disabled={sent}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send(brief);
            }
          }}
          className="mt-2 w-full resize-none rounded-md border border-content/10 bg-background-base/60 px-2.5 py-2 font-mono text-[12px] leading-5 text-content/85 outline-none ring-accent/40 placeholder:text-content/30 focus:ring-1 disabled:opacity-50"
          placeholder="No briefing — the handoff falls back to a plain recap."
        />

        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={sent}
            onClick={() => send("")}
            title="Hand off with the plain recap instead"
            className="rounded-md px-2 py-1 text-[12px] text-content/50 hover:bg-content/8 hover:text-content/80 disabled:opacity-50"
          >
            Skip briefing
          </button>
          <button
            type="button"
            disabled={sent}
            onClick={() => send(brief)}
            className="rounded-md bg-content px-2.5 py-1 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-50"
          >
            Hand off
          </button>
        </div>
      </div>
    </div>
  );
}
