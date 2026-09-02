/**
 * Reads each provider's own plan-limit report.
 *
 * Unlike the transcript scan these do talk to the provider — there is no other
 * source for a subscription's remaining headroom — so they are deliberately
 * kept apart from it and only run when the usage view asks.
 */
import { invoke } from "@tauri-apps/api/core";
import { fetchCodexRateLimits } from "../rateLimitsFetch";
import {
  errorPlanLimits,
  parseClaudePlanLimits,
  parseCodexPlanLimits,
  unavailablePlanLimits,
  type PlanLimits,
} from "./planLimits";

type ClaudeUsageFetch = {
  status: string;
  httpStatus?: number | null;
  body?: string | null;
  error?: string | null;
};

export async function fetchClaudePlanLimits(): Promise<PlanLimits> {
  try {
    const result = await invoke<ClaudeUsageFetch>("fetch_claude_usage");
    if (result.status === "ok" && result.body) return parseClaudePlanLimits(result.body);
    if (result.status === "unavailable") {
      return unavailablePlanLimits("claude", result.error?.trim() || "Claude is not signed in");
    }
    return errorPlanLimits("claude", result.error?.trim() || "Claude limits are unavailable");
  } catch (error) {
    return errorPlanLimits(
      "claude",
      error instanceof Error ? error.message : "Claude limits are unavailable",
    );
  }
}

/**
 * Codex answers over its app-server, which means spawning the CLI. The probe
 * lives in `rateLimitsFetch` and hands back its untouched payload, so the
 * status-bar chip and this view share one spawn.
 */
export async function fetchCodexPlanLimits(): Promise<PlanLimits> {
  let raw: unknown;
  const chip = await fetchCodexRateLimits((result) => {
    raw = result;
  });
  if (raw !== undefined) return parseCodexPlanLimits(raw);
  if (chip.status === "unavailable") {
    return unavailablePlanLimits("codex", chip.error?.trim() || "Codex is not signed in");
  }
  return errorPlanLimits("codex", chip.error?.trim() || "Codex limits are unavailable");
}
