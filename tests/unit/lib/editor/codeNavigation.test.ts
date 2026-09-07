import { describe, expect, it } from "vitest";
import {
  codeNavigationBack,
  codeNavigationForward,
  EMPTY_CODE_NAVIGATION,
  pruneCodeNavigation,
  pushCodeLocation,
  type CodeLocation,
} from "@/lib/editor/codeNavigation";

const at = (path: string, line: number, column = 1): CodeLocation => ({ path, line, column });

describe("pushCodeLocation", () => {
  it("records the origin of a jump", () => {
    const history = pushCodeLocation(EMPTY_CODE_NAVIGATION, at("/a.ts", 10), at("/b.ts", 3));
    expect(history.back).toEqual([at("/a.ts", 10)]);
    expect(history.forward).toEqual([]);
  });

  it("ignores a jump that lands where it started", () => {
    const history = pushCodeLocation(EMPTY_CODE_NAVIGATION, at("/a.ts", 10), at("/a.ts", 10, 8));
    expect(history).toBe(EMPTY_CODE_NAVIGATION);
  });

  it("treats a Windows path case difference as the same file", () => {
    const history = pushCodeLocation(
      EMPTY_CODE_NAVIGATION,
      at("C:/App/main.ts", 4),
      at("c:/app/main.ts", 4),
    );
    expect(history.back).toEqual([]);
  });

  it("drops the forward stack once the user navigates again", () => {
    const first = pushCodeLocation(EMPTY_CODE_NAVIGATION, at("/a.ts", 1), at("/b.ts", 1));
    const back = codeNavigationBack(first, at("/b.ts", 1))!;
    expect(back.history.forward).toHaveLength(1);
    const next = pushCodeLocation(back.history, at("/a.ts", 1), at("/c.ts", 1));
    expect(next.forward).toEqual([]);
  });

  it("keeps the stack bounded", () => {
    let history = EMPTY_CODE_NAVIGATION;
    for (let line = 1; line <= 80; line += 1) {
      history = pushCodeLocation(history, at("/a.ts", line), at("/b.ts", line));
    }
    expect(history.back).toHaveLength(50);
    expect(history.back[0]).toEqual(at("/a.ts", 31));
  });
});

describe("codeNavigationBack and forward", () => {
  it("returns to the origin and offers the way forward again", () => {
    const history = pushCodeLocation(EMPTY_CODE_NAVIGATION, at("/a.ts", 10), at("/b.ts", 3));
    const back = codeNavigationBack(history, at("/b.ts", 3))!;
    expect(back.location).toEqual(at("/a.ts", 10));

    const forward = codeNavigationForward(back.history, at("/a.ts", 10))!;
    expect(forward.location).toEqual(at("/b.ts", 3));
    expect(forward.history.back).toEqual([at("/a.ts", 10)]);
  });

  it("has nothing to do on an empty history", () => {
    expect(codeNavigationBack(EMPTY_CODE_NAVIGATION, at("/a.ts", 1))).toBeNull();
    expect(codeNavigationForward(EMPTY_CODE_NAVIGATION, at("/a.ts", 1))).toBeNull();
  });
});

describe("pruneCodeNavigation", () => {
  it("drops locations whose file has been closed", () => {
    const history = { back: [at("/a.ts", 1), at("/gone.ts", 2)], forward: [at("/b.ts", 3)] };
    expect(pruneCodeNavigation(history, ["/a.ts", "/b.ts"])).toEqual({
      back: [at("/a.ts", 1)],
      forward: [at("/b.ts", 3)],
    });
  });

  it("returns the same history when nothing was dropped", () => {
    const history = { back: [at("/a.ts", 1)], forward: [] };
    expect(pruneCodeNavigation(history, ["/a.ts"])).toBe(history);
  });
});
