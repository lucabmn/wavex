import { describe, expect, it } from "vitest";
import {
  assessQuota,
  availableQuotaFallbacks,
  confirmQuotaFallback,
  quotaFallbackPrompt,
  quotaNeedsFallback,
  QUOTA_DATA_MAX_AGE_MS,
} from "@/lib/quotaRouting";
import type { PlanLimits } from "@/lib/usage/planLimits";

const now = Date.parse("2026-09-02T12:00:00Z");

function limits(usedPercent: number, updatedAt = now): PlanLimits {
  return {
    provider: "claude",
    status: "ok",
    plan: null,
    windows: [{ id: "five_hour", label: "5-hour session", usedPercent, resetsAt: null }],
    updatedAt,
    error: null,
  };
}

describe("assessQuota", () => {
  it("warns at the pre-failure threshold and distinguishes a reached limit", () => {
    expect(assessQuota(limits(89), now)).toBe("safe");
    expect(assessQuota(limits(90), now)).toBe("warning");
    expect(assessQuota(limits(100), now)).toBe("reached");
    expect(quotaNeedsFallback(assessQuota(limits(90), now))).toBe(true);
  });

  it("uses the most constrained window", () => {
    const value = limits(20);
    value.windows.push({ id: "weekly", label: "Weekly", usedPercent: 101, resetsAt: null });
    expect(assessQuota(value, now)).toBe("reached");
  });

  it("does not route from missing, invalid, or stale data", () => {
    expect(assessQuota(null, now)).toBe("unknown");
    expect(assessQuota({ ...limits(99), status: "error" }, now)).toBe("unknown");
    expect(assessQuota(limits(99, now - QUOTA_DATA_MAX_AGE_MS - 1), now)).toBe("unknown");
    expect(assessQuota({ ...limits(99), windows: [] }, now)).toBe("unknown");
  });
});

describe("availableQuotaFallbacks", () => {
  const candidates = [
    {
      harness: "codex" as const,
      model: "codex:gpt-5",
      label: "Codex",
      cliAvailable: true,
      authenticated: true,
      configured: true,
    },
    {
      harness: "cursor" as const,
      model: "cursor:composer",
      label: "Cursor",
      cliAvailable: true,
      authenticated: false,
      configured: true,
    },
    {
      harness: "pi" as const,
      model: "pi:default",
      label: "Pi",
      cliAvailable: true,
      authenticated: true,
      configured: false,
    },
  ];

  it("only returns genuinely usable providers and excludes the current one", () => {
    expect(availableQuotaFallbacks("claude", candidates)).toEqual([candidates[0]]);
    expect(availableQuotaFallbacks("codex", candidates)).toEqual([]);
    expect(
      availableQuotaFallbacks("claude", [
        { ...candidates[0], cliAvailable: false },
        { ...candidates[0], authenticated: false },
      ]),
    ).toEqual([]);
  });
});

describe("quotaFallbackPrompt", () => {
  const candidate = {
    harness: "codex" as const,
    model: "codex:gpt-5",
    label: "Codex",
    cliAvailable: true,
    authenticated: true,
    configured: true,
  };

  it("explains the explicit handoff before the turn starts", () => {
    expect(quotaFallbackPrompt("Claude Code", "warning", [candidate])).toContain(
      "conversation, project, and worktree context",
    );
  });

  it("leaves the session untouched when the user declines", async () => {
    await expect(
      confirmQuotaFallback({
        providerLabel: "Claude Code",
        risk: "reached",
        candidates: [candidate],
        confirm: async () => false,
      }),
    ).resolves.toBeNull();
  });

  it("returns the selected fallback only after confirmation", async () => {
    await expect(
      confirmQuotaFallback({
        providerLabel: "Claude Code",
        risk: "warning",
        candidates: [candidate],
        confirm: async () => true,
      }),
    ).resolves.toEqual(candidate);
  });
});
