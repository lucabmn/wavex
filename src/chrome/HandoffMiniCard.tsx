import { useId, useLayoutEffect, useRef, useState } from "react";

import { ChevronDown, ChevronRight, Replace, Sparkles, X } from "./icons";
import { HARNESS_TITLE, type HarnessId } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";

const MAX_HEIGHT_PX = 220;

type Card = {
  from: HarnessId;
  to: HarnessId;
  brief: string;
  request?: string;
  files?: number;
  briefed?: boolean;
};

type Props = {
  card: Card;
  onDismiss?: () => void;
  /** Edit the briefing before the first message sends it. */
  onBriefChange?: (brief: string) => void;
};

export function HandoffMiniCard({ card, onDismiss, onBriefChange }: Props) {
  const [open, setOpen] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();

  const files =
    card.files != null && card.files > 0
      ? `${card.files} ${card.files === 1 ? "file" : "files"}`
      : null;

  useLayoutEffect(() => {
    const el = area.current;
    if (!el || !open) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [open, card.brief]);

  const editable = !!onBriefChange && !!card.brief.trim();

  return (
    <div className="px-3 pt-2">
      <div
        className={`relative rounded-md border border-content/10 bg-content/6 px-2.5 py-2 ${
          onDismiss ? "pr-8" : ""
        }`}
      >
        <div className="flex w-full flex-col text-left">
          <span className="flex min-w-0 items-center gap-1.5">
            <Replace className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} />
            <span className="min-w-0 truncate text-[11px] text-content/50">Handoff</span>
            {card.briefed ? (
              <Sparkles
                className="size-3 shrink-0 text-content/35"
                strokeWidth={1.75}
                aria-label="Briefing written by an agent"
              />
            ) : null}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] font-semibold leading-snug text-content">
            <HarnessIcon harness={card.from} className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{HARNESS_TITLE[card.from]}</span>
            <ChevronRight className="size-3 shrink-0 text-content/35" strokeWidth={1.75} />
            <HarnessIcon harness={card.to} className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{HARNESS_TITLE[card.to]}</span>
          </span>
          {card.request ? (
            <span className="mt-1 line-clamp-1 text-[11px] text-content/45">{card.request}</span>
          ) : null}
          {files ? (
            <span className="mt-1 text-[11px] leading-4 text-content/45">{files}</span>
          ) : null}
        </div>

        {editable ? (
          <>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((value) => !value)}
              className="mt-1.5 flex min-w-0 items-center gap-1 rounded text-[11px] text-content/45 hover:text-content/80"
            >
              {open ? (
                <ChevronDown className="size-3 shrink-0" strokeWidth={1.75} />
              ) : (
                <ChevronRight className="size-3 shrink-0" strokeWidth={1.75} />
              )}
              <span>{open ? "Hide briefing" : "Edit briefing"}</span>
            </button>
            {open ? null : (
              // A summary nobody reads is a summary silently inherited, so show
              // enough of it to notice a wrong one without opening the editor.
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] leading-4 text-content/45">
                {card.brief}
              </p>
            )}
            {open ? (
              <textarea
                id={panelId}
                ref={area}
                value={card.brief}
                aria-label={`Briefing for ${HARNESS_TITLE[card.to]}`}
                spellCheck={false}
                onChange={(event) => onBriefChange?.(event.target.value)}
                className="mt-1.5 w-full resize-none rounded-md border border-content/10 bg-background-base/60 px-2 py-1.5 font-mono text-[11px] leading-4 text-content/85 outline-none ring-accent/40 focus:ring-1"
              />
            ) : null}
          </>
        ) : null}

        {onDismiss ? (
          <button
            type="button"
            title="Remove"
            aria-label="Remove handoff"
            onClick={onDismiss}
            className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
          >
            <X className="size-3" strokeWidth={2} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
