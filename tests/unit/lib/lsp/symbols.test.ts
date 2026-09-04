import { describe, expect, it } from "vitest";
import { flattenDocumentSymbols, toWorkspaceSymbols } from "@/lib/lsp/symbols";

const range = (line: number, character = 0) => ({
  start: { line, character },
  end: { line, character: character + 1 },
});

describe("flattenDocumentSymbols", () => {
  it("flattens a tree and names each container", () => {
    const symbols = flattenDocumentSymbols(
      [
        {
          name: "Editor",
          kind: 5,
          range: range(0),
          selectionRange: range(0, 6),
          children: [
            { name: "save", kind: 6, range: range(2), selectionRange: range(2, 2) },
            {
              name: "Inner",
              kind: 5,
              range: range(5),
              selectionRange: range(5, 2),
              children: [{ name: "run", kind: 6, range: range(6), selectionRange: range(6, 4) }],
            },
          ],
        },
      ],
      "/app/a.ts",
    );

    expect(symbols.map((symbol) => [symbol.container, symbol.name])).toEqual([
      ["", "Editor"],
      ["Editor", "save"],
      ["Editor", "Inner"],
      ["Editor.Inner", "run"],
    ]);
    expect(symbols[1]).toMatchObject({ kind: "method", path: "/app/a.ts", line: 3, column: 3 });
  });

  it("has nothing for an empty answer", () => {
    expect(flattenDocumentSymbols(null, "/app/a.ts")).toEqual([]);
  });
});

describe("toWorkspaceSymbols", () => {
  it("keeps the container name and resolves the URI", () => {
    expect(
      toWorkspaceSymbols([
        {
          name: "openDocument",
          kind: 12,
          containerName: "LspClient",
          location: { uri: "file:///app/client.ts", range: range(41, 2) },
        },
      ]),
    ).toEqual([
      {
        name: "openDocument",
        container: "LspClient",
        kind: "function",
        path: "/app/client.ts",
        line: 42,
        column: 3,
      },
    ]);
  });

  it("drops a symbol wavex cannot open", () => {
    const symbols = toWorkspaceSymbols([
      { name: "String", kind: 5, location: { uri: "jdt://contents", range: range(0) } },
    ]);
    expect(symbols).toEqual([]);
  });
});
