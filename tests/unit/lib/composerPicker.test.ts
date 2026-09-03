import { describe, expect, it } from "vitest";
import { composerPickerEntries, pickerEntryKey } from "@/lib/composerPicker";
import type { PromptTemplate } from "@/lib/project/promptTemplates";
import type { Skill } from "@/lib/skills";

const skill: Skill = {
  kind: "file",
  name: "review",
  description: "Review a diff",
  invocation: "review",
  path: "/repo/.agents/skills/review/SKILL.md",
  scope: "project",
  source: "agents",
};

const template: PromptTemplate = {
  id: "t1",
  projectKey: "/repo",
  projectPath: "/repo",
  name: "review",
  description: "House review checklist",
  body: "Review this diff.",
  createdAt: 1,
  updatedAt: 1,
};

describe("composerPickerEntries", () => {
  it("lists project templates before harness skills", () => {
    const entries = composerPickerEntries({ skills: [skill], templates: [template], query: "" });
    expect(entries.map((entry) => entry.kind)).toEqual(["template", "skill"]);
  });

  it("filters both lists with the same query", () => {
    const entries = composerPickerEntries({
      skills: [skill],
      templates: [template],
      query: "deploy",
    });
    expect(entries).toEqual([]);
  });

  it("keeps a template and a skill of the same name apart", () => {
    const entries = composerPickerEntries({ skills: [skill], templates: [template], query: "rev" });
    expect(new Set(entries.map(pickerEntryKey)).size).toBe(2);
  });

  it("shows skills alone when the project has no templates", () => {
    const entries = composerPickerEntries({ skills: [skill], templates: [], query: "" });
    expect(entries).toEqual([{ kind: "skill", skill }]);
  });
});
