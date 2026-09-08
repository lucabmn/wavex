import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultSessionChoice,
  gitWritingChoice,
  gitWritingModelNativeId,
  loadGitWritingChoice,
  saveGitWritingChoice,
} from "@/lib/models";
import { orderTextHarnesses } from "@/lib/harness/textHarness";
import {
  formatGitWritingSkills,
  isGitWritingSkill,
  selectGitWritingSkills,
} from "@/lib/harness/gitWritingSkills";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
      clear: () => {
        data.clear();
      },
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
    configurable: true,
  });
}

describe("text harness order", () => {
  it("puts the configured git-writing provider before the session preference", () => {
    expect(orderTextHarnesses("grok", "claude")).toEqual([
      "grok",
      "claude",
      "cursor",
      "codex",
      "opencode",
    ]);
  });

  it("does not repeat the provider when it is already configured", () => {
    expect(orderTextHarnesses("cursor", "cursor")).toEqual([
      "cursor",
      "claude",
      "codex",
      "grok",
      "opencode",
    ]);
  });

  it("falls back to the session preference when nothing is configured", () => {
    expect(orderTextHarnesses("cursor", undefined)[0]).toBe("cursor");
  });
});

describe("git-writing choice", () => {
  beforeEach(mockLocalStorage);

  it("starts unset and follows the new-session default", () => {
    expect(loadGitWritingChoice()).toBeNull();
    expect(gitWritingChoice()).toEqual(defaultSessionChoice());
  });

  it("round-trips the saved provider and model", () => {
    saveGitWritingChoice("grok", "grok:grok-4.6");
    expect(loadGitWritingChoice()).toEqual({ harness: "grok", model: "grok:grok-4.6" });
    expect(gitWritingChoice()).toEqual({ harness: "grok", model: "grok:grok-4.6" });
  });

  it("resolves the native id for the configured provider only", () => {
    saveGitWritingChoice("claude", "claude:opus-5");
    expect(gitWritingModelNativeId("claude")).toBe("claude-opus-5");
    expect(gitWritingModelNativeId("cursor")).toBeUndefined();
  });

  it("keeps an unknown slug usable before the live catalog lands", () => {
    saveGitWritingChoice("codex", "codex:some-future-model");
    expect(gitWritingModelNativeId("codex")).toBe("some-future-model");
  });

  it("rejects a compound id that belongs to another provider", () => {
    saveGitWritingChoice("cursor", "claude:opus-5");
    expect(gitWritingModelNativeId("cursor")).toBeUndefined();
    expect(gitWritingModelNativeId("claude")).toBeUndefined();
  });
});

describe("git-writing skills", () => {
  it("matches commit skills for commits and PRs, not branches", () => {
    expect(isGitWritingSkill("commits", "commit")).toBe(true);
    expect(isGitWritingSkill("conventional-commits", "commit")).toBe(true);
    expect(isGitWritingSkill("commits", "pr")).toBe(true);
    expect(isGitWritingSkill("commits", "branch")).toBe(false);
  });

  it("matches PR and branch skills by name", () => {
    expect(isGitWritingSkill("review-pr", "pr")).toBe(true);
    expect(isGitWritingSkill("pull-request", "pr")).toBe(true);
    expect(isGitWritingSkill("branch", "branch")).toBe(true);
    expect(isGitWritingSkill("branch-naming", "branch")).toBe(true);
    expect(isGitWritingSkill("branch", "commit")).toBe(false);
  });

  it("treats generic git skills as commit and PR guidance", () => {
    expect(isGitWritingSkill("git", "commit")).toBe(true);
    expect(isGitWritingSkill("git", "pr")).toBe(true);
    expect(isGitWritingSkill("architect", "commit")).toBe(false);
    expect(isGitWritingSkill("architect", "pr")).toBe(false);
    expect(isGitWritingSkill("architect", "branch")).toBe(false);
  });

  it("selects matching skills in catalog order with a cap", () => {
    const skills = [
      { name: "architect" },
      { name: "commits" },
      { name: "review-pr" },
      { name: "commits" },
    ];
    expect(selectGitWritingSkills(skills, "commit")).toEqual(["commits"]);
    expect(selectGitWritingSkills(skills, "pr")).toEqual(["commits", "review-pr"]);
    expect(selectGitWritingSkills(skills, "pr", 1)).toEqual(["commits"]);
    expect(selectGitWritingSkills(skills, "branch")).toEqual([]);
  });

  it("formats bodies as a prompt section and skips empties", () => {
    expect(formatGitWritingSkills("commit", [])).toBe("");
    const section = formatGitWritingSkills("commit", [
      { name: "commits", body: "Use Conventional Commits." },
      { name: "empty", body: "   " },
    ]);
    expect(section).toContain("## /commits");
    expect(section).toContain("Use Conventional Commits.");
    expect(section).not.toContain("## /empty");
  });
});
