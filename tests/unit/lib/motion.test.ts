import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClock, CLOCK_STRIDE_COARSE, PULSE_MS, PULSE_STRIDE_SLOW } from "@/lib/motion";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createClock", () => {
  it("wakes every subscriber from one timer", () => {
    const clock = createClock(40);
    const seen = [0, 0, 0];
    const stops = seen.map((_, index) => clock.subscribe(() => (seen[index] += 1), 1));

    vi.advanceTimersByTime(200);
    expect(seen).toEqual([5, 5, 5]);
    expect(vi.getTimerCount()).toBe(1);

    for (const stop of stops) stop();
  });

  it("parks when the last subscriber leaves", () => {
    const clock = createClock(40);
    let ticks = 0;
    const stop = clock.subscribe(() => (ticks += 1), 1);

    vi.advanceTimersByTime(80);
    expect(ticks).toBe(2);

    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(4000);
    expect(ticks).toBe(2);
  });

  it("notifies a strided subscriber every nth tick only", () => {
    const clock = createClock(40);
    let fast = 0;
    let slow = 0;
    const stopFast = clock.subscribe(() => (fast += 1), 1);
    const stopSlow = clock.subscribe(() => (slow += 1), PULSE_STRIDE_SLOW);

    vi.advanceTimersByTime(400);
    expect(fast).toBe(10);
    expect(slow).toBe(5);

    stopFast();
    stopSlow();
  });

  it("keeps a coarse subscriber off all but its own tick", () => {
    const clock = createClock(1000);
    let coarse = 0;
    const stop = clock.subscribe(() => (coarse += 1), CLOCK_STRIDE_COARSE);

    vi.advanceTimersByTime(29_000);
    expect(coarse).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(coarse).toBe(1);

    stop();
  });

  it("advances the stamp it hands out", () => {
    const clock = createClock(1000);
    const stop = clock.subscribe(() => undefined, 1);
    const first = clock.stamp();

    vi.advanceTimersByTime(3000);
    expect(clock.stamp() - first).toBe(3000);

    stop();
  });

  it("the spinner turns at the rate it always has", () => {
    // The braille spinner reads one frame per PULSE_MS * PULSE_STRIDE_SLOW.
    expect(PULSE_MS * PULSE_STRIDE_SLOW).toBe(80);
  });
});
