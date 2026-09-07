import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetLanguageServerChoice,
  isLanguageServerEnabled,
  languageServerChoice,
  resetLanguageServerChoices,
  setLanguageServerEnabled,
} from "@/lib/lsp/enabled";

const KEY = "wavex.languageServers";

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
  resetLanguageServerChoices();
});

describe("languageServerChoice", () => {
  it("starts undecided, which is what makes the offer appear", () => {
    expect(languageServerChoice("typescript")).toBe("undecided");
    expect(isLanguageServerEnabled("typescript")).toBe(false);
  });

  it("remembers yes and no as different answers", () => {
    setLanguageServerEnabled("typescript", true);
    setLanguageServerEnabled("rust-analyzer", false);
    expect(languageServerChoice("typescript")).toBe("enabled");
    expect(languageServerChoice("rust-analyzer")).toBe("disabled");
    expect(isLanguageServerEnabled("rust-analyzer")).toBe(false);
  });

  it("keeps a declined server declined rather than asking again", () => {
    setLanguageServerEnabled("gopls", false);
    resetLanguageServerChoices();
    expect(languageServerChoice("gopls")).toBe("disabled");
  });

  it("puts a server back to undecided when the choice is forgotten", () => {
    setLanguageServerEnabled("pyright", true);
    forgetLanguageServerChoice("pyright");
    expect(languageServerChoice("pyright")).toBe("undecided");
  });

  it("survives a corrupt stored value", () => {
    localStorage.setItem(KEY, "not json");
    resetLanguageServerChoices();
    expect(languageServerChoice("typescript")).toBe("undecided");
  });

  it("ignores stored entries that are not answers", () => {
    localStorage.setItem(KEY, JSON.stringify({ typescript: "yes", gopls: true }));
    resetLanguageServerChoices();
    expect(languageServerChoice("typescript")).toBe("undecided");
    expect(languageServerChoice("gopls")).toBe("enabled");
  });
});
