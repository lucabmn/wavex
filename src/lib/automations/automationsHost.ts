/**
 * Typed calls into the automation store.
 *
 * Definitions live on the host this client leaves unqualified — the desktop's
 * own machine, or the host that served a browser tab — because that is the
 * machine whose clock ticks them. The project an automation targets may belong
 * to another host, which is why every record carries its own `hostId`: the
 * turn is dispatched there, and a target host that is not reachable is a
 * failed run rather than a run somewhere else.
 */

import { invoke } from "../transport";
import {
  normalizeAutomation,
  normalizeRun,
  type Automation,
  type AutomationDraft,
  type AutomationRun,
  type PausedReason,
  type RunStatus,
} from "./automation";

type AutomationUpsert = AutomationDraft & {
  id: string;
  nextDueAt: number | null;
  pausedReason: PausedReason;
};

export async function listAutomations(): Promise<Automation[]> {
  const rows = await invoke<unknown[]>("automations_list");
  return rows.map(normalizeAutomation).filter((row): row is Automation => row != null);
}

export async function saveAutomation(automation: AutomationUpsert): Promise<Automation> {
  const saved = await invoke<unknown>("automations_upsert", { automation });
  const normalized = normalizeAutomation(saved);
  if (!normalized) throw new Error("The host returned an automation wavex could not read");
  return normalized;
}

export function removeAutomation(id: string): Promise<void> {
  return invoke<void>("automations_delete", { id });
}

/**
 * Enablement, the booked instant, and the reason it is parked move together.
 * A paused automation holding a stale next run would fire the moment it came
 * back rather than at its next real occurrence.
 */
export async function setAutomationState(input: {
  id: string;
  enabled: boolean;
  nextDueAt: number | null;
  pausedReason: PausedReason;
}): Promise<Automation | null> {
  const row = await invoke<unknown>("automations_set_state", input);
  return normalizeAutomation(row);
}

export function setAllAutomationsPaused(paused: boolean): Promise<boolean> {
  return invoke<boolean>("automations_set_all_paused", { paused });
}

export function readAllAutomationsPaused(): Promise<boolean> {
  return invoke<boolean>("automations_all_paused");
}

export async function listAutomationRuns(input: {
  automationId?: string;
  limit?: number;
}): Promise<AutomationRun[]> {
  const rows = await invoke<unknown[]>("automation_runs_list", {
    automationId: input.automationId ?? null,
    limit: input.limit ?? null,
  });
  return rows.map(normalizeRun).filter((row): row is AutomationRun => row != null);
}

/**
 * Claim a due occurrence. `null` means another window already holds it, or the
 * occurrence has already been run — the check and the insert share one
 * transaction on the host, so this is the only guard the callers need.
 */
export async function startAutomationRun(input: {
  automationId: string;
  runId: string;
  dueAt: number;
  manual?: boolean;
}): Promise<AutomationRun | null> {
  const row = await invoke<unknown>("automation_run_start", {
    automationId: input.automationId,
    runId: input.runId,
    dueAt: input.dueAt,
    manual: input.manual === true,
  });
  return normalizeRun(row);
}

export function attachRunSession(runId: string, sessionId: string): Promise<void> {
  return invoke<void>("automation_run_attach_session", { runId, sessionId });
}

export async function finishAutomationRun(input: {
  runId: string;
  status: RunStatus;
  error?: string;
  summary?: string;
}): Promise<AutomationRun | null> {
  const row = await invoke<unknown>("automation_run_finish", {
    runId: input.runId,
    status: input.status,
    error: input.error ?? null,
    summary: input.summary ?? null,
  });
  return normalizeRun(row);
}

/**
 * Renew the lease on the runs this window is driving. A run that stops being
 * renewed is one whose driver is gone, and `reconcileAutomationRuns` settles
 * it so it stops blocking the automation.
 */
export function heartbeatAutomationRuns(runIds: string[]): Promise<void> {
  if (runIds.length === 0) return Promise.resolve();
  return invoke<void>("automation_runs_heartbeat", { runIds });
}

/** Settles runs a crash, a quit, or a closed window left marked as going. */
export function reconcileAutomationRuns(): Promise<number> {
  return invoke<number>("automation_runs_reconcile");
}
