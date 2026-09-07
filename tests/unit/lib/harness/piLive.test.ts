import { describe, expect, it, beforeEach, vi } from "vitest";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;

import { hostPathArgs } from "@/lib/host";

vi.mock("@/lib/harness/child", () => ({
  harnessTarget: (cwd: string, hostId?: string) => hostPathArgs(cwd, hostId, "local"),
  harnessHostId: (cwd: string, hostId?: string) => hostPathArgs(cwd, hostId, "local").hostId,
  resolvePiBinary: async () => ({ path: "/fake/pi" }),
  resolveOmpBinary: async () => ({ path: "/fake/omp" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (l: string) => void) => {
    onLine = line;
  },
  writeChild: async (_id: string, line: string) => {
    sent.push(line);
  },
}));

const { sendPiTurn, respondPiApproval, stopPiSession } = await import("@/lib/harness/pi");
const { sendOmpTurn, respondOmpApproval, stopOmpSession } = await import("@/lib/harness/omp");
import type { HarnessEvent } from "@/lib/harness/types";

type SentMessage = {
  id?: string;
  type?: string;
  message?: string;
  confirmed?: boolean;
  value?: string;
};

const parse = () => sent.map((s) => JSON.parse(s) as SentMessage);

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `timed out waiting for ${label}; sent=${JSON.stringify(parse().map((m) => m.type))}`,
  );
};

/** Answers a `PiRpc` request frame the way `pi --mode rpc` does. */
function respond(command: string, data?: unknown) {
  const request = parse().find((m) => m.type === command);
  if (!request) throw new Error(`no ${command} request was sent`);
  onLine!(
    JSON.stringify({
      type: "response",
      id: request.id,
      command,
      success: true,
      ...(data === undefined ? {} : { data }),
    }),
  );
}

async function handshake() {
  await waitFor(() => parse().some((m) => m.type === "get_state"), "get_state");
  respond("get_state", { model: { provider: "anthropic", id: "sonnet", contextWindow: 200000 } });
  await waitFor(() => parse().some((m) => m.type === "prompt"), "prompt");
  respond("prompt");
}

/** Settles the turn the way an `agent_settled` frame does. */
async function settle() {
  onLine!(JSON.stringify({ type: "agent_settled" }));
  await waitFor(() => parse().some((m) => m.type === "get_session_stats"), "get_session_stats");
  respond("get_session_stats", {});
}

describe("pi live turn sequence", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("binds the session, prompts, and settles the turn", async () => {
    const events: HarnessEvent[] = [];
    const turn = sendPiTurn({
      sessionId: "p1",
      cwd: "/repo",
      model: "pi:anthropic/sonnet",
      runtimeMode: "supervised",
      text: "hey",
      attachments: [],
      onEvent: (e) => events.push(e),
    });
    await handshake();
    await settle();
    await turn;
    expect(events.some((e) => e.type === "session.started")).toBe(true);
    expect(parse().find((m) => m.type === "prompt")?.message).toBe("hey");
    await stopPiSession("p1");
  });

  it("answers an approval decided the moment it is announced", async () => {
    // An automatic policy answers inside the announcement rather than after
    // it. Registering the pending decision only once the event has been
    // emitted would leave this call with nothing to resolve, and the extension
    // request would never be answered.
    const events: HarnessEvent[] = [];
    const turn = sendPiTurn({
      sessionId: "p-auto",
      cwd: "/repo",
      model: "pi:anthropic/sonnet",
      runtimeMode: "supervised",
      text: "run git",
      attachments: [],
      onEvent: (e) => {
        events.push(e);
        if (e.type === "approval.requested") respondPiApproval("p-auto", e.requestId, "allow");
      },
    });
    await handshake();
    onLine!(
      JSON.stringify({
        type: "extension_ui_request",
        id: "ui_1",
        method: "confirm",
        title: "Run a command",
        message: "git status",
      }),
    );
    await waitFor(
      () => parse().some((m) => m.type === "extension_ui_response"),
      "extension_ui_response",
    );
    const response = parse().find((m) => m.type === "extension_ui_response");
    expect(response?.id).toBe("ui_1");
    expect(response?.confirmed).toBe(true);
    expect(events.some((e) => e.type === "approval.resolved")).toBe(true);
    await settle();
    await turn;
    await stopPiSession("p-auto");
  });
});

describe("omp live turn sequence", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  // omp is the same adapter core behind a second flavor, and it keeps its own
  // live table. The approval ordering has to hold on both, not only on the
  // flavor the tests above drive.
  it("answers an approval decided the moment it is announced", async () => {
    const turn = sendOmpTurn({
      sessionId: "o-auto",
      cwd: "/repo",
      model: "omp:anthropic/sonnet",
      runtimeMode: "supervised",
      text: "run git",
      attachments: [],
      onEvent: (e) => {
        if (e.type === "approval.requested") respondOmpApproval("o-auto", e.requestId, "allow");
      },
    });
    await handshake();
    onLine!(
      JSON.stringify({
        type: "extension_ui_request",
        id: "ui_2",
        method: "select",
        title: "Pick one",
        options: ["allow", "deny"],
      }),
    );
    await waitFor(
      () => parse().some((m) => m.type === "extension_ui_response"),
      "extension_ui_response",
    );
    expect(parse().find((m) => m.type === "extension_ui_response")?.value).toBe("allow");
    await settle();
    await turn;
    await stopOmpSession("o-auto");
  });
});
