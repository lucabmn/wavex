/**
 * Shared state and the tick for scheduled agent tasks.
 *
 * A `useSyncExternalStore` store rather than a context, for the same reason
 * work chats use one: the tick and the runs it starts happen outside React,
 * and every window that has the surface open has to see the same list.
 *
 * The tick runs in every window, and that is safe because it is not what
 * decides anything. `automation_run_start` claims an occurrence inside a
 * transaction on the host, so whichever window asks first gets it and the
 * others are told no — which is a stronger guarantee than electing a window,
 * since an election still double-fires if a window misses the hand-off.
 *
 * Nothing runs while no window is open: the harness adapters are TypeScript,
 * so an occurrence that comes due with wavex closed is a missed run and the
 * automation's missed-run policy decides what happens to it. The surface says
 * so rather than implying a background service exists.
 */

import { cancelHarnessTurn } from "../harness";
import { playCue } from "../sounds";
import {
  attachRunSession,
  finishAutomationRun,
  heartbeatAutomationRuns,
  listAutomationRuns,
  listAutomations,
  readAllAutomationsPaused,
  reconcileAutomationRuns,
  removeAutomation,
  saveAutomation,
  setAllAutomationsPaused,
  setAutomationState,
  startAutomationRun,
} from "./automationsHost";
import {
  RUN_HISTORY_MAX,
  type Automation,
  type AutomationDraft,
  type AutomationRun,
  type PausedReason,
} from "./automation";
import { dueDecision, endedReason, shouldAutoPause, shouldStartRun } from "./policy";
import { nextRun } from "./schedule";
import { executeAutomationRun } from "./runner";

export type AutomationsState = {
  automations: Automation[];
  /** Newest runs across every automation, for the list and the detail view. */
  runs: AutomationRun[];
  /** The global emergency stop. Held apart from each automation's own flag. */
  allPaused: boolean;
  loading: boolean;
  error: string | null;
  /** Automations this window is currently running, for a live row. */
  running: string[];
};

const EMPTY: AutomationsState = {
  automations: [],
  runs: [],
  allPaused: false,
  loading: false,
  error: null,
  running: [],
};

let state: AutomationsState = EMPTY;
const listeners = new Set<() => void>();

/** Occurrences held behind an active run by the queue-one overlap policy. */
const queued = new Map<string, number>();
const running = new Set<string>();
/** The session behind each run this window is driving, so it can be stopped. */
const liveSessions = new Map<string, string>();
/** The run rows this window is driving, so their lease keeps being renewed. */
const liveRuns = new Map<string, string>();
/** Automations whose current run was stopped by hand, not by the agent. */
const cancelled = new Set<string>();

let loaded: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * How often the tick looks. Well under the five-minute minimum interval, so a
 * run is never more than half a minute late, and coarse enough that a
 * background window throttled to one timer a minute still behaves.
 */
export const TICK_MS = 30_000;

export function subscribeAutomations(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAutomationsState(): AutomationsState {
  return state;
}

function emit() {
  for (const listener of listeners) listener();
}

function set(next: Partial<AutomationsState>) {
  state = { ...state, ...next };
  emit();
}

/** Test seam. */
export function resetAutomationStore(): void {
  stopAutomationScheduler();
  queued.clear();
  running.clear();
  liveSessions.clear();
  liveRuns.clear();
  cancelled.clear();
  loaded = null;
  state = EMPTY;
  emit();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function refresh(): Promise<void> {
  const [automations, runs, allPaused] = await Promise.all([
    listAutomations(),
    listAutomationRuns({ limit: RUN_HISTORY_MAX }),
    readAllAutomationsPaused(),
  ]);
  set({ automations, runs, allPaused, error: null });
}

export function loadAutomations(force = false): Promise<void> {
  if (loaded && !force) return loaded;
  set({ loading: true });
  loaded = refresh()
    .catch((error: unknown) => {
      set({ error: message(error) });
    })
    .finally(() => set({ loading: false }));
  return loaded;
}

/** Runs left open by a crash or a quit are settled before the first tick. */
export async function reconcileAutomations(): Promise<void> {
  await reconcileAutomationRuns().catch(() => 0);
  await loadAutomations(true);
}

function bookNext(
  automation: Pick<Automation, "schedule" | "timeZone" | "dstPolicy">,
  fromMs: number,
): number | null {
  return nextRun(automation.schedule, fromMs, automation.timeZone, automation.dstPolicy);
}

export async function createAutomation(
  draft: AutomationDraft,
  nowMs = Date.now(),
): Promise<Automation> {
  const saved = await saveAutomation({
    ...draft,
    id: crypto.randomUUID(),
    nextDueAt: draft.enabled ? bookNext(draft, nowMs) : null,
    pausedReason: draft.enabled ? "" : "manual",
  });
  await loadAutomations(true);
  return saved;
}

export async function updateAutomation(
  id: string,
  draft: AutomationDraft,
  nowMs = Date.now(),
): Promise<Automation> {
  const current = state.automations.find((entry) => entry.id === id);
  const saved = await saveAutomation({
    ...draft,
    id,
    // The schedule may have changed under the edit, so the booked instant is
    // recomputed rather than carried over from the old one.
    nextDueAt: draft.enabled ? bookNext(draft, nowMs) : null,
    // Opening the editor to look at an automation must not erase why it is
    // parked: "paused after repeated failures" is the actionable part, and
    // "finished" is what keeps it out of the active list.
    pausedReason: draft.enabled ? "" : (current?.pausedReason ?? "manual"),
  });
  await loadAutomations(true);
  return saved;
}

export async function deleteAutomation(id: string): Promise<void> {
  await removeAutomation(id);
  queued.delete(id);
  await loadAutomations(true);
}

export async function setAutomationEnabled(
  id: string,
  enabled: boolean,
  nowMs = Date.now(),
): Promise<void> {
  const automation = state.automations.find((entry) => entry.id === id);
  if (!automation) return;
  await setAutomationState({
    id,
    enabled,
    nextDueAt: enabled ? bookNext(automation, nowMs) : null,
    pausedReason: enabled ? "" : "manual",
  });
  if (!enabled) queued.delete(id);
  await loadAutomations(true);
}

export async function pauseAllAutomations(paused: boolean): Promise<void> {
  await setAllAutomationsPaused(paused);
  set({ allPaused: paused });
}

async function park(automation: Automation, reason: PausedReason): Promise<void> {
  await setAutomationState({
    id: automation.id,
    enabled: false,
    nextDueAt: null,
    pausedReason: reason,
  });
  queued.delete(automation.id);
}

function markRunning(id: string, active: boolean) {
  if (active) running.add(id);
  else running.delete(id);
  set({ running: [...running] });
}

/**
 * Claim an occurrence and run it. Returns the run row, or null when another
 * window already holds this automation or this occurrence.
 */
async function beginRun(
  automation: Automation,
  dueAt: number,
  manual: boolean,
): Promise<AutomationRun | null> {
  const claim = await startAutomationRun({
    automationId: automation.id,
    runId: crypto.randomUUID(),
    dueAt,
    manual,
  });
  if (!claim) return null;

  liveRuns.set(automation.id, claim.id);
  markRunning(automation.id, true);
  await loadAutomations(true).catch(() => undefined);
  try {
    const result = await executeAutomationRun(automation, {
      onSession: (session) => {
        liveSessions.set(automation.id, session.id);
        void attachRunSession(claim.id, session.id).catch(() => undefined);
      },
    });
    // A turn the user stopped comes back as an ordinary end or an error, and
    // neither is what happened, so the stop itself is what names the outcome.
    const status = cancelled.has(automation.id) ? "cancelled" : result.status;
    await finishAutomationRun({
      runId: claim.id,
      status,
      ...(result.error && status !== "cancelled" ? { error: result.error } : {}),
      ...(result.summary ? { summary: result.summary } : {}),
    }).catch(() => undefined);
    if (automation.notify && status !== "cancelled") {
      playCue(status === "success" ? "turnFinished" : "inboxUnseen");
    }
  } finally {
    markRunning(automation.id, false);
    liveSessions.delete(automation.id);
    liveRuns.delete(automation.id);
    cancelled.delete(automation.id);
  }

  const history = await listAutomationRuns({ automationId: automation.id }).catch(
    () => [] as AutomationRun[],
  );
  if (automation.enabled && shouldAutoPause(history)) {
    await park(automation, "failures").catch(() => undefined);
  }
  await loadAutomations(true).catch(() => undefined);

  // The queue-one policy holds exactly one occurrence, and it is released
  // here rather than on the next tick so it does not wait out the interval.
  const held = queued.get(automation.id);
  if (held != null) {
    queued.delete(automation.id);
    const latest = state.automations.find((entry) => entry.id === automation.id);
    if (latest?.enabled) await beginRun(latest, held, false).catch(() => undefined);
  }
  return claim;
}

/** "Run now": a manual run, so it may repeat an occurrence but never overlap one. */
export async function runAutomationNow(id: string): Promise<void> {
  const automation = state.automations.find((entry) => entry.id === id);
  if (!automation) return;
  await beginRun(automation, Date.now(), true);
}

/**
 * Stop the run this window is driving. The agent is cancelled the same way a
 * typed turn is, and the run settles as cancelled rather than as a failure the
 * automation would be paused for.
 */
export async function stopAutomationRun(id: string): Promise<void> {
  const sessionId = liveSessions.get(id);
  if (!sessionId) return;
  const automation = state.automations.find((entry) => entry.id === id);
  if (!automation) return;
  cancelled.add(id);
  await cancelHarnessTurn(automation.harness, sessionId).catch(() => undefined);
}

async function tickAutomation(automation: Automation, nowMs: number): Promise<void> {
  const ended = endedReason(automation, nowMs);
  if (ended) {
    await park(automation, ended);
    return;
  }

  const decision = dueDecision({
    schedule: automation.schedule,
    nextDueAt: automation.nextDueAt,
    nowMs,
    timeZone: automation.timeZone,
    dstPolicy: automation.dstPolicy,
    missedPolicy: automation.missedPolicy,
  });

  if (decision.nextDueAt !== automation.nextDueAt) {
    await setAutomationState({
      id: automation.id,
      enabled: true,
      nextDueAt: decision.nextDueAt,
      pausedReason: "",
    });
  }
  if (!decision.runNow || decision.dueAt == null) return;

  const start = shouldStartRun(automation.overlapPolicy, running.has(automation.id));
  if (start === "skip") return;
  if (start === "queue") {
    queued.set(automation.id, decision.dueAt);
    return;
  }
  // Started, not awaited. A turn can take an hour, and the tick still has the
  // rest of the schedule to look at — including automations that have to be
  // rebooked while this one runs. Overlap is not what the awaiting was
  // protecting: `automation_run_start` already refuses a second run for the
  // same automation.
  void beginRun(automation, decision.dueAt, false).catch(() => undefined);
}

let ticking = false;

export async function tickAutomations(nowMs = Date.now()): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    // Say this window is still driving what it started, then settle the runs
    // nobody is. Both every tick rather than only at startup: a window that
    // closes mid-turn leaves a row marked going, and `automation_run_start`
    // refuses every later claim while one is.
    await heartbeatAutomationRuns([...liveRuns.values()]).catch(() => undefined);
    await reconcileAutomationRuns().catch(() => 0);
    // Forced, because another window may have edited, paused, or deleted an
    // automation since the last tick and this one must not act on the old row.
    await loadAutomations(true);
    if (state.allPaused) return;
    // Snapshotted: starting a run refreshes the list, and iterating the live
    // array would visit a row twice or skip one.
    const due = state.automations.filter((automation) => automation.enabled);
    for (const automation of due) {
      await tickAutomation(automation, nowMs).catch(() => undefined);
    }
  } finally {
    ticking = false;
  }
}

export function startAutomationScheduler(): void {
  if (timer != null) return;
  void reconcileAutomations()
    .then(() => tickAutomations())
    .catch(() => undefined);
  timer = setInterval(() => {
    void tickAutomations().catch(() => undefined);
  }, TICK_MS);
}

/**
 * Stops the tick. Profiles switch app-wide, so the automations of the profile
 * being left stop with its agents and terminals rather than running on against
 * another profile's database.
 */
export function stopAutomationScheduler(): void {
  if (timer != null) clearInterval(timer);
  timer = null;
}
