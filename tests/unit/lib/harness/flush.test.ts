import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStreamPump, STREAM_COMMIT_MS } from "@/lib/harness/flush";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** One provider chunk: enqueue happened, so the pump is asked for a commit. */
function stream(pump: { schedule: () => void }, chunks: number, everyMs: number) {
  for (let index = 0; index < chunks; index += 1) {
    pump.schedule();
    vi.advanceTimersByTime(everyMs);
  }
}

describe("createStreamPump", () => {
  it("commits the first chunk of a turn without waiting out the window", () => {
    let commits = 0;
    const pump = createStreamPump(() => {
      commits += 1;
    });

    pump.schedule();
    vi.advanceTimersByTime(0);
    expect(commits).toBe(1);
  });

  it("holds one commit per window while chunks keep arriving", () => {
    let commits = 0;
    const pump = createStreamPump(() => {
      commits += 1;
    });

    // 600 chunks at 4 ms is a fast provider streaming for 2.4 s. An
    // animation-frame pump would have committed once per frame — ~150 times.
    stream(pump, 600, 4);
    vi.advanceTimersByTime(STREAM_COMMIT_MS);

    expect(commits).toBeLessThanOrEqual(Math.ceil(2400 / STREAM_COMMIT_MS) + 1);
    expect(commits).toBeGreaterThan(0);
  });

  it("commits at most once per window however dense the chunks are", () => {
    let commits = 0;
    const pump = createStreamPump(() => {
      commits += 1;
    });

    for (let index = 0; index < 5000; index += 1) pump.schedule();
    vi.advanceTimersByTime(0);
    for (let index = 0; index < 5000; index += 1) pump.schedule();
    vi.advanceTimersByTime(STREAM_COMMIT_MS - 1);
    expect(commits).toBe(1);

    vi.advanceTimersByTime(1);
    expect(commits).toBe(2);
  });

  it("drains on demand and starts a fresh window", () => {
    let commits = 0;
    const pump = createStreamPump(() => {
      commits += 1;
    });

    pump.schedule();
    pump.flushNow();
    expect(commits).toBe(1);

    // The armed timer was spent by the manual drain, not left to fire again.
    vi.advanceTimersByTime(STREAM_COMMIT_MS * 2);
    expect(commits).toBe(1);

    pump.schedule();
    vi.advanceTimersByTime(0);
    expect(commits).toBe(2);
  });

  it("drops a pending commit when cancelled", () => {
    let commits = 0;
    const pump = createStreamPump(() => {
      commits += 1;
    });

    pump.schedule();
    pump.cancel();
    vi.advanceTimersByTime(STREAM_COMMIT_MS * 2);
    expect(commits).toBe(0);
  });
});
