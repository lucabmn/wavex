/**
 * The installed skill library, as the settings page manages it.
 *
 * `skills.ts` is the vocabulary the composer uses to invoke a skill. This is
 * the other half: where each skill sits on disk, which agent directories hold
 * it, and the commands that add, switch off, or remove one.
 */
import { fuzzyMatch } from "./fuzzy";
import { getDefaultHostId, hostIdForProject, invokeOn } from "./transport";
import { hostPathArgs, type HostId } from "./host";
import { HARNESS_TITLE, type HarnessId } from "./session";
import type { SkillSource } from "./skills";

export type SkillScope = "project" | "user";

export type SkillInstall = {
  source: SkillSource;
  scope: SkillScope;
  /** The skill folder itself. */
  dir: string;
  /** Its `SKILL.md`, named `SKILL.md.off` while the skill is switched off. */
  path: string;
  link: boolean;
  enabled: boolean;
};

export type SkillDetail = {
  name: string;
  description: string;
  enabled: boolean;
  /** Owned by an agent CLI's plugin manager: wavex reads it and nothing more. */
  managed: boolean;
  bytes: number;
  updatedMs: number;
  tools: string[];
  installs: SkillInstall[];
};

export type SkillInstallResult = {
  ok: boolean;
  output: string;
};

export function listSkillDetails(cwd: string, hostId?: HostId): Promise<SkillDetail[]> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<SkillDetail[]>(target.hostId, "list_skill_details", { cwd: target.path });
}

export function setSkillEnabled(
  cwd: string,
  dirs: string[],
  enabled: boolean,
  hostId?: HostId,
): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<void>(target.hostId, "set_skill_enabled", { cwd: target.path, dirs, enabled });
}

export function deleteSkills(cwd: string, dirs: string[], hostId?: HostId): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  return invokeOn<void>(target.hostId, "delete_skills", { cwd: target.path, dirs });
}

export type SkillInstallRequest = {
  cwd: string;
  package: string;
  agents: string[];
  skills: string[];
  global: boolean;
};

export function installSkills(
  request: SkillInstallRequest,
  hostId?: HostId,
): Promise<SkillInstallResult> {
  const target = hostPathArgs(request.cwd, hostId, getDefaultHostId());
  return invokeOn<SkillInstallResult>(target.hostId, "install_skills", {
    cwd: target.path,
    package: request.package,
    agents: request.agents,
    skills: request.skills,
    global: request.global,
  });
}

export function skillHostId(cwd: string): HostId {
  return hostIdForProject(cwd);
}

/**
 * The `skills` CLI's own name for each agent wavex drives.
 *
 * omp and fx are missing because the CLI has no id for them; a skill still
 * reaches them through the shared `.agents/skills` folder every CLI reads.
 */
export const SKILL_CLI_AGENTS: { harness: HarnessId; id: string }[] = [
  { harness: "claude", id: "claude-code" },
  { harness: "codex", id: "codex" },
  { harness: "cursor", id: "cursor" },
  { harness: "grok", id: "grok" },
  { harness: "opencode", id: "opencode" },
  { harness: "pi", id: "pi" },
];

const SOURCE_HARNESS: Partial<Record<SkillSource, HarnessId>> = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor",
  grok: "grok",
  opencode: "opencode",
  pi: "pi",
  omp: "omp",
  fx: "fx",
};

export function skillSourceHarness(source: SkillSource): HarnessId | null {
  return SOURCE_HARNESS[source] ?? null;
}

export function skillSourceLabel(source: SkillSource): string {
  const harness = SOURCE_HARNESS[source];
  if (harness) return HARNESS_TITLE[harness];
  return source === "agents" ? "Every agent" : "wavex";
}

/** Each agent directory the skill is installed in, in discovery order. */
export function skillSources(detail: SkillDetail): SkillSource[] {
  const seen = new Set<SkillSource>();
  const out: SkillSource[] = [];
  for (const install of detail.installs) {
    if (seen.has(install.source)) continue;
    seen.add(install.source);
    out.push(install.source);
  }
  return out;
}

export function skillScope(detail: SkillDetail): SkillScope {
  return detail.installs.some((install) => install.scope === "project") ? "project" : "user";
}

export function skillScopeLabel(detail: SkillDetail): string {
  return skillScope(detail) === "project" ? "in this project" : "available in every project";
}

/**
 * The subtitle under a skill's name: who reads it, and where.
 *
 * `.agents` is left out when a named agent is listed beside it — every agent
 * reads that folder, so naming it there would read as a contradiction.
 */
export function skillSubtitle(detail: SkillDetail): string {
  const sources = skillSources(detail);
  const named = sources.filter((source) => source !== "agents");
  const agents = (named.length > 0 ? named : sources).map(skillSourceLabel);
  return [...agents, skillScopeLabel(detail)].join(" · ");
}

/** Why a plugin-owned skill offers no edit, no delete, and no switch. */
export function skillManagedBy(detail: SkillDetail): string | null {
  if (!detail.managed) return null;
  const plugin = detail.name.split(":", 1)[0];
  return `Installed by the ${plugin} plugin, which owns the files on disk.`;
}

export type SkillFilter =
  | { kind: "all" }
  | { kind: "agent"; source: SkillSource }
  | { kind: "scope"; scope: SkillScope };

export const SKILL_FILTER_ALL: SkillFilter = { kind: "all" };

export function skillFilterValue(filter: SkillFilter): string {
  if (filter.kind === "all") return "all";
  if (filter.kind === "agent") return `agent:${filter.source}`;
  return `scope:${filter.scope}`;
}

export function parseSkillFilter(value: string): SkillFilter {
  const [kind, rest] = value.split(":", 2);
  if (kind === "agent" && rest) return { kind: "agent", source: rest as SkillSource };
  if (kind === "scope" && (rest === "project" || rest === "user")) {
    return { kind: "scope", scope: rest };
  }
  return SKILL_FILTER_ALL;
}

export function matchesSkillFilter(detail: SkillDetail, filter: SkillFilter): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "agent") {
    return detail.installs.some((install) => install.source === filter.source);
  }
  return detail.installs.some((install) => install.scope === filter.scope);
}

/**
 * Filter choices built from what is actually installed, so the list never
 * offers an agent or a scope that would answer with nothing.
 */
export function skillFilterOptions(details: SkillDetail[]): { value: string; label: string }[] {
  const sources: SkillSource[] = [];
  let hasProject = false;
  let hasUser = false;
  for (const detail of details) {
    for (const install of detail.installs) {
      if (!sources.includes(install.source)) sources.push(install.source);
      if (install.scope === "project") hasProject = true;
      else hasUser = true;
    }
  }
  const options = [{ value: "all", label: "All skills" }];
  for (const source of sources.sort((a, b) =>
    skillSourceLabel(a).localeCompare(skillSourceLabel(b)),
  )) {
    options.push({ value: `agent:${source}`, label: skillSourceLabel(source) });
  }
  if (hasProject) options.push({ value: "scope:project", label: "This project" });
  if (hasUser) options.push({ value: "scope:user", label: "Every project" });
  return options;
}

export function rankSkillDetails(details: SkillDetail[], query: string): SkillDetail[] {
  const needle = query.trim();
  if (!needle) return details;
  const scored: { detail: SkillDetail; score: number }[] = [];
  for (const detail of details) {
    const nameHit = fuzzyMatch(needle, detail.name);
    const descHit = nameHit ? null : fuzzyMatch(needle, detail.description);
    const hit = nameHit ?? descHit;
    if (!hit) continue;
    scored.push({ detail, score: nameHit ? hit.score + 400 : hit.score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.detail.name.localeCompare(b.detail.name);
  });
  return scored.map((row) => row.detail);
}

export type SkillGroup = {
  scope: SkillScope;
  label: string;
  skills: SkillDetail[];
};

/** Project skills first: they are the ones this checkout brought with it. */
export function groupSkillDetails(details: SkillDetail[]): SkillGroup[] {
  const project: SkillDetail[] = [];
  const user: SkillDetail[] = [];
  for (const detail of details) {
    (skillScope(detail) === "project" ? project : user).push(detail);
  }
  const groups: SkillGroup[] = [];
  if (project.length > 0) groups.push({ scope: "project", label: "Project", skills: project });
  if (user.length > 0) groups.push({ scope: "user", label: "User", skills: user });
  return groups;
}

export function formatSkillBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function formatSkillUpdated(ms: number, now = Date.now()): string {
  if (!ms) return "unknown";
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/** The command `install_skills` will run, shown so nothing happens unseen. */
export function skillInstallCommand(request: Omit<SkillInstallRequest, "cwd">): string {
  const parts = ["npx", "skills", "add", request.package.trim() || "<package>"];
  for (const agent of request.agents) parts.push("--agent", agent);
  for (const skill of request.skills) parts.push("--skill", skill);
  if (request.global) parts.push("--global");
  parts.push("--yes");
  return parts.join(" ");
}
