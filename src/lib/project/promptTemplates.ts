import { invoke } from "@tauri-apps/api/core";
import { fuzzyMatch } from "../fuzzy";
import { normalizeProjectPath, pathKey } from "../paths";
import { looksLikeProject } from "../recents";
import {
  isValidSkillName,
  peekSkills,
  slashTokensInText,
  slugSkillName,
  type SkillCatalogContext,
} from "../skills";

/**
 * A prompt the user keeps for one project: plain text inserted into the
 * composer, never a harness instruction. Switching provider or model leaves the
 * list untouched, which is the whole point of keeping it off the skill catalog.
 */
export type PromptTemplate = {
  id: string;
  projectKey: string;
  projectPath: string;
  name: string;
  description: string;
  body: string;
  createdAt: number;
  updatedAt: number;
};

export type PromptTemplateDraft = {
  id: string;
  projectKey: string;
  projectPath: string;
  name: string;
  description: string;
  body: string;
};

export type PromptTemplateToken = {
  start: number;
  end: number;
};

const MAX_PICKER = 20;
const MAX_PREVIEW = 120;

const cache = new Map<string, PromptTemplate[]>();
const inflight = new Map<string, Promise<PromptTemplate[]>>();

/**
 * Templates are filed under the project folder they were created in, the same
 * path the rail and the session store key on. A worktree is its own project
 * here: deriving a repository from it would depend on whether a worktree
 * listing has run yet, and a key that changes underneath the store is a list
 * that appears to lose prompts.
 */
export function templateProjectPath(cwd: string): string | null {
  if (!cwd || !looksLikeProject(cwd)) return null;
  return normalizeProjectPath(cwd);
}

/** Comparison key the store rows are filed under. */
export function templateProjectKey(cwd: string): string | null {
  const path = templateProjectPath(cwd);
  return path ? pathKey(path) : null;
}

export function peekPromptTemplates(projectKey: string | null): PromptTemplate[] | null {
  return projectKey ? (cache.get(projectKey) ?? null) : [];
}

export function invalidatePromptTemplates(projectKey?: string) {
  if (!projectKey) {
    cache.clear();
    return;
  }
  cache.delete(projectKey);
}

export async function loadPromptTemplates(
  projectKey: string | null,
  refresh = false,
): Promise<PromptTemplate[]> {
  if (!projectKey) return [];
  if (!refresh) {
    const cached = cache.get(projectKey);
    if (cached) return cached;
    const pending = inflight.get(projectKey);
    if (pending) return pending;
  }

  const promise = invoke<PromptTemplate[]>("prompt_templates_list", { projectKey })
    .then((templates) => {
      cache.set(projectKey, templates);
      return templates;
    })
    .finally(() => {
      if (inflight.get(projectKey) === promise) inflight.delete(projectKey);
    });
  inflight.set(projectKey, promise);
  return promise;
}

export async function savePromptTemplate(draft: PromptTemplateDraft): Promise<PromptTemplate> {
  const saved = await invoke<PromptTemplate>("prompt_templates_upsert", { template: draft });
  invalidatePromptTemplates(draft.projectKey);
  return saved;
}

export async function deletePromptTemplate(template: PromptTemplate): Promise<void> {
  await invoke("prompt_templates_delete", { id: template.id });
  invalidatePromptTemplates(template.projectKey);
}

/** How many templates removing this project would take with it. */
export async function projectPromptTemplateCount(cwd: string): Promise<number> {
  const templates = await loadPromptTemplates(templateProjectKey(cwd)).catch(() => []);
  return templates.length;
}

/** Called when a project is removed from the rail, alongside its saved chats. */
export async function deleteProjectPromptTemplates(cwd: string): Promise<void> {
  const projectKey = templateProjectKey(cwd);
  if (!projectKey) return;
  await invoke("prompt_templates_delete_project", { projectKey });
  invalidatePromptTemplates(projectKey);
}

export function newPromptTemplateDraft(
  projectPath: string | null,
  name = "",
): PromptTemplateDraft | null {
  if (!projectPath) return null;
  return {
    id: crypto.randomUUID(),
    projectKey: pathKey(projectPath),
    projectPath,
    name: slugTemplateName(name),
    description: "",
    body: "",
  };
}

export function promptTemplateDraft(template: PromptTemplate): PromptTemplateDraft {
  return {
    id: template.id,
    projectKey: template.projectKey,
    projectPath: template.projectPath,
    name: template.name,
    description: template.description,
    body: template.body,
  };
}

/** Names have to be typeable in the `/slash` token, so they follow skill names. */
export function slugTemplateName(raw: string): string {
  return slugSkillName(raw);
}

export function isValidTemplateName(name: string): boolean {
  return isValidSkillName(name);
}

export function rankPromptTemplates(
  templates: PromptTemplate[],
  query: string,
  limit = MAX_PICKER,
): PromptTemplate[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...templates].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  }

  const scored: { template: PromptTemplate; score: number }[] = [];
  for (const template of templates) {
    const nameHit = fuzzyMatch(needle, template.name);
    const descriptionHit = nameHit ? null : fuzzyMatch(needle, template.description);
    const hit = nameHit ?? descriptionHit;
    if (!hit) continue;
    scored.push({ template, score: nameHit ? hit.score + 400 : hit.score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.template.name.localeCompare(b.template.name);
  });
  return scored.slice(0, limit).map((row) => row.template);
}

/** Secondary line in the picker: the description, or what the prompt opens with. */
export function templatePreview(template: PromptTemplate): string {
  const description = template.description.trim();
  if (description) return description;
  const first = template.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!first) return "";
  return first.length > MAX_PREVIEW ? `${first.slice(0, MAX_PREVIEW - 1)}…` : first;
}

/**
 * Expand the template where the user typed `/name`. The body lands as ordinary
 * editable text — no turn is sent — so `@file` mentions inside it are resolved
 * at submit exactly as if they had been typed.
 */
export function insertTemplateBody(
  text: string,
  token: PromptTemplateToken,
  body: string,
): { text: string; cursor: number } {
  const content = body.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  if (!content) return { text, cursor: token.end };

  const before = text.slice(0, token.start);
  const rest = text.slice(token.end);
  const spacer = rest && !/^\s/.test(rest) ? " " : "";
  return {
    text: `${before}${content}${spacer}${rest}`,
    cursor: before.length + content.length,
  };
}

/**
 * Expand `/name` tokens the user typed instead of picking. Skills own the slash
 * namespace, so a name the catalog already answers for is left alone rather than
 * shadowed by a template.
 */
export function expandTemplateTokens(
  text: string,
  templates: PromptTemplate[],
  reserved: ReadonlySet<string>,
): string {
  const bodies = new Map<string, string>();
  for (const template of templates) {
    if (reserved.has(template.name)) continue;
    const body = template.body.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
    if (body) bodies.set(template.name, body);
  }
  if (bodies.size === 0) return text;

  let out = text;
  // Right to left: replacing a token shifts every offset after it.
  for (const hit of slashTokensInText(text).reverse()) {
    const body = bodies.get(hit.name);
    if (!body) continue;
    out = `${out.slice(0, hit.start)}${body}${out.slice(hit.end)}`;
  }
  return out;
}

/**
 * A template written by hand has to reach the harness as its prompt, not as the
 * literal `/name`. Runs before file mentions so a body's `@file` resolves like a
 * typed one.
 */
export async function applyPromptTemplatesToTurn(
  text: string,
  context: SkillCatalogContext,
): Promise<string> {
  if (slashTokensInText(text).length === 0) return text;
  const projectKey = templateProjectKey(context.cwd);
  if (!projectKey) return text;
  const templates = await loadPromptTemplates(projectKey).catch(() => []);
  if (templates.length === 0) return text;
  const reserved = new Set((peekSkills(context) ?? []).map((skill) => skill.invocation));
  return expandTemplateTokens(text, templates, reserved);
}
