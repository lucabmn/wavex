import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gitStagedContext: vi.fn(),
  gitBranches: vi.fn(),
}));

vi.mock("@/lib/fs", () => ({
  gitStagedContext: mocks.gitStagedContext,
  gitBranches: mocks.gitBranches,
}));

import {
  resolveTemplateVariables,
  substituteTemplateVariables,
  templateVariablesInText,
  type TemplateVariable,
} from "@/lib/project/templateVariables";

function values(entries: Record<string, string>): Map<TemplateVariable, string> {
  return new Map(Object.entries(entries) as [TemplateVariable, string][]);
}

beforeEach(() => {
  mocks.gitStagedContext.mockReset();
  mocks.gitBranches.mockReset();
});

describe("templateVariablesInText", () => {
  it("finds only the placeholders the registry knows", () => {
    const found = templateVariablesInText("On {{branch}} review {{diff}} and {{ticket}}");
    expect([...found].sort()).toEqual(["branch", "diff"]);
  });

  it("accepts padding and casing inside the braces", () => {
    expect([...templateVariablesInText("{{ File }}")]).toEqual(["file"]);
  });

  it("stays out of text with no braces", () => {
    expect(templateVariablesInText("review the branch").size).toBe(0);
  });
});

describe("substituteTemplateVariables", () => {
  it("replaces every occurrence of a known placeholder", () => {
    const text = substituteTemplateVariables(
      "{{branch}} then {{branch}}",
      values({ branch: "feat/x" }),
    );
    expect(text).toBe("feat/x then feat/x");
  });

  it("leaves an unknown placeholder exactly as it was typed", () => {
    const text = substituteTemplateVariables(
      "{{#each items}} {{branch}}",
      values({ branch: "main" }),
    );
    expect(text).toBe("{{#each items}} main");
  });

  it("drops a known placeholder that resolved to nothing", () => {
    expect(substituteTemplateVariables("file: {{file}}.", values({ file: "" }))).toBe("file: .");
  });

  it("keeps a known placeholder no one resolved", () => {
    expect(substituteTemplateVariables("{{diff}}", values({}))).toBe("{{diff}}");
  });
});

describe("resolveTemplateVariables", () => {
  it("asks for nothing when no placeholder is used", async () => {
    const resolved = await resolveTemplateVariables(new Set(), { cwd: "/repo" });
    expect(resolved.size).toBe(0);
    expect(mocks.gitStagedContext).not.toHaveBeenCalled();
    expect(mocks.gitBranches).not.toHaveBeenCalled();
  });

  it("resolves a branch without paying for a diff", async () => {
    mocks.gitBranches.mockResolvedValue({ current: "feat/x", detached: false, branches: [] });
    const resolved = await resolveTemplateVariables(new Set<TemplateVariable>(["branch"]), {
      cwd: "/repo",
    });
    expect(resolved.get("branch")).toBe("feat/x");
    expect(mocks.gitStagedContext).not.toHaveBeenCalled();
  });

  it("reuses the branch the diff already reported", async () => {
    mocks.gitStagedContext.mockResolvedValue({
      branch: "feat/x",
      summary: "1 file changed",
      patch: "diff --git a/a b/a",
    });
    const resolved = await resolveTemplateVariables(new Set<TemplateVariable>(["branch", "diff"]), {
      cwd: "/repo",
    });
    expect(resolved.get("branch")).toBe("feat/x");
    expect(resolved.get("diff")).toBe("diff --git a/a b/a");
    expect(mocks.gitBranches).not.toHaveBeenCalled();
  });

  it("falls back to the branch listing when the checkout is clean", async () => {
    mocks.gitStagedContext.mockRejectedValue(new Error("No changes to summarize"));
    mocks.gitBranches.mockResolvedValue({ current: "main", detached: false, branches: [] });
    const resolved = await resolveTemplateVariables(new Set<TemplateVariable>(["branch", "diff"]), {
      cwd: "/repo",
    });
    expect(resolved.get("diff")).toBe("");
    expect(resolved.get("branch")).toBe("main");
  });

  it("uses the summary when the patch is empty", async () => {
    mocks.gitStagedContext.mockResolvedValue({
      branch: "main",
      summary: "Untracked files:\nnew.txt",
      patch: "",
    });
    const resolved = await resolveTemplateVariables(new Set<TemplateVariable>(["diff"]), {
      cwd: "/repo",
    });
    expect(resolved.get("diff")).toBe("Untracked files:\nnew.txt");
  });

  it("caps a patch that would otherwise be pasted whole", async () => {
    const line = `${"+".repeat(79)}\n`;
    mocks.gitStagedContext.mockResolvedValue({
      branch: "main",
      summary: "",
      patch: line.repeat(2000),
    });
    const resolved = await resolveTemplateVariables(new Set<TemplateVariable>(["diff"]), {
      cwd: "/repo",
    });
    const diff = resolved.get("diff") ?? "";
    expect(diff.length).toBeLessThan(line.repeat(2000).length);
    expect(diff.endsWith("… diff truncated.")).toBe(true);
  });

  it("makes the open file relative to the checkout", async () => {
    const resolved = await resolveTemplateVariables(new Set<TemplateVariable>(["file"]), {
      cwd: "/repo",
      filePath: "/repo/src/lib/paths.ts",
    });
    expect(resolved.get("file")).toBe("src/lib/paths.ts");
  });

  it("resolves the open file to nothing when no file is open", async () => {
    const resolved = await resolveTemplateVariables(new Set<TemplateVariable>(["file"]), {
      cwd: "/repo",
      filePath: null,
    });
    expect(resolved.get("file")).toBe("");
  });
});
