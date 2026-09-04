import { describe, expect, it } from "vitest";
import {
  canDispatchQueuedHead,
  canFlushQueue,
  clearQueue,
  EMPTY_QUEUES,
  enqueuePrompt,
  isEditingQueuedHead,
  pruneQueues,
  queueSummary,
  queuedFor,
  queuedHead,
  queuedPromptForSubmit,
  removeQueuedPrompt,
  shouldQueuePrompt,
  takeNextPrompt,
  updateQueuedPrompt,
  type QueuedPrompt,
} from "@/lib/promptQueue";

function prompt(id: string, text = id): QueuedPrompt {
  return { id, text, attachments: [], queuedAt: 0 };
}

describe("prompt queues", () => {
  it("keeps send order per session", () => {
    let queues = enqueuePrompt(EMPTY_QUEUES, "a", prompt("1"));
    queues = enqueuePrompt(queues, "a", prompt("2"));
    queues = enqueuePrompt(queues, "b", prompt("3"));
    expect(queuedFor(queues, "a").map((entry) => entry.id)).toEqual(["1", "2"]);
    expect(queuedFor(queues, "b").map((entry) => entry.id)).toEqual(["3"]);
  });

  it("takes the oldest prompt first and drops an empty queue", () => {
    let queues = enqueuePrompt(EMPTY_QUEUES, "a", prompt("1"));
    queues = enqueuePrompt(queues, "a", prompt("2"));
    const first = takeNextPrompt(queues, "a");
    expect(first.prompt?.id).toBe("1");
    const second = takeNextPrompt(first.queues, "a");
    expect(second.prompt?.id).toBe("2");
    expect(second.queues.has("a")).toBe(false);
  });

  it("reports nothing to take for an unknown session", () => {
    const taken = takeNextPrompt(EMPTY_QUEUES, "missing");
    expect(taken.prompt).toBeNull();
    expect(taken.queues).toBe(EMPTY_QUEUES);
  });

  it("removes one prompt without touching the rest", () => {
    let queues = enqueuePrompt(EMPTY_QUEUES, "a", prompt("1"));
    queues = enqueuePrompt(queues, "a", prompt("2"));
    queues = removeQueuedPrompt(queues, "a", "1");
    expect(queuedFor(queues, "a").map((entry) => entry.id)).toEqual(["2"]);
  });

  it("clears and prunes", () => {
    let queues = enqueuePrompt(EMPTY_QUEUES, "a", prompt("1"));
    queues = enqueuePrompt(queues, "b", prompt("2"));
    expect(clearQueue(queues, "a").has("a")).toBe(false);
    expect([...pruneQueues(queues, new Set(["b"])).keys()]).toEqual(["b"]);
    expect(pruneQueues(queues, new Set(["a", "b"]))).toBe(queues);
  });
});

describe("canFlushQueue", () => {
  it("waits for a turn that is still running or blocked", () => {
    expect(canFlushQueue({ busy: true, needsInput: false, stopped: false })).toBe(false);
    expect(canFlushQueue({ busy: false, needsInput: true, stopped: false })).toBe(false);
  });

  it("never fires a queued prompt after the user stopped the turn", () => {
    expect(canFlushQueue({ busy: false, needsInput: false, stopped: true })).toBe(false);
  });

  it("fires when the turn ended on its own", () => {
    expect(canFlushQueue({ busy: false, needsInput: false, stopped: false })).toBe(true);
  });
});

describe("shouldQueuePrompt", () => {
  it("sends straight through when nothing is running", () => {
    expect(shouldQueuePrompt({ steerRequested: false, busy: false, canSteer: true })).toBe(false);
    expect(shouldQueuePrompt({ steerRequested: true, busy: false, canSteer: false })).toBe(false);
  });

  it("queues a follow-up written while a turn runs", () => {
    expect(shouldQueuePrompt({ steerRequested: false, busy: true, canSteer: true })).toBe(true);
    expect(shouldQueuePrompt({ steerRequested: false, busy: true, canSteer: false })).toBe(true);
  });

  it("falls back to queue when the behavior is omitted", () => {
    expect(
      shouldQueuePrompt({
        steerRequested: false,
        busy: true,
        canSteer: true,
        followUpBehavior: undefined,
      }),
    ).toBe(true);
  });

  it("steers instead only when asked and the harness can", () => {
    expect(shouldQueuePrompt({ steerRequested: true, busy: true, canSteer: true })).toBe(false);
  });

  it("queues rather than dropping when steering was asked for but is impossible", () => {
    expect(shouldQueuePrompt({ steerRequested: true, busy: true, canSteer: false })).toBe(true);
  });

  it("steers in steer mode when the harness can take a follow-up", () => {
    expect(
      shouldQueuePrompt({
        steerRequested: false,
        busy: true,
        canSteer: true,
        followUpBehavior: "steer",
      }),
    ).toBe(false);
    expect(
      shouldQueuePrompt({
        steerRequested: false,
        busy: true,
        canSteer: true,
        followUpBehavior: "queue",
      }),
    ).toBe(true);
  });

  it("queues in steer mode rather than dropping when the harness cannot steer", () => {
    expect(
      shouldQueuePrompt({
        steerRequested: false,
        busy: true,
        canSteer: false,
        followUpBehavior: "steer",
      }),
    ).toBe(true);
  });

  it("still steers on explicit request when the setting says queue", () => {
    expect(
      shouldQueuePrompt({
        steerRequested: true,
        busy: true,
        canSteer: true,
        followUpBehavior: "queue",
      }),
    ).toBe(false);
  });
});

describe("queueSummary", () => {
  it("counts in words the user reads", () => {
    expect(queueSummary(1)).toBe("1 queued prompt");
    expect(queueSummary(3)).toBe("3 queued prompts");
  });
});

function twoDeep() {
  let queues = enqueuePrompt(EMPTY_QUEUES, "a", prompt("1"));
  return enqueuePrompt(queues, "a", prompt("2"));
}

describe("queuedHead", () => {
  it("returns the oldest prompt", () => {
    expect(queuedHead(twoDeep(), "a")?.id).toBe("1");
    expect(queuedHead(EMPTY_QUEUES, "a")).toBeUndefined();
  });
});

describe("updateQueuedPrompt", () => {
  it("rewrites one row in place", () => {
    const next = updateQueuedPrompt(twoDeep(), "a", "1", "edited");
    expect(queuedFor(next, "a").map((entry) => entry.text)).toEqual(["edited", "2"]);
  });

  it("leaves unknown rows alone", () => {
    const queues = twoDeep();
    expect(updateQueuedPrompt(queues, "a", "missing", "edited")).toBe(queues);
  });
});

describe("isEditingQueuedHead", () => {
  it("holds only while the head row is the one being edited", () => {
    const queues = twoDeep();
    expect(isEditingQueuedHead(queues, "a")).toBe(false);
    expect(isEditingQueuedHead(queues, "a", "1")).toBe(true);
    expect(isEditingQueuedHead(queues, "a", "2")).toBe(false);
  });
});

describe("canDispatchQueuedHead", () => {
  const idle = {
    busy: false,
    needsInput: false,
    stopped: false,
    resuming: false,
    hasHead: true,
    editingHead: false,
    preparingHandoff: false,
  };

  it("dispatches an idle session with a queued head", () => {
    expect(canDispatchQueuedHead(idle)).toBe(true);
  });

  it("holds while busy, blocked, stopped, or resuming", () => {
    expect(canDispatchQueuedHead({ ...idle, busy: true })).toBe(false);
    expect(canDispatchQueuedHead({ ...idle, needsInput: true })).toBe(false);
    expect(canDispatchQueuedHead({ ...idle, stopped: true })).toBe(false);
    expect(canDispatchQueuedHead({ ...idle, resuming: true })).toBe(false);
  });

  it("holds while the head is edited or handed off, not for later rows", () => {
    expect(canDispatchQueuedHead({ ...idle, editingHead: true })).toBe(false);
    expect(canDispatchQueuedHead({ ...idle, preparingHandoff: true })).toBe(false);
    expect(canDispatchQueuedHead({ ...idle, hasHead: false })).toBe(false);
  });
});

describe("queuedPromptForSubmit", () => {
  it("only auto-dispatches the head", () => {
    const queues = twoDeep();
    expect(queuedPromptForSubmit(queues, "a", "1", "dispatch")?.id).toBe("1");
    expect(queuedPromptForSubmit(queues, "a", "2", "dispatch")).toBeUndefined();
    expect(queuedPromptForSubmit(queues, "missing", "1", "dispatch")).toBeUndefined();
  });

  it("lets a steer target any remaining row", () => {
    const queues = twoDeep();
    expect(queuedPromptForSubmit(queues, "a", "2", "steer")?.id).toBe("2");
    expect(queuedPromptForSubmit(queues, "a", "missing", "steer")).toBeUndefined();
  });
});
