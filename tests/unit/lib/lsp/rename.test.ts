import { describe, expect, it } from "vitest";
import { planRename } from "@/lib/lsp/rename";
import { pathKey } from "@/lib/paths";

const edit = (line: number, from: number, to: number, newText: string) => ({
  range: { start: { line, character: from }, end: { line, character: to } },
  newText,
});

function reader(files: Record<string, string>) {
  return (path: string) => Promise.resolve(files[path] ?? null);
}

const NOTHING_DIRTY: ReadonlySet<string> = new Set();

describe("planRename", () => {
  it("rewrites every file the server named", async () => {
    const plan = await planRename(
      "old",
      {
        changes: {
          "file:///app/a.ts": [edit(0, 6, 9, "next")],
          "file:///app/b.ts": [edit(0, 0, 3, "next")],
        },
      },
      NOTHING_DIRTY,
      reader({ "/app/a.ts": "const old = 1;", "/app/b.ts": "old();" }),
    );

    expect(plan).toEqual({
      ok: true,
      files: [
        { path: "/app/a.ts", text: "const next = 1;" },
        { path: "/app/b.ts", text: "next();" },
      ],
    });
  });

  it("stops before writing anything when a file has unsaved changes", async () => {
    const plan = await planRename(
      "old",
      { changes: { "file:///app/a.ts": [edit(0, 0, 3, "next")] } },
      new Set([pathKey("/app/a.ts")]),
      reader({ "/app/a.ts": "old();" }),
    );
    expect(plan).toEqual({ ok: false, reason: "Save a.ts before renaming old" });
  });

  it("matches an unsaved file across a Windows case difference", async () => {
    const plan = await planRename(
      "old",
      { changes: { "file:///c:/App/Main.ts": [edit(0, 0, 3, "next")] } },
      new Set([pathKey("c:/app/main.ts")]),
      reader({ "C:/App/Main.ts": "old();" }),
    );
    expect(plan).toEqual({ ok: false, reason: "Save Main.ts before renaming old" });
  });

  it("stops when a file cannot be read", async () => {
    const plan = await planRename(
      "old",
      { changes: { "file:///app/gone.ts": [edit(0, 0, 3, "next")] } },
      NOTHING_DIRTY,
      reader({}),
    );
    expect(plan).toEqual({ ok: false, reason: "Couldn’t rename old in gone.ts" });
  });

  it("stops when the server's edits no longer apply", async () => {
    const plan = await planRename(
      "old",
      { changes: { "file:///app/a.ts": [edit(0, 0, 5, "one"), edit(0, 3, 8, "two")] } },
      NOTHING_DIRTY,
      reader({ "/app/a.ts": "alpha beta" }),
    );
    expect(plan).toEqual({ ok: false, reason: "Couldn’t rename old in a.ts" });
  });

  it("leaves out a file the edits do not actually change", async () => {
    const plan = await planRename(
      "old",
      { changes: { "file:///app/a.ts": [edit(0, 0, 3, "old")] } },
      NOTHING_DIRTY,
      reader({ "/app/a.ts": "old();" }),
    );
    expect(plan).toEqual({ ok: true, files: [] });
  });

  it("has nothing to do for an empty edit", async () => {
    expect(await planRename("old", null, NOTHING_DIRTY, reader({}))).toEqual({
      ok: true,
      files: [],
    });
  });
});
