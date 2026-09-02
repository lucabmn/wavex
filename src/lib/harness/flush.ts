/**
 * A hidden window gets no animation frames, so a background tab would sit on
 * unflushed harness events until it came back. Fall back to a timer there.
 */
export type ScheduledFlush = { kind: "raf" | "timeout"; id: number };

export function cancelScheduledFlush(handle: ScheduledFlush | null) {
  if (!handle) return;
  if (handle.kind === "raf") cancelAnimationFrame(handle.id);
  else clearTimeout(handle.id);
}

export function scheduleHarnessFlush(run: () => void): ScheduledFlush {
  if (document.hidden) {
    return { kind: "timeout", id: window.setTimeout(run, 32) };
  }
  return { kind: "raf", id: requestAnimationFrame(run) };
}
