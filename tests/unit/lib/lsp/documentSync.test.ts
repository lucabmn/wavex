import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { contentChangesFor, incrementalChanges } from "@/lib/lsp/documentSync";
import type { LspContentChange } from "@/lib/lsp/types";

/** Apply content changes the way a server does: in order, each on the result. */
function applyAsServer(source: string, changes: LspContentChange[]): string {
  let doc = Text.of(source.split("\n"));
  for (const change of changes) {
    if (!("range" in change)) {
      doc = Text.of(change.text.split("\n"));
      continue;
    }
    const from = doc.line(change.range.start.line + 1).from + change.range.start.character;
    const to = doc.line(change.range.end.line + 1).from + change.range.end.character;
    doc = doc.replace(from, to, Text.of(change.text.split("\n")));
  }
  return doc.toString();
}

describe("incrementalChanges", () => {
  it("describes a single insertion", () => {
    const before = Text.of(["const a = 1;"]);
    const changes = ChangeSet.of({ from: 6, insert: "b" }, before.length);
    expect(incrementalChanges(before, changes)).toEqual([
      { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 6 } }, text: "b" },
    ]);
  });

  it("orders several edits so earlier ranges stay valid", () => {
    const before = Text.of(["alpha", "beta", "gamma"]);
    const changes = ChangeSet.of(
      [
        { from: 0, to: 5, insert: "one" },
        { from: 11, to: 16, insert: "three" },
      ],
      before.length,
    );
    const content = incrementalChanges(before, changes);
    expect(content).toHaveLength(2);
    expect(applyAsServer(before.toString(), content)).toBe("one\nbeta\nthree");
  });

  it("survives a multi-line replacement", () => {
    const before = Text.of(["fn main() {", "    todo!();", "}"]);
    const changes = ChangeSet.of({ from: 11, to: 24, insert: "\n    println!();" }, before.length);
    const content = incrementalChanges(before, changes);
    expect(applyAsServer(before.toString(), content)).toBe("fn main() {\n    println!();\n}");
  });

  it("gives up on a change set too large to be worth sending as ranges", () => {
    const lines = Array.from({ length: 200 }, (_, index) => `line ${index}`);
    const before = Text.of(lines);
    const specs = lines.map((_, index) => {
      const from = before.line(index + 1).from;
      return { from, to: from + 4, insert: "LINE" };
    });
    expect(incrementalChanges(before, ChangeSet.of(specs, before.length))).toEqual([]);
  });
});

describe("contentChangesFor", () => {
  const before = Text.of(["a"]);
  const after = Text.of(["ab"]);
  const changes = ChangeSet.of({ from: 1, insert: "b" }, before.length);

  it("sends nothing when the server tracks no documents", () => {
    expect(contentChangesFor(0, before, after, changes)).toEqual([]);
  });

  it("sends the whole document when the server asked for full sync", () => {
    expect(contentChangesFor(1, before, after, changes)).toEqual([{ text: "ab" }]);
  });

  it("sends ranges when the server asked for incremental sync", () => {
    expect(contentChangesFor(2, before, after, changes)).toEqual([
      { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, text: "b" },
    ]);
  });

  it("falls back to the whole document rather than dropping a huge change set", () => {
    const lines = Array.from({ length: 200 }, (_, index) => `line ${index}`);
    const source = Text.of(lines);
    const specs = lines.map((_, index) => {
      const from = source.line(index + 1).from;
      return { from, to: from + 4, insert: "LINE" };
    });
    const set = ChangeSet.of(specs, source.length);
    const result = contentChangesFor(2, source, set.apply(source), set);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty("range");
  });
});
