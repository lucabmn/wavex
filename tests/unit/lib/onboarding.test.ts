import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isOnboarded, markOnboarded } from "@/lib/onboarding";

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
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
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

describe("onboarding", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  afterEach(() => {
    localStorage.removeItem("wavex.onboarded");
  });

  it("starts unboarded", () => {
    expect(isOnboarded()).toBe(false);
  });

  it("stays on after marking", () => {
    markOnboarded();
    expect(isOnboarded()).toBe(true);
    expect(localStorage.getItem("wavex.onboarded")).toBe("1");
  });

  it("treats any other value as unboarded", () => {
    localStorage.setItem("wavex.onboarded", "0");
    expect(isOnboarded()).toBe(false);
  });
});
