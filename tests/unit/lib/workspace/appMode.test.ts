import { describe, expect, it } from "vitest";
import { DEFAULT_APP_MODE, otherAppMode, sanitizeAppMode } from "@/lib/workspace/appMode";

describe("sanitizeAppMode", () => {
  it("keeps a known mode", () => {
    expect(sanitizeAppMode("work")).toBe("work");
    expect(sanitizeAppMode("coding")).toBe("coding");
  });

  it("falls back to coding for anything else", () => {
    expect(sanitizeAppMode(undefined)).toBe(DEFAULT_APP_MODE);
    expect(sanitizeAppMode(null)).toBe("coding");
    expect(sanitizeAppMode(7)).toBe("coding");
    expect(sanitizeAppMode("Work")).toBe("coding");
  });
});

describe("otherAppMode", () => {
  it("toggles", () => {
    expect(otherAppMode("work")).toBe("coding");
    expect(otherAppMode("coding")).toBe("work");
  });
});
