import { beforeEach, describe, expect, it } from "vitest";
import {
  enabledMcpServerNames,
  isMcpServerEnabled,
  resetMcpServerChoices,
  setMcpServerEnabled,
} from "@/lib/mcp/enabled";

const KEY = "wavex.mcpServers";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
      clear: () => {
        data.clear();
      },
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
    configurable: true,
  });
}

beforeEach(() => {
  mockLocalStorage();
  resetMcpServerChoices();
});

describe("isMcpServerEnabled", () => {
  it("is off until the user says otherwise, because turning one on runs a program", () => {
    expect(isMcpServerEnabled("context7")).toBe(false);
    expect(enabledMcpServerNames()).toEqual([]);
  });

  it("remembers what was turned on", () => {
    setMcpServerEnabled("context7", true);
    expect(isMcpServerEnabled("context7")).toBe(true);
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify({ context7: true }));
  });

  it("drops the key when a server is turned off rather than storing every no", () => {
    setMcpServerEnabled("context7", true);
    setMcpServerEnabled("context7", false);
    expect(localStorage.getItem(KEY)).toBe("{}");
    expect(isMcpServerEnabled("context7")).toBe(false);
  });

  it("reads a stored answer back on a fresh cache", () => {
    localStorage.setItem(KEY, JSON.stringify({ shadcn: true, context7: true }));
    resetMcpServerChoices();
    expect(enabledMcpServerNames()).toEqual(["context7", "shadcn"]);
  });

  it("ignores a stored value that is not a decision", () => {
    localStorage.setItem(KEY, JSON.stringify({ shadcn: "yes", context7: true }));
    resetMcpServerChoices();
    expect(enabledMcpServerNames()).toEqual(["context7"]);
  });

  it("survives storage holding something that is not an object", () => {
    localStorage.setItem(KEY, "[1,2,3]");
    resetMcpServerChoices();
    expect(enabledMcpServerNames()).toEqual([]);
  });
});
