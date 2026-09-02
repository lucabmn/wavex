import { describe, expect, it } from "vitest";
import {
  checkedOutElsewhere,
  worktreeHasLocalChanges,
  worktreeLabel,
  type Worktree,
} from "@/lib/worktrees/worktrees";

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    path: "/trees/app/feature",
    branch: "feature",
    head: "abc1234def",
    main: false,
    detached: false,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    missing: false,
    ...overrides,
  };
}

describe("worktreeLabel", () => {
  it("prefers the branch", () => {
    expect(worktreeLabel(worktree())).toBe("feature");
  });

  it("falls back to a short head, then the folder", () => {
    expect(worktreeLabel(worktree({ branch: null, detached: true }))).toBe("abc1234");
    expect(worktreeLabel(worktree({ branch: null, head: null }))).toBe("feature");
  });
});

describe("checkedOutElsewhere", () => {
  it("finds the worktree git points at", () => {
    expect(
      checkedOutElsewhere(
        "fatal: 'feature' is already used by worktree at '/Users/me/.wavex/worktrees/app/feature'",
      ),
    ).toBe("/Users/me/.wavex/worktrees/app/feature");
  });

  it("reads the older wording too", () => {
    expect(
      checkedOutElsewhere("fatal: 'main' is already checked out at '/Users/me/code/app'"),
    ).toBe("/Users/me/code/app");
  });

  it("stays out of the way of unrelated failures", () => {
    expect(checkedOutElsewhere("fatal: not a git repository")).toBeNull();
  });
});

describe("worktreeHasLocalChanges", () => {
  it("detects the refusal that needs --force", () => {
    expect(
      worktreeHasLocalChanges(
        "fatal: '/trees/app/feature' contains modified or untracked files, use --force to delete it",
      ),
    ).toBe(true);
    expect(worktreeHasLocalChanges("fatal: '/trees/app/feature' is a main working tree")).toBe(
      false,
    );
  });
});
