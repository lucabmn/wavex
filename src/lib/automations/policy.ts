/**
 * The decisions that keep a schedule from running away.
 *
 * All four are pure and take the clock as an argument, because the behaviour
 * that matters — a host that was off for two days, a run still going when the
 * next is due, an automation failing every time — is exactly the behaviour
 * that is impossible to observe by hand.
 */

import { nextRun, type DstPolicy, type Schedule } from "./schedule";
import type { AutomationRun, MissedPolicy, OverlapPolicy } from "./automation";

/**
 * How late an occurrence may be and still count as on time. A tick that lands
 * a few seconds after the minute is not a missed run; a host that was closed
 * overnight is.
 */
export const MISSED_GRACE_MS = 5 * 60_000;

/** Consecutive failures that park an automation and ask the user to look. */
export const AUTO_PAUSE_AFTER = 3;

export type DueInput = {
  schedule: Schedule;
  /** The occurrence booked last time, or null for an automation that has none. */
  nextDueAt: number | null;
  nowMs: number;
  timeZone: string;
  dstPolicy: DstPolicy;
  missedPolicy: MissedPolicy;
  graceMs?: number;
};

export type DueDecision = {
  runNow: boolean;
  /** The occurrence being run, for the run record. Null when nothing runs. */
  dueAt: number | null;
  /** What to book next. Null when the schedule has nothing left. */
  nextDueAt: number | null;
};

/**
 * Whether an occurrence is due, and what to book after it.
 *
 * A missed occurrence collapses into one catch-up run rather than replaying
 * every interval the host was away for: forty missed hourly runs are forty
 * agents racing in one checkout, which is the failure this policy exists to
 * prevent. The catch-up does not move the schedule either — the next slot is
 * the next real occurrence after now, so an automation cannot drift later every
 * time the machine sleeps.
 */
export function dueDecision(input: DueInput): DueDecision {
  const { schedule, nextDueAt, nowMs, timeZone, dstPolicy, missedPolicy } = input;
  const grace = input.graceMs ?? MISSED_GRACE_MS;

  if (nextDueAt == null) {
    return { runNow: false, dueAt: null, nextDueAt: nextRun(schedule, nowMs, timeZone, dstPolicy) };
  }
  if (nextDueAt > nowMs) {
    return { runNow: false, dueAt: null, nextDueAt };
  }

  const missed = nowMs - nextDueAt > grace;
  const runNow = !missed || missedPolicy === "once";
  return {
    runNow,
    dueAt: runNow ? nextDueAt : null,
    nextDueAt: nextRun(schedule, nowMs, timeZone, dstPolicy),
  };
}

export type StartDecision = "start" | "skip" | "queue";

/** One active run per automation by default; `queue` holds exactly one behind it. */
export function shouldStartRun(policy: OverlapPolicy, running: boolean): StartDecision {
  if (!running) return "start";
  return policy === "queue" ? "queue" : "skip";
}

/**
 * Consecutive failures at the head of the history. A cancellation and a run
 * that stopped for an approval are not failures — the first was asked for and
 * the second is waiting on a person — so either one breaks the streak.
 */
export function leadingFailures(runs: readonly AutomationRun[]): number {
  let count = 0;
  for (const run of runs) {
    if (run.status === "running") continue;
    if (run.status !== "failed") break;
    count++;
  }
  return count;
}

export function shouldAutoPause(
  runs: readonly AutomationRun[],
  threshold = AUTO_PAUSE_AFTER,
): boolean {
  return leadingFailures(runs) >= threshold;
}

export type EndReason = "max-runs" | "end-date";

/** Whether an optional end condition has been met. */
export function endedReason(
  automation: { runCount: number; maxRuns?: number; endAtMs?: number },
  nowMs: number,
): EndReason | null {
  if (automation.maxRuns != null && automation.runCount >= automation.maxRuns) return "max-runs";
  if (automation.endAtMs != null && automation.endAtMs <= nowMs) return "end-date";
  return null;
}
