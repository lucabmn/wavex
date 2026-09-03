import { ChevronRight, MessageSquare, Sparkles } from "./icons";
import { HARNESS_TITLE, type SecondOpinionMeta } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";

type Props = {
  card: SecondOpinionMeta;
  /** Open the session this turn was handed off from. */
  onOpenSource?: (sessionId: string) => void;
};

export function SecondOpinionCard({ card, onOpenSource }: Props) {
  const source = card.sourceSessionId;
  const files =
    card.files != null && card.files > 0
      ? `${card.files} ${card.files === 1 ? "file" : "files"}`
      : null;

  return (
    <div className="min-w-0 font-sans">
      <div className="text-[13px] font-medium leading-snug text-content">
        {card.kind === "handoff" ? "Handoff" : "Second opinion"}
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-content/50">
        <HarnessIcon harness={card.from} className="size-3 shrink-0" />
        <span className="truncate">{HARNESS_TITLE[card.from]}</span>
        <ChevronRight className="size-3 shrink-0 text-content/35" strokeWidth={1.75} />
        <HarnessIcon harness={card.to} className="size-3 shrink-0" />
        <span className="truncate">{HARNESS_TITLE[card.to]}</span>
      </div>
      {files ? <div className="mt-1 text-[11px] leading-4 text-content/45">{files}</div> : null}
      {card.briefed ? (
        <div className="mt-1 flex items-center gap-1 text-[11px] leading-4 text-content/45">
          <Sparkles className="size-3 shrink-0" strokeWidth={1.75} />
          <span>Started from a briefing</span>
        </div>
      ) : null}
      {source && onOpenSource ? (
        <button
          type="button"
          // The briefing is a summary; the full transcript has to stay one click away.
          onClick={() => onOpenSource(source)}
          className="mt-1 flex items-center gap-1 rounded text-[11px] leading-4 text-content/50 hover:text-content"
        >
          <MessageSquare className="size-3 shrink-0" strokeWidth={1.75} />
          <span className="underline underline-offset-2">Open the original session</span>
        </button>
      ) : null}
    </div>
  );
}
