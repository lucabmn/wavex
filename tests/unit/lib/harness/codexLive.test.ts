import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;

import { hostPathArgs } from "@/lib/host";

vi.mock("@/lib/harness/child", () => ({
  harnessTarget: (cwd: string, hostId?: string) => hostPathArgs(cwd, hostId, "local"),
  harnessHostId: (cwd: string, hostId?: string) => hostPathArgs(cwd, hostId, "local").hostId,
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
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

const { sendCodexTurn, stopCodexSession, respondCodexApproval, __codexTestReset } =
  await import("@/lib/harness/codex");
import type { HarnessEvent } from "@/lib/harness/types";

function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function reply(id: number, result: unknown) {
  onLine!(JSON.stringify({ id, result }));
}

function notify(method: string, params: unknown) {
  onLine!(JSON.stringify({ method, params }));
}

function request(id: number, method: string, params: unknown) {
  onLine!(JSON.stringify({ id, method, params }));
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

async function startTurn(sessionId: string) {
  const events: HarnessEvent[] = [];
  const turn = sendCodexTurn({
    sessionId,
    cwd: "/repo",
    model: "codex:gpt-5.4",
    modelSettings: {},
    runtimeMode: "supervised",
    text: "summarize the changelog",
    attachments: [],
    onEvent: (event) => events.push(event),
  });

  await waitFor(() => parse().some((m) => m.method === "initialize"), "initialize");
  reply(parse().find((m) => m.method === "initialize")!.id as number, {});
  await waitFor(() => parse().some((m) => m.method === "thread/start"), "thread/start");
  reply(parse().find((m) => m.method === "thread/start")!.id as number, {
    thread: { id: "thr_1" },
  });
  await waitFor(() => parse().some((m) => m.method === "turn/start"), "turn/start");
  reply(parse().find((m) => m.method === "turn/start")!.id as number, {
    turn: { id: "turn_1", status: "inProgress" },
  });
  notify("turn/started", { turn: { id: "turn_1", status: "inProgress" } });
  return { events, turn };
}

describe("codex live turn sequence", () => {
  beforeEach(() => {
    sent.length = 0;
    onLine = undefined;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await stopCodexSession("codex-live");
    __codexTestReset();
  });

  it("answers an approval decided the moment it is announced", async () => {
    // An automatic policy answers inside the announcement rather than after
    // it. Registering the pending decision only once the event has been
    // emitted would leave this call with nothing to resolve, and the turn
    // would wait for a decision that had already been made.
    const events: HarnessEvent[] = [];
    const turn = sendCodexTurn({
      sessionId: "codex-live",
      cwd: "/repo",
      model: "codex:gpt-5.4",
      modelSettings: {},
      runtimeMode: "supervised",
      text: "run the tests",
      attachments: [],
      onEvent: (event) => {
        events.push(event);
        if (event.type === "approval.requested") {
          respondCodexApproval("codex-live", event.requestId, "allow");
        }
      },
    });

    await waitFor(() => parse().some((m) => m.method === "initialize"), "initialize");
    reply(parse().find((m) => m.method === "initialize")!.id as number, {});
    await waitFor(() => parse().some((m) => m.method === "thread/start"), "thread/start");
    reply(parse().find((m) => m.method === "thread/start")!.id as number, {
      thread: { id: "thr_1" },
    });
    await waitFor(() => parse().some((m) => m.method === "turn/start"), "turn/start");
    reply(parse().find((m) => m.method === "turn/start")!.id as number, {
      turn: { id: "turn_1", status: "inProgress" },
    });
    notify("turn/started", { turn: { id: "turn_1", status: "inProgress" } });

    request(91, "item/commandExecution/requestApproval", {
      itemId: "cmd_auto",
      command: "pnpm test",
    });

    await waitFor(
      () => parse().some((m) => m.id === 91 && m.result !== undefined),
      "approval response",
    );
    const response = parse().find((m) => m.id === 91 && m.result !== undefined);
    expect((response!.result as Record<string, unknown>).decision).toBeDefined();
    expect(events.some((event) => event.type === "approval.resolved")).toBe(true);

    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("stays busy after an agent message until turn/completed", async () => {
    const { events, turn } = await startTurn("codex-live");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    notify("item/completed", {
      item: {
        id: "msg_1",
        type: "agentMessage",
        text: "I'll inspect the changelog first.",
      },
    });

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(settled).toBe(false);
    vi.useRealTimers();

    notify("item/started", {
      item: {
        id: "cmd_1",
        type: "commandExecution",
        command: "git log -1",
        status: "inProgress",
      },
    });
    expect(settled).toBe(false);
    expect(events.some((event) => event.type === "tool.started")).toBe(true);

    notify("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
    expect(settled).toBe(true);
  });
});
