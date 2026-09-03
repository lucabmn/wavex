import { rankPromptTemplates, type PromptTemplate } from "./project/promptTemplates";
import { rankSkills, type Skill } from "./skills";

/**
 * One row of the `/` picker. Project templates and harness skills stay separate
 * types on purpose: a template is local prompt text and must keep working when
 * the session switches harness, which the skill catalog does not.
 */
export type ComposerPickerEntry =
  | { kind: "template"; template: PromptTemplate }
  | { kind: "skill"; skill: Skill };

/** Templates first: they are this project's own, and there are few of them. */
export function composerPickerEntries(input: {
  skills: Skill[];
  templates: PromptTemplate[];
  query: string;
  skillLimit?: number;
}): ComposerPickerEntry[] {
  const templates = rankPromptTemplates(input.templates, input.query);
  const skills = rankSkills(input.skills, input.query, input.skillLimit);
  return [
    ...templates.map((template): ComposerPickerEntry => ({ kind: "template", template })),
    ...skills.map((skill): ComposerPickerEntry => ({ kind: "skill", skill })),
  ];
}

export function pickerEntryKey(entry: ComposerPickerEntry): string {
  if (entry.kind === "template") return `template:${entry.template.id}`;
  const skill = entry.skill;
  return `skill:${skill.kind}:${skill.source}:${skill.invocation}`;
}
