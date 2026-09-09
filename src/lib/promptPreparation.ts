import { applyFileMentionsToTurn } from "./files/fileMentions";
import { applyNotesToTurn } from "./notes";
import { applyPromptTemplatesToTurn } from "./project/promptTemplates";
import { applyTemplateVariablesToTurn, templateVariablesInText } from "./project/templateVariables";
import {
  applySkillsToTurn,
  slashTokensInText,
  warmPiSkills,
  type SkillCatalogContext,
} from "./skills";

export function preparePrompt(text: string, context: SkillCatalogContext): Promise<string> {
  warmPiSkills(context);
  const resolveReferences = (draft: string) =>
    applyFileMentionsToTurn(draft, context.cwd)
      .then(applyNotesToTurn)
      .then((withNotes) => applySkillsToTurn(withNotes, context));
  // Placeholders expand before mentions, so `@{{file}}` reaches the harness as
  // that file's contents while a bare `{{file}}` stays the path. A draft
  // carrying none must reach the file lookup in this tick, as it did before
  // there were any.
  const expandVariables = (draft: string) =>
    templateVariablesInText(draft).size === 0
      ? resolveReferences(draft)
      : applyTemplateVariablesToTurn(draft, context).then(resolveReferences);
  // Only a draft that carries a `/token` can hold a template, and looking one up
  // would otherwise delay the file lookup every turn pays for.
  if (slashTokensInText(text).length === 0) return expandVariables(text);
  return applyPromptTemplatesToTurn(text, context).then(expandVariables);
}
