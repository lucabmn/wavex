import { describe, expect, it } from "vitest";
import { branchSlug, suggestWorktreePath, worktreesRoot } from "@/lib/worktrees/worktreePaths";

describe("branchSlug", () => {
  it("folds a namespaced branch into one folder name", () => {
    expect(branchSlug("feature/checkout-flow")).toBe("feature-checkout-flow");
  });

  it("keeps the name filesystem-safe", () => {
    expect(branchSlug("fix: ünïcode & spaces")).toBe("fix-unicode-spaces");
    expect(branchSlug("../escape")).toBe("escape");
    expect(branchSlug("a//b")).toBe("a-b");
  });

  it("never returns an empty or dot-edged name", () => {
    expect(branchSlug("")).toBe("worktree");
    expect(branchSlug("///")).toBe("worktree");
    expect(branchSlug(".hidden.")).toBe("hidden");
    expect(branchSlug("release/v1.2")).toBe("release-v1-2");
  });

  it("caps the length so the path stays usable", () => {
    expect(branchSlug("x".repeat(200))).toHaveLength(64);
  });
});

describe("worktreesRoot", () => {
  it("groups a repository's worktrees under the home directory", () => {
    expect(worktreesRoot("/Users/me", "/Users/me/code/app")).toBe("/Users/me/.wavex/worktrees/app");
  });

  it("slugs a repository folder that would read as an app bundle", () => {
    expect(worktreesRoot("/Users/me", "/Users/me/code/desktop.app")).toBe(
      "/Users/me/.wavex/worktrees/desktop-app",
    );
  });

  it("ignores trailing slashes on either side", () => {
    expect(worktreesRoot("/Users/me/", "/Users/me/code/app/")).toBe(
      "/Users/me/.wavex/worktrees/app",
    );
  });
});

describe("suggestWorktreePath", () => {
  const home = "/Users/me";
  const repo = "/Users/me/code/app";

  it("names the folder after the branch", () => {
    expect(suggestWorktreePath(home, repo, "feature/login")).toBe(
      "/Users/me/.wavex/worktrees/app/feature-login",
    );
  });

  it("keeps branches that slug the same way apart", () => {
    const taken = ["/Users/me/.wavex/worktrees/app/feature-login"];
    expect(suggestWorktreePath(home, repo, "feature-login", taken)).toBe(
      "/Users/me/.wavex/worktrees/app/feature-login-2",
    );
  });

  it("keeps counting past the second collision", () => {
    const taken = ["/Users/me/.wavex/worktrees/app/wip", "/Users/me/.wavex/worktrees/app/wip-2/"];
    expect(suggestWorktreePath(home, repo, "wip", taken)).toBe(
      "/Users/me/.wavex/worktrees/app/wip-3",
    );
  });
});
