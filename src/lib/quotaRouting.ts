import type { HarnessId } from "./session";
import type { PlanLimits } from "./usage/planLimits";

/** Start warning before a provider's next turn is likely to be rejected. */
export const QUOTA_WARNING_PERCENT = 90;
/** Do not make decisions from an old usage snapshot. */
export const QUOTA_DATA_MAX_AGE_MS = 30 * 60 * 1000;

export type QuotaRisk = "safe" | "warning" | "reached" | "unknown";

export type QuotaFallbackCandidate = {
  harness: HarnessId;
  model: string;
  label: string;
  /** The CLI was found and can be started on the session's host. */
  cliAvailable: boolean;
  /** The provider's authentication probe succeeded. */
  authenticated: boolean;
  /** A usable model and harness configuration were discovered. */
  configured: boolean;
};

export function assessQuota(
  limits: PlanLimits | null | undefined,
  now = Date.now(),
  threshold = QUOTA_WARNING_PERCENT,
): QuotaRisk {
  if (!limits || limits.status !== "ok" || limits.updatedAt <= 0) return "unknown";
  if (!Number.isFinite(now) || now < limits.updatedAt) return "unknown";
  if (now - limits.updatedAt > QUOTA_DATA_MAX_AGE_MS) return "unknown";

  const percentages = limits.windows
    .map((window) => window.usedPercent)
    .filter((percent) => Number.isFinite(percent) && percent >= 0);
  if (percentages.length === 0) return "unknown";

  const highest = Math.max(...percentages);
  if (highest >= 100) return "reached";
  return highest >= threshold ? "warning" : "safe";
}

export function quotaNeedsFallback(
  risk: QuotaRisk,
): risk is Extract<QuotaRisk, "warning" | "reached"> {
  return risk === "warning" || risk === "reached";
}

/**
 * Keep provider selection separate from the probes. This makes it impossible
 * for a caller to offer a provider merely because it has a model in the
 * built-in catalog: all three availability facts must be true.
 */
export function availableQuotaFallbacks(
  current: HarnessId,
  candidates: QuotaFallbackCandidate[],
): QuotaFallbackCandidate[] {
  return candidates.filter(
    (candidate) =>
      candidate.harness !== current &&
      candidate.model.trim() !== "" &&
      candidate.cliAvailable &&
      candidate.authenticated &&
      candidate.configured,
  );
}

export function quotaFallbackPrompt(
  providerLabel: string,
  risk: Exclude<QuotaRisk, "safe" | "unknown">,
  candidates: QuotaFallbackCandidate[],
): string {
  const reason = risk === "reached" ? "has reached" : "is close to reaching";
  const choices = candidates.map((candidate) => candidate.label).join(", ");
  return `${providerLabel} ${reason} its usage limit. Continue this session with ${choices}? Your conversation, project, and worktree context will be handed off to the selected provider.`;
}

/** Confirmation is kept as a seam so cancelling never mutates session state. */
export async function confirmQuotaFallback(input: {
  providerLabel: string;
  risk: Exclude<QuotaRisk, "safe" | "unknown">;
  candidates: QuotaFallbackCandidate[];
  confirm: (message: string) => Promise<boolean>;
}): Promise<QuotaFallbackCandidate | null> {
  const candidate = input.candidates[0];
  if (!candidate) return null;
  return (await input.confirm(
    quotaFallbackPrompt(input.providerLabel, input.risk, input.candidates),
  ))
    ? candidate
    : null;
}
