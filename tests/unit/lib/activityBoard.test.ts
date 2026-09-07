import { describe, expect, it } from "vitest";
import type { LiveAgent } from "@/lib/liveAgents";
import {
  activityBoardCards,
  canMoveActivityCard,
  activityProjectKey,
  activitySessionKey,
  derivedActivityLane,
  moveActivityCard,
  normalizeActivityBoardState,
  pruneActivityBoardState,
  type ActivityBoardState,
} from "@/lib/activityBoard";
import type { SessionSummary } from "@/lib/sessions/sessionStore";

const session = (
  id: string,
  hostId = "local",
  cwd = "C:/Work/App",
  updatedAt = 2,
): SessionSummary => ({
  id,
  hostId,
  cwd,
  harness: "claude",
  model: "test",
  runtimeMode: "supervised",
  title: id,
  createdAt: 1,
  updatedAt,
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

  it("refuses a move a running turn owns, and a lane nobody can pick", () => {
    const [running] = activityBoardCards([session("one")], [live("one")], {
      view: "board",
      lanes: {},
    });
    expect(canMoveActivityCard(running, "parked")).toBe(false);
    expect(canMoveActivityCard(running, "done")).toBe(false);

    const [idle] = activityBoardCards([session("one")], [], { view: "board", lanes: {} });
    expect(canMoveActivityCard(idle, "parked")).toBe(true);
    expect(canMoveActivityCard(idle, "working")).toBe(false);
    expect(canMoveActivityCard(idle, "needs-you")).toBe(false);
    // Already there: nothing to commit.
    expect(canMoveActivityCard(idle, "done")).toBe(false);
  });

  it("orders cards newest first whatever order the sessions arrive in", () => {
    const cards = activityBoardCards(
      [session("old", "local", "C:/Work/App", 1), session("new", "local", "C:/Work/App", 9)],
      [],
      { view: "board", lanes: {} },
    );
    expect(cards.map((card) => card.session.id)).toEqual(["new", "old"]);
  });

  it("moves a card without changing other pins", () => {
    const state = { view: "board", lanes: { a: "done" } } satisfies ActivityBoardState;
    expect(moveActivityCard(state, "b", "parked")).toEqual({
      view: "board",
      lanes: { a: "done", b: "parked" },
    });
  });
});
