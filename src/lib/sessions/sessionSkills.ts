import type { HostId } from "../host";
import { sessionHostId, sessionWorkCwd, type HarnessId } from "../session";
import type { SkillCatalogContext } from "../skills";

type SkillWarmupSession = {
  harness: HarnessId;
  cwd: string;
  hostId?: HostId;
  worktreeCwd?: string;
};

export function piSkillContextForSession(session: SkillWarmupSession): SkillCatalogContext | null {
  if (session.harness !== "pi") return null;
  // A worktree cwd is a bare child path, so the machine whose CLI owns these
  // skills has to come from the session rather than from the directory.
  return { harness: "pi", cwd: sessionWorkCwd(session), hostId: sessionHostId(session) };
}
