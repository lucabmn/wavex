import type { HostId } from "../host";
import type { HarnessId } from "../session";
import { gitWritingChoice } from "../models";
import type { PrContent } from "../gitText";
import {
  generateHarnessBranchName,
  generateHarnessCommitMessage,
  generateHarnessPrContent,
  warmupHarnessText,
} from "./registry";
import { isHarnessAvailable } from "./availability";

const TEXT_HARNESSES: HarnessId[] = ["claude", "cursor", "codex", "grok", "opencode"];

/**
 * Order text harnesses without touching availability state, so the policy is
 * unit-testable: the configured git-writing provider first, then the
 * caller's preference (the active session's provider), then the rest in
 * catalog order.
 */
export function orderTextHarnesses(configured: HarnessId, preferred?: HarnessId): HarnessId[] {
  const rest = TEXT_HARNESSES.filter((id) => id !== configured && id !== preferred);
  return [
    ...(TEXT_HARNESSES.includes(configured) ? [configured] : []),
    ...(preferred && preferred !== configured && TEXT_HARNESSES.includes(preferred)
      ? [preferred]
      : []),
    ...rest,
  ];
}

/** Pick the harness used for commit messages, PR text, and branch names. */
export function pickTextHarness(preferred?: HarnessId): HarnessId {
  const configured = gitWritingChoice().harness;
  for (const id of orderTextHarnesses(configured, preferred)) {
    if (isHarnessAvailable(id)) return id;
  }
  if (TEXT_HARNESSES.includes(configured)) return configured;
  return preferred && TEXT_HARNESSES.includes(preferred) ? preferred : "cursor";
}

export function warmupText(cwd: string, preferred?: HarnessId): Promise<void> {
  return warmupHarnessText(pickTextHarness(preferred), cwd);
}

export function generateCommitMessage(cwd: string, preferred?: HarnessId): Promise<string> {
  return generateHarnessCommitMessage(pickTextHarness(preferred), cwd);
}

export function generatePrContent(
  cwd: string,
  preferred?: HarnessId,
): Promise<(PrContent & { base: string; head: string }) | null> {
  return generateHarnessPrContent(pickTextHarness(preferred), cwd);
}

export function generateBranchName(
  cwd: string,
  message: string,
  preferred?: HarnessId,
  hostId?: HostId,
): Promise<string | null> {
  return generateHarnessBranchName(pickTextHarness(preferred), cwd, message, hostId);
}
