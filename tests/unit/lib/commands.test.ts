import { describe, expect, it } from "vitest";
import { APP_COMMANDS, paletteEntries, parsePaletteQuery, type CommandId } from "@/lib/commands";
import { KEYBINDINGS } from "@/lib/settings";

const ALL = new Set(APP_COMMANDS.map((command) => command.id));

describe("APP_COMMANDS", () => {
  it("has no duplicate ids", () => {
    expect(ALL.size).toBe(APP_COMMANDS.length);
  });

  it("is the only source of the keybindings page", () => {
    const withKeys = APP_COMMANDS.filter((command) => command.keys);
    expect(KEYBINDINGS).toHaveLength(withKeys.length);
    expect(KEYBINDINGS[0]).toEqual({
      command: withKeys[0].label,
      keys: withKeys[0].keys,
      when: withKeys[0].when,
    });
  });
});

describe("paletteEntries", () => {
  it("offers only commands the caller can run", () => {
    const entries = paletteEntries(APP_COMMANDS, new Set<CommandId>(["app.search"]), "");
    expect(entries.map((entry) => entry.command.id)).toEqual(["app.search"]);
  });

  it("never offers a list-only shortcut", () => {
    const entries = paletteEntries(
      APP_COMMANDS,
      new Set<CommandId>(["tab.activate", "editor.find", "tab.new"]),
      "",
    );
    expect(entries.map((entry) => entry.command.id)).toEqual(["tab.new"]);
  });

  it("ranks fuzzy matches and drops the rest", () => {
    const entries = paletteEntries(APP_COMMANDS, ALL, "split right");
    expect(entries[0].command.id).toBe("pane.splitRight");
    expect(entries.every((entry) => entry.positions.length > 0)).toBe(true);
  });

  it("keeps catalog order for an empty query", () => {
    const entries = paletteEntries(APP_COMMANDS, ALL, "   ");
    expect(entries[0].command.id).toBe("app.commandPalette");
  });

  it("treats a bare mode prefix as an empty needle in that mode", () => {
    const entries = paletteEntries(APP_COMMANDS, ALL, "@");
    expect(entries.map((entry) => entry.command.id)).toEqual(["app.goToFile", "app.openProject"]);
  });
});

describe("parsePaletteQuery", () => {
  it("defaults to commands without a prefix", () => {
    expect(parsePaletteQuery("split")).toEqual({ mode: "commands", rest: "split" });
    expect(parsePaletteQuery(">split")).toEqual({ mode: "commands", rest: "split" });
    expect(parsePaletteQuery("")).toEqual({ mode: "commands", rest: "" });
  });

  it("splits the mode prefix from the needle", () => {
    expect(parsePaletteQuery("@main")).toEqual({ mode: "files", rest: "main" });
    expect(parsePaletteQuery("#bug")).toEqual({ mode: "search", rest: "bug" });
    expect(parsePaletteQuery("?split")).toEqual({ mode: "help", rest: "split" });
    expect(parsePaletteQuery("@  spaced")).toEqual({ mode: "files", rest: "spaced" });
  });
});

describe("paletteEntries modes", () => {
  it("narrows @ to file commands", () => {
    const entries = paletteEntries(APP_COMMANDS, ALL, "@file");
    const ids = entries.map((entry) => entry.command.id);
    expect(ids).toContain("app.goToFile");
    expect(ids).not.toContain("app.search");
    expect(ids).not.toContain("tab.new");
  });

  it("narrows # to search commands", () => {
    const scoped = paletteEntries(APP_COMMANDS, ALL, "#");
    expect(scoped.map((entry) => entry.command.id)).toEqual([
      "app.search",
      "app.goToFile",
      "app.findInFiles",
    ]);
    const entries = paletteEntries(APP_COMMANDS, ALL, "#find");
    const ids = entries.map((entry) => entry.command.id);
    expect(ids).toContain("app.findInFiles");
    expect(ids).not.toContain("tab.new");
  });

  it("lists list-only shortcuts in ? mode", () => {
    const entries = paletteEntries(APP_COMMANDS, ALL, "?activate");
    expect(entries.map((entry) => entry.command.id)).toContain("tab.activate");
  });

  it("keeps plain queries on the full command scope", () => {
    const entries = paletteEntries(APP_COMMANDS, ALL, "split right");
    expect(entries[0].command.id).toBe("pane.splitRight");
  });
});
