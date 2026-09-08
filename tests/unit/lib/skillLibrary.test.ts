import { describe, expect, it } from "vitest";
import {
  formatSkillBytes,
  formatSkillUpdated,
  groupSkillDetails,
  matchesSkillFilter,
  parseSkillFilter,
  rankSkillDetails,
  skillFilterOptions,
  skillInstallCommand,
  skillManagedBy,
  skillScope,
  skillSourceLabel,
  skillSubtitle,
  type SkillDetail,
  type SkillInstall,
} from "@/lib/skillLibrary";

function install(partial: Partial<SkillInstall> = {}): SkillInstall {
  return {
    source: "agents",
    scope: "user",
    dir: "/Users/me/.agents/skills/ship",
    path: "/Users/me/.agents/skills/ship/SKILL.md",
    link: false,
    enabled: true,
    ...partial,
  };
}

function skill(partial: Partial<SkillDetail> = {}): SkillDetail {
  return {
    name: "ship",
    description: "Ship it",
    enabled: true,
    managed: false,
    bytes: 1024,
    updatedMs: 0,
    tools: [],
    installs: [install()],
    ...partial,
  };
}

describe("skill scope", () => {
  it("counts a skill installed in the checkout as a project skill", () => {
    const both = skill({
      installs: [install(), install({ source: "claude", scope: "project" })],
    });
    expect(skillScope(both)).toBe("project");
    expect(skillScope(skill())).toBe("user");
  });

  it("names every agent that holds the skill, then where it applies", () => {
    const detail = skill({
      installs: [install(), install({ source: "claude" }), install({ source: "codex" })],
    });
    expect(skillSubtitle(detail)).toBe("Claude Code · Codex · available in every project");
  });

  it("falls back to the shared folder when no agent directory holds it", () => {
    expect(skillSubtitle(skill())).toBe("Every agent · available in every project");
  });

  it("explains who owns a plugin skill instead of offering to change it", () => {
    expect(skillManagedBy(skill())).toBeNull();
    expect(skillManagedBy(skill({ name: "workflow-kit:plan", managed: true }))).toBe(
      "Installed by the workflow-kit plugin, which owns the files on disk.",
    );
  });
});

describe("filters", () => {
  const details = [
    skill({ name: "ship", installs: [install({ source: "claude" })] }),
    skill({
      name: "review",
      installs: [install({ source: "codex", scope: "project" })],
    }),
  ];

  it("offers only the agents and scopes something is installed under", () => {
    expect(skillFilterOptions(details).map((option) => option.value)).toEqual([
      "all",
      "agent:claude",
      "agent:codex",
      "scope:project",
      "scope:user",
    ]);
  });

  it("round-trips a filter through its select value", () => {
    expect(parseSkillFilter("agent:codex")).toEqual({ kind: "agent", source: "codex" });
    expect(parseSkillFilter("scope:project")).toEqual({ kind: "scope", scope: "project" });
    expect(parseSkillFilter("nonsense")).toEqual({ kind: "all" });
  });

  it("keeps a skill when any of its folders matches", () => {
    const agent = parseSkillFilter("agent:codex");
    expect(details.filter((detail) => matchesSkillFilter(detail, agent))).toHaveLength(1);
    const project = parseSkillFilter("scope:project");
    expect(details.filter((detail) => matchesSkillFilter(detail, project))[0]?.name).toBe("review");
  });
});

describe("list shape", () => {
  it("puts project skills above user skills", () => {
    const groups = groupSkillDetails([
      skill({ name: "ship" }),
      skill({ name: "review", installs: [install({ scope: "project" })] }),
    ]);
    expect(groups.map((group) => group.scope)).toEqual(["project", "user"]);
    expect(groups[0]?.skills.map((detail) => detail.name)).toEqual(["review"]);
  });

  it("ranks a name match above a description match", () => {
    const ranked = rankSkillDetails(
      [
        skill({ name: "review", description: "Ship a release" }),
        skill({ name: "ship", description: "Anything" }),
      ],
      "ship",
    );
    expect(ranked.map((detail) => detail.name)).toEqual(["ship", "review"]);
  });

  it("returns the list untouched for an empty query", () => {
    const details = [skill({ name: "b" }), skill({ name: "a" })];
    expect(rankSkillDetails(details, "  ")).toBe(details);
  });
});

describe("formatting", () => {
  it("reports size in the unit that reads", () => {
    expect(formatSkillBytes(512)).toBe("512 B");
    expect(formatSkillBytes(47821)).toBe("46.7 KB");
    expect(formatSkillBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("reports age in the coarsest unit that still says something", () => {
    const now = Date.UTC(2026, 0, 10);
    expect(formatSkillUpdated(0, now)).toBe("unknown");
    expect(formatSkillUpdated(now - 30_000, now)).toBe("just now");
    expect(formatSkillUpdated(now - 3 * 86_400_000, now)).toBe("3d ago");
    expect(formatSkillUpdated(now - 400 * 86_400_000, now)).toBe("1y ago");
  });

  it("labels the shared folder as every agent", () => {
    expect(skillSourceLabel("agents")).toBe("Every agent");
    expect(skillSourceLabel("opencode")).toBe("OpenCode");
  });
});

describe("install command", () => {
  it("passes each agent and skill as its own flag pair", () => {
    expect(
      skillInstallCommand({
        package: "vercel-labs/agent-skills",
        agents: ["claude-code", "codex"],
        skills: ["*"],
        global: true,
      }),
    ).toBe(
      "npx skills add vercel-labs/agent-skills --agent claude-code --agent codex --skill * --global --yes",
    );
  });

  it("leaves the scope flag off a project install", () => {
    expect(
      skillInstallCommand({ package: "owner/repo", agents: ["pi"], skills: [], global: false }),
    ).toBe("npx skills add owner/repo --agent pi --yes");
  });
});
