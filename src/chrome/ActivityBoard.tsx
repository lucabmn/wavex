import { useMemo } from "react";
import { Board, GripVertical, Square } from "./icons";
import { HarnessIcon } from "./HarnessIcon";
import { useSortable } from "../hooks/useSortable";
import { formatLiveElapsed } from "../lib/liveAgents";
import {
  ACTIVITY_BOARD_LANES,
  ACTIVITY_BOARD_LANE_LABEL,
  activityBoardCards,
  moveActivityCard,
  type ActivityBoardLane,
  type ActivityBoardState,
} from "../lib/activityBoard";
import { AGENT_STATUS_LABEL, resolveAgentStatus, sessionStatusTooltip } from "../lib/sessionStatus";

type Card = ReturnType<typeof activityBoardCards>[number];

export function ActivityBoard({
  cards,
  state,
  now,
  onChange,
  onOpen,
  onStop,
}: {
  cards: Card[];
  state: ActivityBoardState;
  now: number;
  onChange: (state: ActivityBoardState) => void;
  onOpen: (card: Card) => void;
  onStop: (card: Card) => void;
}) {
  const allIds = cards.map((card) => card.key);
  const sortable = useSortable(allIds, () => undefined, {
    axis: "y",
    onDropOnColumn: (key, columnId) => {
      const lane = columnId.slice(columnId.lastIndexOf(":") + 1);
      if (ACTIVITY_BOARD_LANES.includes(lane as ActivityBoardLane)) {
        onChange(moveActivityCard(state, key, lane as ActivityBoardLane));
      }
    },
  });
  const grouped = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const card of cards) {
      const list = map.get(card.projectKey);
      if (list) list.push(card);
      else map.set(card.projectKey, [card]);
    }
    return [...map.entries()];
  }, [cards]);

  return (
    <div className="flex min-h-full min-w-0 flex-col gap-4 p-3">
      {grouped.length === 0 ? (
        <p className="px-1 py-6 text-[13px] text-content/45">
          No saved sessions match the sidebar filters.
        </p>
      ) : null}
      {grouped.map(([projectKey, projectCards]) => (
        <section key={projectKey} className="flex min-w-0 flex-col gap-2">
          <h2 className="px-1 text-[11px] font-medium tracking-wide text-content/40 uppercase">
            {projectCards[0].projectLabel}
          </h2>
          <div className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-4">
            {ACTIVITY_BOARD_LANES.map((lane) => {
              const laneCards = projectCards.filter((card) => card.lane === lane);
              return (
                <div
                  key={lane}
                  ref={(el) => sortable.setGroupDropRef(`${projectKey}:${lane}`, el)}
                  aria-label={`${ACTIVITY_BOARD_LANE_LABEL[lane]} in ${projectCards[0].projectLabel}`}
                  className="flex min-h-28 min-w-0 flex-col gap-2 rounded-lg border border-content/10 bg-content/[0.025] p-2"
                >
                  <div className="flex items-center justify-between gap-2 px-1">
                    <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-content/65">
                      <Board className="size-3.5 shrink-0" strokeWidth={1.75} />
                      {ACTIVITY_BOARD_LANE_LABEL[lane]}
                    </span>
                    <span className="text-[11px] tabular-nums text-content/35">
                      {laneCards.length}
                    </span>
                  </div>
                  {laneCards.length === 0 ? (
                    <span className="px-1 py-3 text-[11px] text-content/30">No sessions</span>
                  ) : null}
                  {laneCards.map((card) => (
                    <ActivityBoardCard
                      key={card.key}
                      card={card}
                      now={now}
                      onOpen={() => onOpen(card)}
                      onStop={() => onStop(card)}
                      onMove={(nextLane) => onChange(moveActivityCard(state, card.key, nextLane))}
                      sortable={sortable}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function ActivityBoardCard({
  card,
  now,
  onOpen,
  onStop,
  onMove,
  sortable,
}: {
  card: Card;
  now: number;
  onOpen: () => void;
  onStop: () => void;
  onMove: (lane: ActivityBoardLane) => void;
  sortable: ReturnType<typeof useSortable>;
}) {
  const live = card.live;
  const agentStatus = resolveAgentStatus({
    busy: !!live && !live.done,
    needsApproval: !!live?.needsApproval,
    unread: false,
  });
  const elapsed = live?.done
    ? live.durationMs != null
      ? formatLiveElapsed(0, live.durationMs)
      : null
    : live?.startedAt != null
      ? formatLiveElapsed(live.startedAt, now)
      : null;
  const statusText = live ? AGENT_STATUS_LABEL[agentStatus] : "Done";
  const tooltip = sessionStatusTooltip({
    title: card.session.title,
    branch: card.session.branch,
    repo: card.session.repo,
    agent: agentStatus,
  });

  return (
    <div
      ref={(el) => sortable.setItemRef(card.key, el)}
      onPointerDown={(event) => sortable.onItemPointerDown(card.key, event)}
      className="group flex min-w-0 items-start gap-1 rounded-md border border-content/10 bg-background-base px-2 py-2 shadow-sm"
      title={tooltip}
    >
      <GripVertical
        className="mt-0.5 size-3.5 shrink-0 text-content/25"
        strokeWidth={1.75}
        aria-hidden
      />
      <button
        type="button"
        data-no-drag
        className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-content/60"
        onClick={() => {
          if (!sortable.consumeClick()) onOpen();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const delta = event.key === "ArrowLeft" ? -1 : 1;
            const index = ACTIVITY_BOARD_LANES.indexOf(card.lane);
            const next = ACTIVITY_BOARD_LANES[index + delta];
            if (next) onMove(next);
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const cards = [...document.querySelectorAll<HTMLElement>("[data-activity-board-card]")];
            const index = cards.indexOf(event.currentTarget);
            cards[index + (event.key === "ArrowUp" ? -1 : 1)]?.focus();
          }
        }}
        data-activity-board-card
        aria-label={`${card.session.title}, ${statusText}`}
      >
        <span className="flex min-w-0 w-full items-center gap-2">
          <HarnessIcon harness={card.session.harness} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-content">
            {card.session.title}
          </span>
        </span>
        <span className="flex min-w-0 w-full items-center gap-1.5 text-[11px] text-content/45">
          <span className="truncate">{statusText}</span>
          {live?.activity ? <span className="truncate">{live.activity}</span> : null}
          {elapsed ? (
            <span className="ml-auto shrink-0 font-mono tabular-nums">{elapsed}</span>
          ) : null}
        </span>
      </button>
      {live && !live.done ? (
        <button
          type="button"
          data-no-drag
          title="Stop this turn"
          aria-label="Stop this turn"
          onClick={onStop}
          className="grid size-6.5 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
        >
          <Square className="size-2.5 fill-current" strokeWidth={0} />
        </button>
      ) : null}
      <span className="sr-only">
        Use left and right arrow keys to move this card between lanes.
      </span>
    </div>
  );
}
