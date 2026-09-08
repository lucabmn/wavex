import type { HostId } from "../host";
import type { HarnessId } from "../session";
import { loadSkills, readSkillBody, type Skill } from "../skills";

export type GitWritingKind = "commit" | "pr" | "branch";

const MAX_SKILLS_PER_PROMPT = 3;
const MAX_SKILL_CHARS = 4_000;

const KIND_PATTERNS: Record<GitWritingKind, RegExp[]> = {
  commit: [/commit/, /conventional/],
  pr: [/pull-?request/, /(^|-)pr($|-)/, /commit/],
  branch: [/branch/, /git/],
};

/** Skill names that read like git-writing guidance for `kind`. Pure. */
export function isGitWritingSkill(name: string, kind: GitWritingKind): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  if (kind === "commit" || kind === "pr") {
    // Generic git skills also carry commit/PR conventions.
    if (normalized === "git" || normalized.startsWith("git-")) return true;
  }
  return KIND_PATTERNS[kind].some((pattern) => pattern.test(normalized));
}

/** Matching skills in catalog order, capped so prompts stay small. Pure. */
export function selectGitWritingSkills(
  skills: Pick<Skill, "name">[],
  kind: GitWritingKind,
  limit: number = MAX_SKILLS_PER_PROMPT,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    if (names.length >= limit) break;
    if (seen.has(skill.name)) continue;
    if (!isGitWritingSkill(skill.name, kind)) continue;
    seen.add(skill.name);
    names.push(skill.name);
  }
  return names;
}

/** Render loaded skill bodies as a prompt section. Pure. */
export function formatGitWritingSkills(
  kind: GitWritingKind,
  bodies: { name: string; body: string }[],
): string {
  const blocks = bodies
    .map(({ name, body }) => ({ name, body: body.trim().slice(0, MAX_SKILL_CHARS).trim() }))
    .filter((entry) => entry.body.length > 0);
  if (blocks.length === 0) return "";
  const lines = [
    `Project ${kind} skills. Follow every instruction in each skill body; when a skill conflicts with the rules above, the skill wins.`,
    "",
  ];
  for (const block of blocks) {
    lines.push(`## /${block.name}`, "", block.body, "");
  }
  return lines.join("\n").trimEnd();
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

/**
 * Load the bodies of project skills that read like `kind` guidance. Never
 * throws: without a readable skill the prompt simply stays as it was.
 */
export async function loadGitWritingSkillSection(input: {
  harness: HarnessId;
  cwd: string;
  kind: GitWritingKind;
  hostId?: HostId;
}): Promise<string> {
  let catalog: Skill[];
  try {
    catalog = await loadSkills({ harness: input.harness, cwd: input.cwd, hostId: input.hostId });
  } catch {
    return "";
  }
  const names = selectGitWritingSkills(catalog, input.kind);
  if (names.length === 0) return "";
  const bodies: { name: string; body: string }[] = [];
  await Promise.all(
    names.map(async (name) => {
      const skill = catalog.find((entry) => entry.name === name);
      if (!skill || (skill.kind !== "file" && skill.kind !== "builtin")) return;
      try {
        const body = truncate(await readSkillBody(skill), MAX_SKILL_CHARS);
        if (body) bodies.push({ name, body });
      } catch {
        // Unreadable skill: skip it rather than failing the generation.
      }
    }),
  );
  bodies.sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name));
  return formatGitWritingSkills(input.kind, bodies);
}
