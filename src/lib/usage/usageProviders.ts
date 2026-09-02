import { HARNESS_LABEL } from "../session";
import type { UsageProvider } from "./usageTypes";

/**
 * Series colours for the usage chart.
 *
 * The rest of the app is deliberately monochrome, but a stacked chart has to
 * separate its series, so these are mid-tone hues that hold their contrast on
 * both the light and the dark ground rather than a per-theme pair.
 */
export const USAGE_PROVIDER_COLOR: Record<UsageProvider, string> = {
  claude: "#c96442",
  codex: "#7c8896",
  pi: "#5b8def",
  omp: "#9b7bea",
  grok: "#3fa88a",
};

export function usageProviderLabel(provider: UsageProvider): string {
  return HARNESS_LABEL[provider];
}
