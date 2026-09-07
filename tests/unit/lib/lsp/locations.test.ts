import { describe, expect, it } from "vitest";
import { toCodeTargets } from "@/lib/lsp/locations";

const range = (line: number, character: number) => ({
  start: { line, character },
  end: { line, character: character + 4 },
});

describe("toCodeTargets", () => {
  it("accepts a single location", () => {
    expect(toCodeTargets({ uri: "file:///app/a.ts", range: range(4, 2) })).toEqual([
      { path: "/app/a.ts", line: 5, column: 3, range: range(4, 2) },
    ]);
  });

  it("accepts a list of locations", () => {
    const targets = toCodeTargets([
      { uri: "file:///app/a.ts", range: range(0, 0) },
      { uri: "file:///app/b.ts", range: range(9, 1) },
    ]);
    expect(targets.map((target) => target.path)).toEqual(["/app/a.ts", "/app/b.ts"]);
    expect(targets[1].line).toBe(10);
  });

  it("prefers a link's selection range over its whole declaration", () => {
    const targets = toCodeTargets([
      {
        targetUri: "file:///app/a.ts",
        targetRange: range(0, 0),
        targetSelectionRange: range(3, 6),
      },
    ]);
    expect(targets[0].line).toBe(4);
    expect(targets[0].column).toBe(7);
  });

  it("falls back to a link's target range when there is no selection range", () => {
    const targets = toCodeTargets([{ targetUri: "file:///app/a.ts", targetRange: range(2, 0) }]);
    expect(targets[0].line).toBe(3);
  });

  it("drops a location wavex cannot open", () => {
    expect(toCodeTargets([{ uri: "jdt://contents/rt.jar", range: range(0, 0) }])).toEqual([]);
  });

  it("has nothing for an empty answer", () => {
    expect(toCodeTargets(null)).toEqual([]);
    expect(toCodeTargets([])).toEqual([]);
  });
});
