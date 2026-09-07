import { describe, expect, it } from "vitest";
import { piSkillContextForSession } from "@/lib/sessions/sessionSkills";

describe("piSkillContextForSession", () => {
  it("uses a Pi session worktree", () => {
    expect(
      piSkillContextForSession({
        harness: "pi",
        cwd: "/repo",
        worktreeCwd: "/repo-worktree",
      }),
    ).toEqual({ harness: "pi", cwd: "/repo-worktree", hostId: "local" });
  });

  it("keeps a remote session's host even though its worktree path is bare", () => {
    expect(
      piSkillContextForSession({
        harness: "pi",
        cwd: "wavex-host://dev-box//srv/app",
        worktreeCwd: "/srv/app-worktree",
      }),
    ).toEqual({ harness: "pi", cwd: "/srv/app-worktree", hostId: "dev-box" });
  });

  it("ignores a non-Pi session", () => {
    expect(piSkillContextForSession({ harness: "claude", cwd: "/repo" })).toBeNull();
  });
});
