import { describe, expect, it, beforeEach, vi } from "vitest";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;

import { hostPathArgs } from "@/lib/host";

vi.mock("@/lib/harness/child", () => ({
  harnessTarget: (cwd: string, hostId?: string) => hostPathArgs(cwd, hostId, "local"),
  resolveCursorBinary: async () => ({ path: "/fake/cursor-agent" }),
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

// The enrichment poller reads tool calls back off the host over the transport.
// A live turn does not need it, and a real `invokeOn` would reach for Tauri.
vi.mock("@/lib/harness/cursorStore", () => ({
  readStoredCursorToolCalls: async () => [],
}));

const { sendCursorTurn, respondCursorApproval, respondCursorQuestion, stopCursorSession } =
  await import("@/lib/harness/cursor");
import type { HarnessEvent } from "@/lib/harness/types";

type SentMessage = {
  id: number;
  method?: string;
  result?: { outcome?: { optionId?: string; outcome?: string } };
};

const parse = () => sent.map((s) => JSON.parse(s) as SentMessage);

function reply(id: number, result: unknown) {
  onLine!(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `timed out waiting for ${label}; sent=${JSON.stringify(parse().map((m) => m.method ?? `reply:${m.id}`))}`,
  );
};

const answer = async (method: string, result: unknown) => {
  await waitFor(() => parse().some((m) => m.method === method), method);
  reply(parse().find((m) => m.method === method)!.id, result);
};

// The model option already carries the value the turn asks for, so
// `setConfigOption` short-circuits instead of negotiating over the wire.
const sessionSetup = {
  sessionId: "S1",
  configOptions: [{ id: "model", category: "model", currentValue: "cursor-model" }],
};

async function handshake() {
  await answer("initialize", { protocolVersion: 1 });
  await answer("authenticate", {});
  await answer("session/new", sessionSetup);
}

describe("cursor live turn sequence", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("initializes, opens a session, and prompts", async () => {
    const events: HarnessEvent[] = [];
    const turn = sendCursorTurn({
      sessionId: "c1",
      cwd: "/repo",
      model: "cursor:cursor-model",
      runtimeMode: "supervised",
      text: "hey",
      attachments: [],
      onEvent: (e) => events.push(e),
    });
    await handshake();
    await answer("session/prompt", { stopReason: "end_turn" });
    await turn;
    expect(events.some((e) => e.type === "session.providerBound")).toBe(true);
    expect(events.some((e) => e.type === "message.completed")).toBe(true);
    await stopCursorSession("c1");
  });

  it("answers an approval decided the moment it is announced", async () => {
    // An automatic policy answers inside the announcement rather than after
    // it. Registering the pending decision only once the event has been
    // emitted would leave this call with nothing to resolve, and the turn
    // would wait for a decision that had already been made.
    const turn = sendCursorTurn({
      sessionId: "c-auto",
      cwd: "/repo",
      model: "cursor:cursor-model",
      runtimeMode: "supervised",
      text: "run git",
      attachments: [],
      onEvent: (e) => {
        if (e.type === "approval.requested") respondCursorApproval("c-auto", e.requestId, "allow");
      },
    });
    await handshake();
    await waitFor(() => parse().some((m) => m.method === "session/prompt"), "prompt");
    const promptId = parse().find((m) => m.method === "session/prompt")!.id;
    onLine!(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 11,
        method: "session/request_permission",
        params: {
          sessionId: "S1",
          toolCall: {
            toolCallId: "call_auto",
            title: "Execute `git status`",
            kind: "execute",
            rawInput: { command: "git status" },
          },
          options: [
            { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
            { optionId: "reject-once", name: "Reject", kind: "reject_once" },
          ],
        },
      }),
    );
    await waitFor(() => parse().some((m) => m.id === 11 && m.result), "permission response");
    expect(parse().find((m) => m.id === 11 && m.result)?.result?.outcome?.optionId).toBe(
      "allow-once",
    );
    reply(promptId, { stopReason: "end_turn" });
    await turn;
    await stopCursorSession("c-auto");
  });

  it("answers a question decided the moment it is asked", async () => {
    const turn = sendCursorTurn({
      sessionId: "c-question",
      cwd: "/repo",
      model: "cursor:cursor-model",
      runtimeMode: "supervised",
      text: "ask me",
      attachments: [],
      onEvent: (e) => {
        if (e.type === "question.asked") {
          respondCursorQuestion("c-question", e.requestId, {
            kind: "answered",
            answers: { q1: ["yes"] },
          });
        }
      },
    });
    await handshake();
    await waitFor(() => parse().some((m) => m.method === "session/prompt"), "prompt");
    const promptId = parse().find((m) => m.method === "session/prompt")!.id;
    onLine!(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 12,
        method: "cursor/ask_question",
        params: {
          sessionId: "S1",
          title: "Which one?",
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
      }),
    );
    await waitFor(() => parse().some((m) => m.id === 12 && m.result), "question response");
    expect(parse().find((m) => m.id === 12 && m.result)?.result?.outcome?.outcome).toBe("answered");
    reply(promptId, { stopReason: "end_turn" });
    await turn;
    await stopCursorSession("c-question");
  });
});
