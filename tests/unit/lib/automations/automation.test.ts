import { describe, expect, it } from "vitest";
import {
  automationDraft,
  duplicateDraft,
  newAutomationDraft,
  normalizeAutomation,
  validateAutomation,
  type Automation,
  type AutomationDraft,
} from "@/lib/automations/automation";

const NOW = Date.UTC(2025, 5, 1, 12, 0);

function draft(overrides: Partial<AutomationDraft> = {}): AutomationDraft {
  return {
    ...newAutomationDraft({
      projectRef: "/repo",
      cwd: "/repo",
      harness: "claude",
      nowMs: NOW,
    }),
    name: "Nightly triage",
    prompt: "Triage new issues",
    ...overrides,
  };
}

describe("newAutomationDraft", () => {
  it("never starts enabled", () => {
    expect(
      newAutomationDraft({ projectRef: "/repo", cwd: "/repo", harness: "claude" }).enabled,
    ).toBe(false);
  });
});

describe("validateAutomation", () => {
  const fields = (issues: { field: string }[]) => issues.map((issue) => issue.field);

  it("accepts a complete draft", () => {
    expect(validateAutomation(draft(), NOW)).toEqual([]);
  });

  it("reports every missing field at once", () => {
    const issues = validateAutomation({ name: "", prompt: "" }, NOW);
    expect(fields(issues)).toEqual(expect.arrayContaining(["name", "prompt", "target", "harness"]));
  });

  it("refuses an interval below the supported minimum", () => {
    const issues = validateAutomation(
      draft({ schedule: { kind: "interval", every: 1, unit: "minutes", anchorMs: NOW } }),
      NOW,
    );
    expect(fields(issues)).toEqual(["schedule"]);
    expect(issues[0].message).toContain("5 minutes");
  });

  it("refuses a weekly schedule with no days and a broken time", () => {
    const issues = validateAutomation(
      draft({ schedule: { kind: "weekly", days: [], time: "9am" } }),
      NOW,
    );
    expect(issues).toHaveLength(2);
  });

  it("refuses a one-time schedule in the past", () => {
    expect(
      fields(validateAutomation(draft({ schedule: { kind: "once", atMs: NOW - 1 } }), NOW)),
    ).toEqual(["schedule"]);
  });

  it("refuses end conditions that can never hold", () => {
    expect(fields(validateAutomation(draft({ maxRuns: 0 }), NOW))).toEqual(["maxRuns"]);
    expect(fields(validateAutomation(draft({ endAtMs: NOW - 1 }), NOW))).toEqual(["endAtMs"]);
  });

  it("refuses a time zone this machine cannot resolve", () => {
    expect(fields(validateAutomation(draft({ timeZone: "Mars/Olympus" }), NOW))).toEqual([
      "timeZone",
    ]);
  });
});

describe("normalizeAutomation", () => {
  it("repairs a row with unusable values instead of dropping it", () => {
    const automation = normalizeAutomation({
      id: "a1",
      name: "Weekly digest",
      prompt: "Summarize the week",
      projectRef: "/repo",
      cwd: "/repo",
      hostId: "not a host id!",
      harness: "nonesuch",
      runtimeMode: "yolo",
      schedule: { kind: "cron", expression: "*" },
      timeZone: "Mars/Olympus",
      dstPolicy: "melt",
      overlapPolicy: "stack",
      missedPolicy: "replay",
      enabled: true,
      nextDueAt: "later",
      runCount: -4,
      createdAt: 1,
      updatedAt: 2,
    });
    expect(automation).toMatchObject({
      hostId: "local",
      harness: "claude",
      runtimeMode: "supervised",
      timeZone: "UTC",
      dstPolicy: "shift",
      overlapPolicy: "skip",
      missedPolicy: "once",
      schedule: { kind: "weekly" },
      nextDueAt: null,
      runCount: 0,
      notify: true,
    });
  });

  it("drops a row with no id", () => {
    expect(normalizeAutomation({ name: "orphan" })).toBeNull();
    expect(normalizeAutomation(null)).toBeNull();
  });
});

describe("automationDraft", () => {
  it("carries every setting the form can change, including the end conditions", () => {
    const source: Automation = {
      ...draft({
        overlapPolicy: "queue",
        missedPolicy: "skip",
        dstPolicy: "skip",
        runtimeMode: "auto",
        notify: false,
        maxRuns: 5,
        endAtMs: NOW + 86_400_000,
      }),
      id: "a1",
      enabled: true,
      nextDueAt: NOW,
      runCount: 2,
      pausedReason: "",
      createdAt: 1,
      updatedAt: 2,
    };
    const {
      id: _id,
      nextDueAt: _next,
      runCount: _count,
      pausedReason: _reason,
      createdAt: _created,
      updatedAt: _updated,
      ...settings
    } = source;
    expect(automationDraft(source)).toEqual(settings);
  });
});

describe("duplicateDraft", () => {
  it("copies the settings but never the state or the enabled flag", () => {
    const source: Automation = {
      ...draft({ name: "Nightly triage" }),
      id: "a1",
      enabled: true,
      nextDueAt: NOW,
      lastRunAt: NOW,
      runCount: 12,
      pausedReason: "failures",
      createdAt: 1,
      updatedAt: 2,
    };
    const copy = duplicateDraft(source);
    expect(copy.name).toBe("Nightly triage copy");
    expect(copy.enabled).toBe(false);
    expect(copy.prompt).toBe(source.prompt);
    expect(copy).not.toHaveProperty("runCount");
  });
});
