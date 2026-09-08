import { useCallback, useSyncExternalStore } from "react";

/**
 * One clock per cadence, shared by every repeating animation in the window.
 *
 * A loader that owns its own `setInterval` costs a timer, a React schedule, and
 * a commit *per instance*: eight running sessions in the sidebar meant eight
 * timers waking independently and eight separate commits per frame period. One
 * clock notifies all of its subscribers inside a single task, so React commits
 * once however many are mounted, they animate in lockstep, and the timer parks
 * entirely when the last subscriber unmounts.
 *
 * It also parks while the window is in the background, where nothing it drives
 * can be seen. That is the same discipline the git and worktree stores already
 * follow with `document.hidden`, and it is why a clock is worth having even
 * where the render count is unchanged.
 */
export type Clock = {
  subscribe: (listener: () => void, stride: number) => () => void;
  ticks: () => number;
  stamp: () => number;
};

export function createClock(periodMs: number): Clock {
  const listeners = new Map<() => void, number>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let onVisibility: (() => void) | null = null;
  let ticks = 0;
  let stamp = Date.now();

  const fire = () => {
    ticks += 1;
    stamp = Date.now();
    for (const [listener, stride] of listeners) {
      if (ticks % stride === 0) listener();
    }
  };

  const park = () => {
    if (timer == null) return;
    clearInterval(timer);
    timer = null;
  };

  const run = () => {
    if (timer != null || listeners.size === 0) return;
    timer = setInterval(fire, periodMs);
  };

  // The clock is imported by modules that also run under Vitest's Node
  // environment, where there is no document to hide.
  const backgrounded = () => typeof document !== "undefined" && document.hidden;

  /**
   * Time passed while the window was in the background, so every subscriber is
   * stale however long its stride is. This is not a tick — advancing `ticks`
   * here would shift the phase of every strided subscriber by however many
   * times the window was hidden.
   */
  const onVisible = () => {
    if (backgrounded()) {
      park();
      return;
    }
    if (timer == null && listeners.size > 0) {
      stamp = Date.now();
      for (const [listener] of listeners) listener();
    }
    run();
  };

  return {
    subscribe(listener, stride) {
      listeners.set(listener, Math.max(1, Math.floor(stride)));
      if (listeners.size === 1) {
        // The first subscriber inherits a stamp from whenever this clock was
        // last running, which may be long stale.
        stamp = Date.now();
        onVisibility = onVisible;
        if (typeof document !== "undefined") {
          document.addEventListener("visibilitychange", onVisibility);
        }
        if (!backgrounded()) run();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        park();
        if (onVisibility && typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", onVisibility);
        }
        onVisibility = null;
      };
    },
    ticks: () => ticks,
    /**
     * Only ever advanced by a tick, so it is stable to read as a snapshot —
     * including while the clock is parked behind a hidden window, which is the
     * point. The cost is that the first render after a park reads the stamp the
     * clock stopped on; subscribing refreshes it and React re-reads, so it
     * corrects itself on the next render rather than staying wrong.
     */
    stamp: () => stamp,
  };
}

/**
 * The motion floor, 25 Hz. Chosen over a rounder 30 Hz because it divides the
 * 80 ms terminal-spinner cadence exactly, so moving that spinner onto the
 * shared clock changes no visible rate. A subscriber that costs more than a
 * loader takes a stride instead of its own timer.
 */
export const PULSE_MS = 40;

/** Every other tick, 12.5 Hz — for a loader mounted on an expensive surface. */
export const PULSE_STRIDE_SLOW = 2;

const pulseClock = createClock(PULSE_MS);

/**
 * A counter that advances at `PULSE_MS × stride`. Derive a phase from it —
 * `tick % frames.length` — rather than keeping animation state of your own.
 */
export function usePulse(stride = 1): number {
  const subscribe = useCallback(
    (listener: () => void) => pulseClock.subscribe(listener, stride),
    [stride],
  );
  const getSnapshot = useCallback(() => Math.floor(pulseClock.ticks() / stride), [stride]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const CLOCK_MS = 1000;

const wallClock = createClock(CLOCK_MS);

/** Not a stamp any clock can produce, so it stands in for "not subscribed". */
const UNCLOCKED = 0;

const noop = () => undefined;

/**
 * Wall-clock milliseconds, refreshed once a second. Every "3m ago" and "working
 * for 12s" in the app reads the same stamp, so they change together instead of
 * each dragging its own surface through a render on its own schedule.
 *
 * Pass `active: false` where the surface has nothing live to count — a settled
 * turn, an unfocused menu bar. The caller then leaves the clock alone and reads
 * the time only when it renders for some other reason, which is what a
 * conditionally started interval used to buy. A surface that only ever shows
 * minutes takes `CLOCK_STRIDE_COARSE` instead of waking every second for a
 * label that cannot have changed.
 */
export function useNow(active = true, stride = 1): number {
  const subscribe = useCallback(
    (listener: () => void) => (active ? wallClock.subscribe(listener, stride) : noop),
    [active, stride],
  );
  const getSnapshot = useCallback(() => (active ? wallClock.stamp() : UNCLOCKED), [active]);
  const stamp = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return stamp === UNCLOCKED ? Date.now() : stamp;
}

/** A stride for a surface that only shows minutes: half a minute, not a second. */
export const CLOCK_STRIDE_COARSE = 30;
