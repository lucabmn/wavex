/**
 * The window provider chunks collect in before one commit reaches React.
 *
 * A commit is priced at the whole visible transcript — the turn re-renders,
 * markdown re-parses, and the scroller remeasures — so the cadence of commits,
 * not the cadence of chunks, is what streaming costs. An animation frame is
 * 8–16 ms, so pumping on `requestAnimationFrame` committed 7–14 times inside
 * this window and only ever coalesced the deltas that happened to land in the
 * same frame. 120 ms is the widest window that still reads as live text.
 */
export const STREAM_COMMIT_MS = 120;

/**
 * A throttle with a leading edge, owned by whoever owns the queue it drains.
 *
 * Leading edge matters: a pure trailing window would delay the first token of
 * every turn by the full interval, which is the part of streaming a user is
 * actually watching for. After that first commit the throttle holds the rate at
 * one commit per window for as long as chunks keep arriving.
 *
 * Timers, not frames. A hidden window gets no animation frames at all, so a
 * background tab used to sit on unflushed harness events until it came back;
 * with a timer that case needs no separate path.
 */
export type StreamPump = {
  /** Ask for a commit. Cheap and idempotent while one is already armed. */
  schedule: () => void;
  /** Drain now — a stop or a cancel cannot wait for the window. */
  flushNow: () => void;
  /** Drop a pending commit without draining. */
  cancel: () => void;
};

export function createStreamPump(drain: () => void): StreamPump {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastDrainedAt = Number.NEGATIVE_INFINITY;

  const run = () => {
    timer = null;
    lastDrainedAt = Date.now();
    drain();
  };

  const cancel = () => {
    if (timer == null) return;
    clearTimeout(timer);
    timer = null;
  };

  return {
    schedule() {
      if (timer != null) return;
      const since = Date.now() - lastDrainedAt;
      const delay = since >= STREAM_COMMIT_MS ? 0 : STREAM_COMMIT_MS - since;
      timer = setTimeout(run, delay);
    },
    flushNow() {
      cancel();
      run();
    },
    cancel,
  };
}
