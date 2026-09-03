import { describe, expect, it } from "vitest";
import { APP_COMMANDS, paletteEntries, type CommandId } from "@/lib/commands";
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
});
