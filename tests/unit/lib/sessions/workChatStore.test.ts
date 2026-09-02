import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessEvent, SendTurnInput } from "@/lib/harness/types";

const stored = new Map<string, unknown>();
const deleted: string[] = [];
const forgotten: string[] = [];
const cancelled: string[] = [];
let live = true;
let turn: ((input: SendTurnInput) => Promise<void>) | null = null;
let listed: { id: string; title: string; updatedAt: number }[] = [];

vi.mock("@/lib/sessions/workChats", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sessions/workChats")>(
    "@/lib/sessions/workChats",
  );
  return { ...actual, workChatDir: async () => "/tmp/work-chats" };
});

vi.mock("@/lib/sessions/sessionStore", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sessions/sessionStore")>(
    "@/lib/sessions/sessionStore",
  );
  return {
    ...actual,
    listSessionsByScope: async () =>
      listed.map((row) => ({
        id: row.id,
        cwd: "/tmp/work-chats",
        harness: "cursor" as const,
        model: "gpt-5",
        runtimeMode: "supervised" as const,
        title: row.title,
        createdAt: 0,
        updatedAt: row.updatedAt,
        scope: "work" as const,
      })),
    getSession: async (id: string) => stored.get(id) ?? null,
    deleteSession: async (id: string) => {
      deleted.push(id);
    },
    upsertSession: async () => null,
  };
});

vi.mock("@/lib/harness", async () => {
  const apply = await vi.importActual<typeof import("@/lib/harness/apply")>("@/lib/harness/apply");
  return {
    ...apply,
    isLiveHarness: () => live,
    generateHarnessTitle: async () => null,
    forgetHarnessSession: async (_harness: string, id: string) => {
      forgotten.push(id);
    },
    cancelHarnessTurn: async (_harness: string, id: string) => {
      cancelled.push(id);
    },
    sendHarnessTurn: async (input: SendTurnInput) => turn?.(input),
  };
});

// Node has no `document`, and the batching itself is `scheduleHarnessFlush`'s
// concern, not the store's. Apply each batch on a macrotask instead.
vi.mock("@/lib/harness/flush", () => ({
  cancelScheduledFlush: (handle: { id: number } | null) => {
    if (handle) clearTimeout(handle.id);
  },
  scheduleHarnessFlush: (run: () => void) => ({
    kind: "timeout" as const,
    id: Number(setTimeout(run, 0)),
  }),
}));

vi.mock("@/lib/harness/registry", () => ({
  respondHarnessApproval: () => undefined,
  respondHarnessQuestion: () => undefined,
}));

vi.mock("@/lib/attachments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/attachments")>("@/lib/attachments");
  return { ...actual, prepareAttachments: async (files: unknown) => files };
});

const store = await import("@/lib/sessions/workChatStore");

function chat() {
  const active = store.getWorkChatState().activeId;
  return active ? store.findWorkChat(active) : null;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  stored.clear();
  deleted.length = 0;
  forgotten.length = 0;
  cancelled.length = 0;
  listed = [];
  live = true;
  turn = null;
  store.resetWorkChatStore();
});

afterEach(() => {
  store.resetWorkChatStore();
});

describe("createWorkChat", () => {
  it("opens a chat in the app-owned directory and makes it active", async () => {
    const id = await store.createWorkChat("claude");
    const state = store.getWorkChatState();
    expect(state.activeId).toBe(id);
    expect(chat()?.cwd).toBe("/tmp/work-chats");
    expect(chat()?.scope).toBe("work");
  });
});

describe("sendWorkChatTurn", () => {
  it("titles the chat from the first prompt and streams the reply", async () => {
    const events: HarnessEvent[] = [
      { type: "message.delta", text: "Hello" },
      { type: "message.delta", text: " there" },
      { type: "message.completed" },
    ];
    turn = async (input) => {
      for (const event of events) input.onEvent(event);
    };

    const id = await store.createWorkChat("claude");
    await store.sendWorkChatTurn(id, "Draft a changelog");
    await settle();

    const current = store.findWorkChat(id);
    expect(current?.title).toBe("Draft a changelog");
    expect(current?.busy).toBe(false);
    expect(current?.blocks.map((block) => [block.role, block.text])).toEqual([
      ["user", "Draft a changelog"],
      ["assistant", "Hello there"],
    ]);
  });

  it("refuses an empty prompt", async () => {
    const id = await store.createWorkChat("claude");
    await store.sendWorkChatTurn(id, "   ");
    expect(store.findWorkChat(id)?.blocks).toEqual([]);
  });

  it("says so instead of hanging when the harness is not connected", async () => {
    live = false;
    const id = await store.createWorkChat("claude");
    await store.sendWorkChatTurn(id, "hi");
    const blocks = store.findWorkChat(id)?.blocks ?? [];
    expect(blocks.map((block) => block.role)).toEqual(["user", "system"]);
    expect(blocks[1].text).toContain("not connected yet");
  });

  it("keeps a user-set title", async () => {
    turn = async () => undefined;
    const id = await store.createWorkChat("claude");
    await store.renameWorkChat(id, "Launch copy");
    await store.sendWorkChatTurn(id, "Draft a changelog");
    await settle();
    expect(store.findWorkChat(id)?.title).toBe("Launch copy");
  });

  it("reports an adapter failure in the transcript", async () => {
    turn = async () => {
      throw new Error("codex exploded");
    };
    const id = await store.createWorkChat("codex");
    await store.sendWorkChatTurn(id, "hi");
    await settle();
    const blocks = store.findWorkChat(id)?.blocks ?? [];
    expect(blocks[blocks.length - 1].text).toBe("codex exploded");
    expect(store.findWorkChat(id)?.busy).toBe(false);
  });
});

describe("stopWorkChat", () => {
  it("cancels the turn and seals the stream", async () => {
    turn = async (input) => {
      input.onEvent({ type: "message.delta", text: "partial" });
      await new Promise((resolve) => setTimeout(resolve, 200));
    };
    const id = await store.createWorkChat("claude");
    void store.sendWorkChatTurn(id, "hi");
    await settle();
    await store.stopWorkChat(id);

    expect(cancelled).toEqual([id]);
    expect(store.findWorkChat(id)?.busy).toBe(false);
    expect(store.findWorkChat(id)?.blocks.some((block) => block.streaming)).toBe(false);
  });

  /** A cancelled turn's late events must not reappear in the transcript. */
  it("ignores events from a turn the user already stopped", async () => {
    const late: { emit: ((event: HarnessEvent) => void) | null } = { emit: null };
    turn = async (input) => {
      late.emit = input.onEvent;
      await new Promise((resolve) => setTimeout(resolve, 200));
    };
    const id = await store.createWorkChat("claude");
    void store.sendWorkChatTurn(id, "hi");
    await settle();
    await store.stopWorkChat(id);
    late.emit?.({ type: "message.delta", text: "late" });
    await settle();

    const texts = (store.findWorkChat(id)?.blocks ?? []).map((block) => block.text);
    expect(texts).not.toContain("late");
  });
});

describe("resendWorkChatTurn", () => {
  it("truncates at the edited turn and sends the new text", async () => {
    const prompts: string[] = [];
    turn = async (input) => {
      prompts.push(input.text);
      input.onEvent({ type: "message.delta", text: `re: ${input.text}` });
    };
    const id = await store.createWorkChat("claude");
    await store.sendWorkChatTurn(id, "first");
    await settle();
    const userBlock = store.findWorkChat(id)!.blocks[0];

    await store.resendWorkChatTurn(id, userBlock.id, "second");
    await settle();

    expect(prompts).toEqual(["first", "second"]);
    expect(store.findWorkChat(id)?.blocks.map((block) => [block.role, block.text])).toEqual([
      ["user", "second"],
      ["assistant", "re: second"],
    ]);
  });

  it("regenerates the reply to the preceding user turn", async () => {
    const prompts: string[] = [];
    turn = async (input) => {
      prompts.push(input.text);
      input.onEvent({ type: "message.delta", text: "answer" });
    };
    const id = await store.createWorkChat("claude");
    await store.sendWorkChatTurn(id, "why");
    await settle();
    const assistant = store.findWorkChat(id)!.blocks[1];

    await store.regenerateWorkChatTurn(id, assistant.id);
    await settle();

    expect(prompts).toEqual(["why", "why"]);
    expect(store.findWorkChat(id)?.blocks).toHaveLength(2);
  });
});

describe("deleteWorkChat", () => {
  it("drops the provider thread, the row, and the selection", async () => {
    const first = await store.createWorkChat("claude");
    const second = await store.createWorkChat("claude");
    await store.deleteWorkChat(second);

    expect(forgotten).toEqual([second]);
    expect(deleted).toEqual([second]);
    expect(store.getWorkChatState().activeId).toBe(first);
    expect(store.findWorkChat(second)).toBeNull();
  });
});

describe("loadWorkChats", () => {
  it("selects the most recent stored chat", async () => {
    listed = [{ id: "a", title: "Older", updatedAt: 1 }];
    stored.set("a", {
      id: "a",
      cwd: "/tmp/work-chats",
      harness: "cursor",
      model: "gpt-5",
      modelSettings: {},
      runtimeMode: "supervised",
      title: "Older",
      blocks: [],
    });

    await store.loadWorkChats();
    expect(store.getWorkChatState().activeId).toBe("a");
    expect(store.findWorkChat("a")?.scope).toBe("work");
  });
});
