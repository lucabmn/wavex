import { describe, expect, it } from "vitest";
import { lastUserBlockId, userTurnCards, withHarnessChoice } from "@/lib/sessions/sessionChoice";
import type { Block, Session } from "@/lib/session";

function block(overrides: Partial<Block> & Pick<Block, "id" | "role">): Block {
  return { text: "", ...overrides };
}

function session(overrides: Partial<Session> & Pick<Session, "id">): Session {
  return {
    harness: "claude",
    model: "sonnet",
    modelSettings: {},
    runtimeMode: "local",
    title: "claude",
    cwd: "/tmp/web",
    blocks: [],
    ...overrides,
  } as Session;
}

describe("lastUserBlockId", () => {
  it("finds the most recent user block, not the first", () => {
    const s = session({
      id: "s1",
      blocks: [
        block({ id: "b1", role: "user" }),
        block({ id: "b2", role: "assistant" }),
        block({ id: "b3", role: "user" }),
      ],
    });
    expect(lastUserBlockId(s)).toBe("b3");
  });

  it("is undefined when the agent has spoken but the user has not", () => {
    expect(
      lastUserBlockId(session({ id: "s1", blocks: [block({ id: "b1", role: "assistant" })] })),
    ).toBeUndefined();
  });
});

describe("withHarnessChoice", () => {
  it("titles an untouched session after the new harness", () => {
    const next = withHarnessChoice(session({ id: "s1" }), "codex", "gpt", {});
    expect(next.harness).toBe("codex");
    expect(next.title).toBe("codex");
  });

  it("drops the provider session when the harness changes", () => {
    const s = session({ id: "s1", providerSessionId: "abc" });
    expect(withHarnessChoice(s, "codex", "gpt", {}).providerSessionId).toBeUndefined();
  });

  it("keeps the provider session when only the model changes", () => {
    const s = session({ id: "s1", providerSessionId: "abc" });
    expect(withHarnessChoice(s, "claude", "opus", {}).providerSessionId).toBe("abc");
  });

  it("keeps the context window when the model is unchanged", () => {
    const s = session({ id: "s1", context: { used: 10, total: 100 } as Session["context"] });
    expect(withHarnessChoice(s, "claude", "sonnet", {}).context).toEqual(s.context);
  });
});

describe("userTurnCards", () => {
  it("is undefined when the turn carries neither card", () => {
    expect(userTurnCards(undefined, undefined)).toBeUndefined();
  });

  it("carries a second opinion on its own", () => {
    const meta = { harness: "codex", model: "gpt" } as never;
    expect(userTurnCards(undefined, meta)).toEqual({ secondOpinion: meta });
  });
});
