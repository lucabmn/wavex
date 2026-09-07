import { describe, expect, it, beforeEach, vi } from "vitest";

type HttpCall = { url: string; method: string; body?: string };

const http: HttpCall[] = [];
let onServerLine: ((line: string) => void) | undefined;
let onSse: ((data: string) => void) | undefined;

import { hostPathArgs } from "@/lib/host";

vi.mock("@/lib/harness/child", () => ({
  harnessTarget: (cwd: string, hostId?: string) => hostPathArgs(cwd, hostId, "local"),
  resolveOpenCodeBinary: async () => ({ path: "/fake/opencode" }),
  execChild: async () => "1.14.19",
  freeHarnessPort: async () => 47999,
  spawnChild: async () => {
    // The server announces its address on stdout, which is where the adapter
    // reads the base URL from.
    onServerLine?.("opencode server listening on http://127.0.0.1:47999");
  },
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (l: string) => void) => {
    onServerLine = line;
  },
  watchSse: (_id: string, data: (d: string) => void) => {
    onSse = data;
  },
  openHarnessSse: async () => undefined,
  closeHarnessSse: async () => undefined,
  harnessHttp: async (input: { url: string; method: string; body?: string }) => {
    http.push({ url: input.url, method: input.method, body: input.body });
    const path = new URL(input.url).pathname;
    if (path === "/session" && input.method === "POST") {
      return { status: 200, body: JSON.stringify({ id: "oc1", directory: "/repo" }) };
    }
    return { status: 200, body: "{}" };
  },
}));

const { sendOpenCodeTurn, respondOpenCodeApproval, respondOpenCodeQuestion, stopOpenCodeSession } =
  await import("@/lib/harness/opencode");
import type { HarnessEvent } from "@/lib/harness/types";

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${label}; http=${JSON.stringify(http.map((c) => c.url))}`);
};

const posted = (fragment: string) =>
  http.find((call) => call.method === "POST" && call.url.includes(fragment));

function emit(event: Record<string, unknown>) {
  onSse!(JSON.stringify(event));
}

/** Ends the turn the way the server's idle status does. */
function idle() {
  emit({
    type: "session.status",
    properties: { sessionID: "oc1", status: { type: "idle" } },
  });
}

describe("opencode live turn sequence", () => {
  beforeEach(() => {
    http.length = 0;
  });

  it("starts a server, opens a session, and prompts", async () => {
    const events: HarnessEvent[] = [];
    const turn = sendOpenCodeTurn({
      sessionId: "oc-basic",
      cwd: "/repo",
      model: "opencode:anthropic/claude-sonnet-4",
      runtimeMode: "supervised",
      text: "hey",
      attachments: [],
      onEvent: (e) => events.push(e),
    });
    await waitFor(() => posted("/prompt_async") != null, "prompt_async");
    idle();
    await turn;
    expect(events.some((e) => e.type === "session.providerBound")).toBe(true);
    await stopOpenCodeSession("oc-basic");
  });

  it("answers an approval decided the moment it is announced", async () => {
    // An automatic policy answers inside the announcement rather than after
    // it. `waitApproval` has to have registered the pending entry before the
    // event is emitted, or this call finds nothing to resolve and the
    // permission is never replied to.
    const events: HarnessEvent[] = [];
    const turn = sendOpenCodeTurn({
      sessionId: "oc-auto",
      cwd: "/repo",
      model: "opencode:anthropic/claude-sonnet-4",
      runtimeMode: "supervised",
      text: "run git",
      attachments: [],
      onEvent: (e) => {
        events.push(e);
        if (e.type === "approval.requested")
          respondOpenCodeApproval("oc-auto", e.requestId, "allow");
      },
    });
    await waitFor(() => posted("/prompt_async") != null, "prompt_async");
    emit({
      type: "permission.asked",
      properties: {
        sessionID: "oc1",
        id: "perm_1",
        permission: "bash",
        patterns: ["git status"],
        metadata: { input: { command: "git status" } },
      },
    });
    await waitFor(() => posted("/permission/perm_1/reply") != null, "permission reply");
    expect(JSON.parse(posted("/permission/perm_1/reply")!.body!).reply).toBe("once");
    expect(events.some((e) => e.type === "approval.resolved")).toBe(true);
    idle();
    await turn;
    await stopOpenCodeSession("oc-auto");
  });

  it("answers a question decided the moment it is asked", async () => {
    const turn = sendOpenCodeTurn({
      sessionId: "oc-question",
      cwd: "/repo",
      model: "opencode:anthropic/claude-sonnet-4",
      runtimeMode: "supervised",
      text: "ask me",
      attachments: [],
      onEvent: (e) => {
        if (e.type === "question.asked") {
          respondOpenCodeQuestion("oc-question", e.requestId, {
            kind: "answered",
            answers: { q1: ["yes"] },
          });
        }
      },
    });
    await waitFor(() => posted("/prompt_async") != null, "prompt_async");
    emit({
      type: "question.asked",
      properties: {
        sessionID: "oc1",
        id: "q_1",
        questions: [
          {
            id: "q1",
            question: "Which one?",
            options: [
              { id: "yes", label: "Yes" },
              { id: "no", label: "No" },
            ],
          },
        ],
      },
    });
    await waitFor(() => posted("/question/q_1/reply") != null, "question reply");
    expect(JSON.parse(posted("/question/q_1/reply")!.body!).answers).toEqual([["Yes"]]);
    idle();
    await turn;
    await stopOpenCodeSession("oc-question");
  });
});
