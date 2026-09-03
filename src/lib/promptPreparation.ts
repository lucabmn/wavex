import { applyFileMentionsToTurn } from "./files/fileMentions";
import { applyNotesToTurn } from "./notes";
import { applyPromptTemplatesToTurn } from "./project/promptTemplates";
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
  // Only a draft that carries a `/token` can hold a template, and looking one up
  // would otherwise delay the file lookup every turn pays for.
  if (slashTokensInText(text).length === 0) return resolveReferences(text);
  return applyPromptTemplatesToTurn(text, context).then(resolveReferences);
}
