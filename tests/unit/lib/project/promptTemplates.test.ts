import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadProjectFiles: vi.fn(),
}));

vi.mock("@/lib/files/fileIndex", () => ({
  loadProjectFiles: mocks.loadProjectFiles,
  rankProjectFiles: () => [],
}));

import { applyFileMentionsToTurn } from "@/lib/files/fileMentions";
import { noteSlugsInText } from "@/lib/notes";
import {
  expandTemplateTokens,
  insertTemplateBody,
  isValidTemplateName,
  rankPromptTemplates,
  slugTemplateName,
  templateProjectPath,
  templatePreview,
  type PromptTemplate,
} from "@/lib/project/promptTemplates";

function template(name: string, extra: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: name,
    projectKey: "/repo",
    projectPath: "/repo",
    name,
    description: "",
    body: `body of ${name}`,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

describe("rankPromptTemplates", () => {
  it("sorts by name without a query", () => {
    const ranked = rankPromptTemplates([template("review"), template("changelog")], "");
    expect(ranked.map((item) => item.name)).toEqual(["changelog", "review"]);
  });

  it("prefers a name match over a description match", () => {
    const ranked = rankPromptTemplates(
      [template("changelog", { description: "review the diff" }), template("review")],
      "review",
    );
    expect(ranked.map((item) => item.name)).toEqual(["review", "changelog"]);
  });

  it("drops templates that match neither name nor description", () => {
    expect(rankPromptTemplates([template("review")], "deploy")).toEqual([]);
  });
});

describe("insertTemplateBody", () => {
  it("replaces the slash token with editable text and leaves the cursor at the end", () => {
    const result = insertTemplateBody("/rev", { start: 0, end: 4 }, "Review this diff.");
    expect(result.text).toBe("Review this diff.");
    expect(result.cursor).toBe("Review this diff.".length);
  });

  it("keeps the text around the token and separates what follows", () => {
    const result = insertTemplateBody("hey /rev then", { start: 4, end: 8 }, "Review this diff.");
    expect(result.text).toBe("hey Review this diff. then");
    expect(result.cursor).toBe("hey Review this diff.".length);
  });

  it("normalizes newlines and trims trailing blank space from the body", () => {
    const result = insertTemplateBody("/rev", { start: 0, end: 4 }, "one\r\ntwo\n\n");
    expect(result.text).toBe("one\ntwo");
  });

  it("returns the draft unchanged for an empty body", () => {
    const result = insertTemplateBody("/rev", { start: 0, end: 4 }, "   ");
    expect(result.text).toBe("/rev");
    expect(result.cursor).toBe(4);
  });
});

describe("template names", () => {
  it("slugs a typed name into something the slash token accepts", () => {
    expect(slugTemplateName("Review Diff")).toBe("review-diff");
    expect(isValidTemplateName("review-diff")).toBe(true);
    expect(isValidTemplateName("Review Diff")).toBe(false);
  });
});

describe("templateProjectPath", () => {
  it("is null outside a project, so work chats offer no templates", () => {
    expect(templateProjectPath("~")).toBeNull();
    expect(templateProjectPath("")).toBeNull();
  });

  it("normalizes a project path", () => {
    expect(templateProjectPath("/repo/app/")).toBe("/repo/app");
  });
});

describe("templatePreview", () => {
  it("falls back to the first body line when there is no description", () => {
    expect(templatePreview(template("review", { body: "Review this diff.\nthen stop" }))).toBe(
      "Review this diff.",
    );
    expect(templatePreview(template("review", { description: "House review" }))).toBe(
      "House review",
    );
  });
});

describe("note references inside a template", () => {
  it("survive insertion, so the note is attached at submit", () => {
    const inserted = insertTemplateBody(
      "/recap",
      { start: 0, end: 6 },
      "Follow @note/release-checklist",
    ).text;
    expect(noteSlugsInText(inserted)).toEqual(["release-checklist"]);
  });
});

describe("expandTemplateTokens", () => {
  const templates = [
    template("review", { body: "Review this diff.\n" }),
    template("ship", { body: "Write the release note." }),
  ];

  it("expands a name the user typed instead of picking", () => {
    expect(expandTemplateTokens("/review please", templates, new Set())).toBe(
      "Review this diff. please",
    );
  });

  it("expands every token and keeps the text between them", () => {
    expect(expandTemplateTokens("a /review b /ship c", templates, new Set())).toBe(
      "a Review this diff. b Write the release note. c",
    );
  });

  it("leaves a name the skill catalog already owns alone", () => {
    expect(expandTemplateTokens("/review", templates, new Set(["review"]))).toBe("/review");
  });

  it("leaves unknown tokens and quoted lines alone", () => {
    expect(expandTemplateTokens("/deploy now", templates, new Set())).toBe("/deploy now");
    expect(expandTemplateTokens("> /review", templates, new Set())).toBe("> /review");
  });
});

describe("file mentions inside a template", () => {
  it("resolve exactly like the same text typed by hand", async () => {
    mocks.loadProjectFiles.mockResolvedValue([
      { name: "App.tsx", path: "/repo/src/App.tsx", relative: "src/App.tsx" },
    ]);
    const typed = "Explain @App.tsx";
    const inserted = insertTemplateBody("/exp", { start: 0, end: 4 }, "Explain @App.tsx").text;

    expect(inserted).toBe(typed);
    expect(await applyFileMentionsToTurn(inserted, "/repo")).toBe(
      await applyFileMentionsToTurn(typed, "/repo"),
    );
    expect(await applyFileMentionsToTurn(inserted, "/repo")).toContain("- @App.tsx → src/App.tsx");
  });
});
