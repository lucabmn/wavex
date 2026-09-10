import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyFileMentionsToTurn: vi.fn(),
  applyNotesToTurn: vi.fn(),
  applySkillsToTurn: vi.fn(),
  events: [] as string[],
  slashTokensInText: vi.fn(() => []),
  warmPiSkills: vi.fn(),
  gitBranches: vi.fn(),
  gitStagedContext: vi.fn(),
  peekFocusedEditorPath: vi.fn(() => null as string | null),
}));

vi.mock("@/lib/files/fileMentions", () => ({
  applyFileMentionsToTurn: mocks.applyFileMentionsToTurn,
}));

vi.mock("@/lib/notes", () => ({
  applyNotesToTurn: mocks.applyNotesToTurn,
}));

vi.mock("@/lib/fs", () => ({
  gitBranches: mocks.gitBranches,
  gitStagedContext: mocks.gitStagedContext,
}));

vi.mock("@/lib/workspace/focusedFile", () => ({
  peekFocusedEditorPath: mocks.peekFocusedEditorPath,
}));

vi.mock("@/lib/skills", () => ({
  applySkillsToTurn: mocks.applySkillsToTurn,
  slashTokensInText: mocks.slashTokensInText,
  warmPiSkills: mocks.warmPiSkills,
}));

import { preparePrompt } from "@/lib/promptPreparation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.events.length = 0;
  mocks.applyFileMentionsToTurn.mockReset();
  mocks.applyNotesToTurn.mockReset();
  mocks.applyNotesToTurn.mockImplementation(async (text: string) => text);
  mocks.applySkillsToTurn.mockReset();
  mocks.warmPiSkills.mockReset();
  mocks.warmPiSkills.mockImplementation(() => {
    mocks.events.push("warm");
  });
  mocks.gitBranches.mockReset();
  mocks.gitStagedContext.mockReset();
  mocks.peekFocusedEditorPath.mockReset();
  mocks.peekFocusedEditorPath.mockReturnValue(null);
});

describe("preparePrompt", () => {
  it("starts warmup before awaiting file mentions", async () => {
    const files = deferred<string>();
    mocks.applyFileMentionsToTurn.mockImplementation(() => {
      mocks.events.push("files");
      return files.promise;
    });
    mocks.applySkillsToTurn.mockResolvedValue("prepared");

    const preparation = preparePrompt("hello", {
      harness: "pi",
      cwd: "/repo",
    });
    expect(mocks.events).toEqual(["warm", "files"]);

    files.resolve("with files");
    await expect(preparation).resolves.toBe("prepared");
    expect(mocks.applyNotesToTurn).toHaveBeenCalledWith("with files");
    expect(mocks.applySkillsToTurn).toHaveBeenCalledWith("with files", {
      harness: "pi",
      cwd: "/repo",
    });
  });

  it("expands a placeholder before the file lookup sees the draft", async () => {
    mocks.gitBranches.mockResolvedValue({ current: "feat/x", detached: false, branches: [] });
    mocks.applyFileMentionsToTurn.mockResolvedValue("mentions");
    mocks.applySkillsToTurn.mockResolvedValue("prepared");

    await preparePrompt("Review the work on {{branch}}", { harness: "pi", cwd: "/repo" });

    expect(mocks.applyFileMentionsToTurn).toHaveBeenCalledWith(
      "Review the work on feat/x",
      "/repo",
    );
  });

  it("turns `@{{file}}` into a mention of the file the editor is on", async () => {
    mocks.peekFocusedEditorPath.mockReturnValue("/repo/src/lib/paths.ts");
    mocks.applyFileMentionsToTurn.mockResolvedValue("mentions");
    mocks.applySkillsToTurn.mockResolvedValue("prepared");

    await preparePrompt("Explain @{{file}}", { harness: "pi", cwd: "/repo" });

    expect(mocks.applyFileMentionsToTurn).toHaveBeenCalledWith(
      "Explain @src/lib/paths.ts",
      "/repo",
    );
  });

  it("leaves a bare `@` when no file is open, which mentions ignore", async () => {
    mocks.applyFileMentionsToTurn.mockResolvedValue("mentions");
    mocks.applySkillsToTurn.mockResolvedValue("prepared");

    await preparePrompt("Explain @{{file}} please", { harness: "pi", cwd: "/repo" });

    expect(mocks.applyFileMentionsToTurn).toHaveBeenCalledWith("Explain @ please", "/repo");
  });
});
