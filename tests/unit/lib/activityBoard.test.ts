import { describe, expect, it } from "vitest";
import type { LiveAgent } from "@/lib/liveAgents";
import {
  activityBoardCards,
  activityProjectKey,
  activitySessionKey,
  derivedActivityLane,
  moveActivityCard,
  normalizeActivityBoardState,
  pruneActivityBoardState,
  type ActivityBoardState,
} from "@/lib/activityBoard";
import type { SessionSummary } from "@/lib/sessions/sessionStore";

const session = (id: string, hostId = "local", cwd = "C:/Work/App"): SessionSummary => ({
  id,
  hostId,
  cwd,
  harness: "claude",
  model: "test",
  runtimeMode: "supervised",
  title: id,
  createdAt: 1,
  updatedAt: 2,
  scope: "coding",
});

const live = (id: string, overrides: Partial<LiveAgent> = {}): LiveAgent => ({
  id,
  cwd: "C:/Work/App",
  title: id,
  harness: "claude",
  activity: "Working",
  needsApproval: false,
  done: false,
  ...overrides,
});

describe("activity board", () => {
  it("uses needs-you and working as derived precedence over a user pin", () => {
    const pinned = { view: "board", lanes: { one: "parked" } } satisfies ActivityBoardState;
    expect(activityBoardCards([session("one")], [live("one")], pinned)[0].lane).toBe("working");
    expect(
      activityBoardCards([session("one")], [live("one", { needsApproval: true })], pinned)[0].lane,
    ).toBe("needs-you");
  });

  it("keeps an idle user's parking choice, otherwise idle sessions are done", () => {
    const parked = { view: "board", lanes: { one: "parked" } } satisfies ActivityBoardState;
    expect(activityBoardCards([session("one")], [], parked)[0].lane).toBe("parked");
    expect(activityBoardCards([session("two")], [], parked)[0].lane).toBe("done");
    expect(derivedActivityLane({ ...live("one"), done: true })).toBe("done");
  });

  it("uses host-qualified session keys and path keys for grouping", () => {
    expect(activitySessionKey(session("same", "host-a"))).not.toBe(
      activitySessionKey(session("same", "host-b")),
    );
    expect(activityProjectKey(session("one", "local", "C:\\Work\\App"))).toBe(
      activityProjectKey(session("two", "local", "c:/work/app")),
    );
  });

  it("validates persisted values and removes lanes for deleted sessions", () => {
    expect(normalizeActivityBoardState({ view: "bad", lanes: { a: "bad", b: "done" } })).toEqual({
      view: "list",
      lanes: { b: "done" },
    });
    const state = normalizeActivityBoardState({ view: "board", lanes: { a: "done", b: "parked" } });
    expect(pruneActivityBoardState(state, [session("a")])).toEqual({
      view: "board",
      lanes: { a: "done" },
    });
  });

  it("moves a card without changing other pins", () => {
    const state = { view: "board", lanes: { a: "done" } } satisfies ActivityBoardState;
    expect(moveActivityCard(state, "b", "parked")).toEqual({
      view: "board",
      lanes: { a: "done", b: "parked" },
    });
  });
});
