import { describe, expect, it, vi } from "vitest";
import { hostPathArgs } from "@/lib/host";

const calls = vi.hoisted(() => ({
  spawned: [] as Array<{ sessionId: string; cwd: string; hostId?: string }>,
  killed: [] as Array<{ sessionId: string; hostId?: string }>,
  lines: new Map<string, (line: string) => void>(),
}));

vi.mock("@/lib/harness/child", () => ({
  harnessTarget: (cwd: string, hostId?: string) => hostPathArgs(cwd, hostId, "local"),
  harnessHostId: (cwd: string, hostId?: string) => hostPathArgs(cwd, hostId, "local").hostId,
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  spawnChild: async (
    sessionId: string,
    _path: string,
    _args: string[],
    cwd: string,
    hostId?: string,
  ) => {
    calls.spawned.push({ sessionId, cwd, hostId });
  },
  killChild: async (sessionId: string, hostId?: string) => {
    calls.killed.push({ sessionId, hostId });
  },
  unwatchChild: () => undefined,
  watchChild: (sessionId: string, line: (l: string) => void) => {
    calls.lines.set(sessionId, line);
  },
  writeChild: async () => undefined,
}));

const { sendClaudeTurn, stopClaudeSession, bindClaudeSession, __claudeTestReset } =
  await import("@/lib/harness/claude");

const REMOTE = "wavex-host://dev-box//srv/app";

/**
 * The turn never settles here — starting the child is the whole point, so the
 * promise is left to the stop that follows.
 */
function startTurn(sessionId: string, cwd: string, hostId?: string) {
  const turn = sendClaudeTurn({
    sessionId,
    hostId,
    cwd,
    model: "claude:claude-sonnet-5",
    runtimeMode: "supervised",
    text: "hello",
    onEvent: () => undefined,
  });
  turn.catch(() => undefined);
  return turn;
}

async function settled() {
  for (let i = 0; i < 50; i++) {
    if (calls.spawned.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("child never spawned");
}

describe("harness host routing", () => {
  it("kills the child on the machine it was spawned on", async () => {
    __claudeTestReset();
    calls.spawned.length = 0;
    calls.killed.length = 0;

    void startTurn("s-remote", REMOTE);
    await settled();
    expect(calls.spawned[0]?.hostId).toBe("dev-box");

    // No host passed: the adapter's own record is what routes the kill.
    await stopClaudeSession("s-remote");
    expect(calls.killed).toEqual([{ sessionId: "s-remote", hostId: "dev-box" }]);
  });

  it("keeps a resume record's host across a stop and rebind", async () => {
    __claudeTestReset();
    calls.killed.length = 0;

    bindClaudeSession("s-bound", "provider-1", REMOTE);
    await stopClaudeSession("s-bound");
    expect(calls.killed).toEqual([{ sessionId: "s-bound", hostId: "dev-box" }]);
  });

  it("sends nothing anywhere when no host is known", async () => {
    __claudeTestReset();
    calls.killed.length = 0;

    // A pane that never ran an agent has no live and no resume record, so a
    // client shutting down must not guess a machine and reach across it.
    await stopClaudeSession("s-never-ran");
    expect(calls.killed).toEqual([]);
  });

  it("does not reuse one host's child for the same path on another", async () => {
    __claudeTestReset();
    calls.spawned.length = 0;

    void startTurn("s-shared", "/srv/app");
    await settled();
    expect(calls.spawned).toHaveLength(1);

    void startTurn("s-shared", "/srv/app", "dev-box");
    for (let i = 0; i < 50 && calls.spawned.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(calls.spawned.map((call) => call.hostId)).toEqual(["local", "dev-box"]);
  });
});
