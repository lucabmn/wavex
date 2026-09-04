import { describe, expect, it } from "vitest";
import { applyTextEdits, workspaceEditFiles } from "@/lib/lsp/workspaceEdit";

const range = (line: number, from: number, to: number) => ({
  start: { line, character: from },
  end: { line, character: to },
});

describe("workspaceEditFiles", () => {
  it("groups the `changes` form by path", () => {
    const files = workspaceEditFiles({
      changes: {
        "file:///app/a.ts": [{ range: range(0, 0, 3), newText: "next" }],
        "file:///app/b.ts": [{ range: range(1, 2, 5), newText: "next" }],
      },
    });
    expect([...files.keys()].sort()).toEqual(["/app/a.ts", "/app/b.ts"]);
  });

  it("prefers the versioned `documentChanges` form", () => {
    const files = workspaceEditFiles({
      changes: { "file:///app/stale.ts": [{ range: range(0, 0, 1), newText: "x" }] },
      documentChanges: [
        {
          textDocument: { uri: "file:///app/a.ts", version: 3 },
          edits: [{ range: range(0, 0, 3), newText: "next" }],
        },
      ],
    });
    expect([...files.keys()]).toEqual(["/app/a.ts"]);
  });

  it("drops a file wavex cannot open", () => {
    const files = workspaceEditFiles({
      changes: { "jdt://contents/rt.jar": [{ range: range(0, 0, 1), newText: "x" }] },
    });
    expect(files.size).toBe(0);
  });

  it("has nothing for a null edit", () => {
    expect(workspaceEditFiles(null).size).toBe(0);
  });
});

describe("applyTextEdits", () => {
  it("applies one edit", () => {
    expect(applyTextEdits("const old = 1;", [{ range: range(0, 6, 9), newText: "next" }])).toBe(
      "const next = 1;",
    );
  });

  it("applies several edits without shifting the later ranges", () => {
    const source = "old();\nold();\nold();";
    const edits = [0, 1, 2].map((line) => ({ range: range(line, 0, 3), newText: "next" }));
    expect(applyTextEdits(source, edits)).toBe("next();\nnext();\nnext();");
  });

  it("applies edits given out of order", () => {
    const source = "alpha beta";
    const edits = [
      { range: range(0, 6, 10), newText: "two" },
      { range: range(0, 0, 5), newText: "one" },
    ];
    expect(applyTextEdits(source, edits)).toBe("one two");
  });

  it("refuses overlapping edits rather than guessing", () => {
    const edits = [
      { range: range(0, 0, 5), newText: "one" },
      { range: range(0, 3, 8), newText: "two" },
    ];
    expect(applyTextEdits("alpha beta", edits)).toBeNull();
  });

  it("returns the source unchanged when there is nothing to do", () => {
    expect(applyTextEdits("alpha", [])).toBe("alpha");
  });
});
