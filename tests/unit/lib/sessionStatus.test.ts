import { describe, expect, it } from "vitest";
import {
  checkLabel,
  formatChangedFiles,
  formatCompactCount,
  gitDirty,
  gitStateLabel,
  gitStatShort,
  resolveAgentStatus,
  sessionStatusTooltip,
  statusTooltip,
  tabStatusTooltip,
  worktreeStatusTooltip,
} from "@/lib/sessionStatus";

describe("resolveAgentStatus", () => {
  it("prioritises approval over a running turn", () => {
    expect(resolveAgentStatus({ busy: true, needsApproval: true, unread: true })).toBe(
      "needs-approval",
    );
  });

  it("prefers working over an unread reply", () => {
    expect(resolveAgentStatus({ busy: true, needsApproval: false, unread: true })).toBe("working");
  });

  it("surfaces an unread reply once the turn lands", () => {
    expect(resolveAgentStatus({ busy: false, needsApproval: false, unread: true })).toBe("unread");
  });

  it("falls back to idle", () => {
    expect(resolveAgentStatus({ busy: false, needsApproval: false, unread: false })).toBe("idle");
  });
});

describe("git state", () => {
  it("counts a checkout dirty on files, additions, or deletions", () => {
    expect(gitDirty({ files: 1, additions: 0, deletions: 0 })).toBe(true);
    expect(gitDirty({ files: 0, additions: 0, deletions: 2 })).toBe(true);
    expect(gitDirty({ files: 0, additions: 0, deletions: 0 })).toBe(false);
    expect(gitDirty(null)).toBe(false);
  });

  it("labels clean versus changed checkouts", () => {
    expect(gitStateLabel({ files: 0, additions: 0, deletions: 0 })).toBe("Clean");
    expect(gitStateLabel({ files: 3, additions: 10, deletions: 2 })).toBe("3 files changed");
    expect(gitStateLabel(null)).toBe("Clean");
  });

  it("singularises one changed file", () => {
    expect(formatChangedFiles(1)).toBe("1 file changed");
    expect(formatChangedFiles(0)).toBe("");
  });

  it("compacts the diff stat", () => {
    expect(gitStatShort({ files: 2, additions: 12, deletions: 3 })).toBe("+12 -3");
    expect(gitStatShort({ files: 0, additions: 0, deletions: 0 })).toBe("");
  });
});

describe("checkLabel", () => {
  it("names zero problems as passing", () => {
    expect(checkLabel(0)).toBe("No problems");
  });

  it("singularises one problem", () => {
    expect(checkLabel(1)).toBe("1 problem");
  });

  it("pluralises the rest", () => {
    expect(checkLabel(4)).toBe("4 problems");
  });
});

describe("statusTooltip", () => {
  it("skips empty parts", () => {
    expect(statusTooltip(["a", "", undefined, null, false, "b"])).toBe("a · b");
  });
});

describe("sessionStatusTooltip", () => {
  it("combines agent, branch, git, and checks without color", () => {
    expect(
      sessionStatusTooltip({
        title: "Fix the parser",
        repo: "web",
        branch: "feat-x",
        agent: "needs-approval",
        git: { files: 2, additions: 10, deletions: 1 },
        checkErrors: 3,
      }),
    ).toBe("Fix the parser · Needs approval · web/feat-x · 2 files changed (+10 -1) · 3 problems");
  });

  it("states a clean checkout explicitly", () => {
    expect(
      sessionStatusTooltip({
        title: "Fix the parser",
        agent: "idle",
        git: { files: 0, additions: 0, deletions: 0 },
      }),
    ).toBe("Fix the parser · Idle · Clean");
  });
});

describe("worktreeStatusTooltip", () => {
  it("names missing folders, locks, work, and git state", () => {
    expect(
      worktreeStatusTooltip({
        label: "feat-x",
        path: "/repo/wt",
        busy: true,
        missing: false,
        locked: true,
        lockReason: "in use",
        git: { files: 1, additions: 4, deletions: 0 },
      }),
    ).toBe("feat-x · /repo/wt · Locked: in use · Working · 1 file changed (+4)");
  });
});

describe("tabStatusTooltip", () => {
  it("carries approval, reply, branch, git, unsaved, and check state", () => {
    expect(
      tabStatusTooltip({
        project: "web",
        conversation: "Fix the parser",
        files: ["parser.ts"],
        dirty: true,
        working: false,
        needsApproval: true,
        unread: true,
        branch: "feat-x",
        git: { files: 2, additions: 5, deletions: 0 },
        checkErrors: 2,
      }),
    ).toBe(
      "web · Fix the parser · parser.ts · Needs approval · New reply · Branch feat-x · 2 files changed (+5) · Unsaved changes · 2 problems",
    );
  });
});

describe("formatCompactCount", () => {
  it("leaves counts a row can fit alone", () => {
    expect(formatCompactCount(0)).toBe("0");
    expect(formatCompactCount(27)).toBe("27");
    expect(formatCompactCount(999)).toBe("999");
  });

  it("shortens the four- and five-digit counts a dirty checkout produces", () => {
    expect(formatCompactCount(1234)).toBe("1.2k");
    expect(formatCompactCount(8023)).toBe("8k");
    expect(formatCompactCount(12_345)).toBe("12k");
    expect(formatCompactCount(2_400_000)).toBe("2.4m");
  });

  it("treats junk as nothing to show", () => {
    expect(formatCompactCount(-5)).toBe("0");
    expect(formatCompactCount(Number.NaN)).toBe("0");
  });
});
