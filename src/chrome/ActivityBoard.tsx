import { useCallback, useEffect, useMemo, useRef } from "react";
import { GripVertical, Square } from "./icons";
import { HarnessIcon } from "./HarnessIcon";
import { useSortable } from "../hooks/useSortable";
import { formatLiveElapsed } from "../lib/liveAgents";
import {
  ACTIVITY_BOARD_LANE_LIMIT,
  ACTIVITY_BOARD_LANES,
  ACTIVITY_BOARD_LANE_LABEL,
  canMoveActivityCard,
  isActivityBoardLane,
  moveActivityCard,
  type ActivityBoardCard,
  type ActivityBoardLane,
  type ActivityBoardState,
} from "../lib/activityBoard";
import { AGENT_STATUS_LABEL, resolveAgentStatus, sessionStatusTooltip } from "../lib/sessionStatus";

/** Lane colors carry no meaning on their own: every lane is labelled too. */
const LANE_DOT: Record<ActivityBoardLane, string> = {
  "needs-you": "bg-amber-400",
  working: "bg-content/55",
  done: "bg-emerald-400/70",
  parked: "bg-content/20",
};

const LANE_EMPTY: Record<ActivityBoardLane, string> = {
  "needs-you": "Nothing waiting on you",
  working: "Nothing running",
  done: "Nothing finished",
  parked: "Drop a finished session here",
};

export function ActivityBoard({
  cards,
  state,
  now,
  onChange,
  onOpen,
  onStop,
}: {
  cards: ActivityBoardCard[];
  state: ActivityBoardState;
  now: number;
  onChange: (state: ActivityBoardState) => void;
  onOpen: (card: ActivityBoardCard) => void;
  onStop: (card: ActivityBoardCard) => void;
}) {
  const byKey = useMemo(() => new Map(cards.map((card) => [card.key, card])), [cards]);
  const byKeyRef = useRef(byKey);
  byKeyRef.current = byKey;
  const stateRef = useRef(state);
  stateRef.current = state;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const lanes = useMemo(
    () =>
      ACTIVITY_BOARD_LANES.map((lane) => {
        const all = cards.filter((card) => card.lane === lane);
        return {
          lane,
          cards: all.slice(0, ACTIVITY_BOARD_LANE_LIMIT),
          hidden: all.length - Math.min(all.length, ACTIVITY_BOARD_LANE_LIMIT),
          total: all.length,
        };
      }),
    [cards],
  );
  // Lane-major, which is the order arrow keys walk and the order the eye reads.
  const order = useMemo(
    () => lanes.flatMap((entry) => entry.cards.map((card) => card.key)),
    [lanes],
  );
  const multiProject = useMemo(
    () => new Set(cards.map((card) => card.projectKey)).size > 1,
    [cards],
  );

  const canDrop = useCallback((key: string, lane: string) => {
    const card = byKeyRef.current.get(key);
    return !!card && isActivityBoardLane(lane) && canMoveActivityCard(card, lane);
  }, []);

  const move = useCallback((key: string, lane: ActivityBoardLane) => {
    const card = byKeyRef.current.get(key);
    if (!card || !canMoveActivityCard(card, lane)) return;
    onChangeRef.current(moveActivityCard(stateRef.current, key, lane));
  }, []);

  // Cards have no hand-picked order — their lane is their position — so a
  // reorder is a no-op and only the column drop commits anything.
  const sortable = useSortable(order, () => undefined, {
    axis: "y",
    onDropOnColumn: (key, lane) => {
      if (isActivityBoardLane(lane)) move(key, lane);
    },
    canDropOn: (key, kind, target) => kind === "column" && canDrop(key, target),
  });

  /**
   * A moved card is re-parented into another column, so the browser drops the
   * focus a keyboard move started from. Put it back on the card.
   */
  const focusAfterMove = useRef<string | null>(null);
  const cardNodes = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    const key = focusAfterMove.current;
    if (!key) return;
    focusAfterMove.current = null;
    cardNodes.current.get(key)?.focus();
  }, [cards]);

  const onCardKeyDown = useCallback(
    (card: ActivityBoardCard, event: React.KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const step = event.key === "ArrowLeft" ? -1 : 1;
        const from = ACTIVITY_BOARD_LANES.indexOf(card.lane);
        for (let i = from + step; i >= 0 && i < ACTIVITY_BOARD_LANES.length; i += step) {
          const lane = ACTIVITY_BOARD_LANES[i];
          if (!canMoveActivityCard(card, lane)) continue;
          event.preventDefault();
          focusAfterMove.current = card.key;
          move(card.key, lane);
          return;
        }
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const next = order.indexOf(card.key) + (event.key === "ArrowUp" ? -1 : 1);
      const target = order[next] ? cardNodes.current.get(order[next]) : undefined;
      if (!target) return;
      event.preventDefault();
      target.focus();
    },
    [move, order],
  );

  const dragging = sortable.draggingId ? byKey.get(sortable.draggingId) : undefined;

  if (cards.length === 0) {
    return (
      <p className="px-4 py-6 text-[13.5px] text-faint">
        No saved session matches the sidebar filters.
      </p>
    );
  }

  return (
    <div className="flex min-h-full min-w-0 gap-2.5 overflow-x-auto p-3">
      <p className="sr-only">
        Drag a finished session between Done and Parked, or move the focused card with the left and
        right arrow keys.
      </p>
      {lanes.map(({ lane, cards: laneCards, hidden, total }) => {
        const accepts = !dragging || dragging.lane === lane || canMoveActivityCard(dragging, lane);
        const over = sortable.dropTarget?.id === lane && sortable.dropTarget.allowed;
        return (
          <section
            key={lane}
            ref={(el) => sortable.setGroupDropRef(lane, el)}
            aria-label={`${ACTIVITY_BOARD_LANE_LABEL[lane]}, ${total} sessions`}
            className={`flex min-w-60 flex-1 flex-col rounded-xl border transition-colors ${
              over ? "border-edge-strong bg-content/[0.06]" : "border-edge bg-content/[0.02]"
            } ${dragging && !accepts ? "opacity-40" : ""}`}
          >
            <header className="flex items-center gap-2 px-3 py-2.5">
              <span className={`size-1.5 shrink-0 rounded-full ${LANE_DOT[lane]}`} aria-hidden />
              <h2 className="min-w-0 truncate text-[11.5px] font-medium text-muted">
                {ACTIVITY_BOARD_LANE_LABEL[lane]}
              </h2>
              <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-dim">{total}</span>
            </header>
            <div className="flex min-h-24 flex-col gap-1.5 px-2 pb-2">
              {laneCards.length === 0 ? (
                <span className="px-1 py-2 text-[11.5px] text-dim">{LANE_EMPTY[lane]}</span>
              ) : (
                laneCards.map((card) => (
                  <BoardCard
                    key={card.key}
                    card={card}
                    now={now}
                    showProject={multiProject}
                    dragging={sortable.draggingId === card.key}
                    setCardNode={(el) => {
                      if (el) cardNodes.current.set(card.key, el);
                      else cardNodes.current.delete(card.key);
                    }}
                    setItemRef={sortable.setItemRef}
                    onPointerDown={(event) => sortable.onItemPointerDown(card.key, event)}
                    onKeyDown={(event) => onCardKeyDown(card, event)}
                    onOpen={() => {
                      if (!sortable.consumeClick()) onOpen(card);
                    }}
                    onStop={() => onStop(card)}
                  />
                ))
              )}
              {hidden > 0 ? (
                <span className="px-1 pt-1 text-[11.5px] text-dim">
                  {`${hidden} more in the list`}
                </span>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({
  card,
  now,
  showProject,
  dragging,
  setCardNode,
  setItemRef,
  onPointerDown,
  onKeyDown,
  onOpen,
  onStop,
}: {
  card: ActivityBoardCard;
  now: number;
  showProject: boolean;
  dragging: boolean;
  setCardNode: (el: HTMLButtonElement | null) => void;
  setItemRef: (id: string, el: HTMLElement | null) => void;
  onPointerDown: (event: React.PointerEvent) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onOpen: () => void;
  onStop: () => void;
}) {
  const live = card.live;
  const running = !!live && !live.done;
  const movable = card.derivedLane === "done";
  const agentStatus = resolveAgentStatus({
    busy: running,
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
  const statusText = live ? AGENT_STATUS_LABEL[agentStatus] : "Idle";

  return (
    <div
      ref={(el) => setItemRef(card.key, el)}
      onPointerDown={movable ? onPointerDown : undefined}
      className={`group flex min-w-0 items-start gap-1.5 rounded-lg border border-edge bg-background-base px-2 py-2 transition-colors hover:border-edge-strong ${
        dragging ? "opacity-40" : ""
      } ${movable ? "cursor-grab" : ""}`}
      title={sessionStatusTooltip({
        title: card.session.title,
        branch: card.session.branch,
        repo: card.session.repo,
        agent: agentStatus,
      })}
    >
      {movable ? (
        <GripVertical
          className="mt-1 size-3.5 shrink-0 text-dim opacity-0 transition-opacity group-hover:opacity-100"
          strokeWidth={1.75}
          aria-hidden
        />
      ) : (
        <span className="mt-1 size-3.5 shrink-0" aria-hidden />
      )}
      <button
        ref={setCardNode}
        type="button"
        onClick={onOpen}
        onKeyDown={onKeyDown}
        aria-keyshortcuts={movable ? "ArrowLeft ArrowRight" : undefined}
        aria-label={`${card.session.title}, ${statusText}`}
        className="flex min-w-0 flex-1 flex-col items-start gap-1 rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-content/60"
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <HarnessIcon harness={card.session.harness} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-content">
            {card.session.title}
          </span>
        </span>
        <span className="flex w-full min-w-0 items-center gap-1.5 text-[11.5px] text-dim">
          {showProject ? (
            <>
              <span className="max-w-24 shrink-0 truncate">{card.projectLabel}</span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <span className="min-w-0 truncate">{live?.activity || statusText}</span>
          {elapsed ? (
            <span className="ml-auto shrink-0 font-mono tabular-nums">{elapsed}</span>
          ) : null}
        </span>
      </button>
      {running ? (
        <button
          type="button"
          data-no-drag
          title="Stop this turn"
          aria-label="Stop this turn"
          onClick={onStop}
          className="grid size-6 shrink-0 place-items-center rounded-md text-faint hover:bg-hover hover:text-content"
        >
          <Square className="size-2.5 fill-current" strokeWidth={0} />
        </button>
      ) : null}
    </div>
  );
}
