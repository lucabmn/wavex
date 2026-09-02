import { describe, expect, it } from "vitest";
import { sameSettings, setsEqual } from "@/lib/equality";

describe("setsEqual", () => {
  it("ignores insertion order", () => {
    expect(setsEqual(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
  });

  it("separates a subset from an equal set", () => {
    expect(setsEqual(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    expect(setsEqual(new Set(["a", "b"]), new Set(["a"]))).toBe(false);
  });

  it("separates same-size sets with different members", () => {
    expect(setsEqual(new Set(["a"]), new Set(["b"]))).toBe(false);
  });
});

describe("sameSettings", () => {
  it("treats undefined and empty as the same", () => {
    expect(sameSettings(undefined, {})).toBe(true);
    expect(sameSettings(undefined, undefined)).toBe(true);
  });

  it("compares by key regardless of order", () => {
    expect(sameSettings({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true);
  });

  it("sees a key present on only one side", () => {
    expect(sameSettings({ a: "1" }, { a: "1", b: "2" })).toBe(false);
  });

  it("sees a changed value", () => {
    expect(sameSettings({ a: "1" }, { a: "2" })).toBe(false);
  });
});
