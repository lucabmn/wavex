import { describe, expect, it } from "vitest";
import { resizeWidthForKey } from "@/hooks/useDragResize";

const resize = (key: string, current = 300, shiftKey = false) =>
  resizeWidthForKey({
    current,
    min: 180,
    max: 420,
    defaultWidth: 260,
    key,
    shiftKey,
  });

describe("resizeWidthForKey", () => {
  it("moves in small and accelerated steps", () => {
    expect(resize("ArrowLeft")).toBe(292);
    expect(resize("ArrowRight")).toBe(308);
    expect(resize("ArrowRight", 300, true)).toBe(324);
  });

  it("clamps at both edges", () => {
    expect(resize("ArrowLeft", 182)).toBe(180);
    expect(resize("ArrowRight", 418)).toBe(420);
    expect(resize("Home")).toBe(180);
    expect(resize("End")).toBe(420);
  });

  it("resets with Enter and ignores unrelated keys", () => {
    expect(resize("Enter")).toBe(260);
    expect(resize("Escape")).toBeNull();
  });

  it("never reports a maximum below the minimum", () => {
    expect(
      resizeWidthForKey({
        current: 200,
        min: 180,
        max: 120,
        defaultWidth: 160,
        key: "End",
      }),
    ).toBe(180);
    expect(
      resizeWidthForKey({
        current: 200,
        min: 180,
        max: 120,
        defaultWidth: 160,
        key: "ArrowRight",
      }),
    ).toBe(180);
  });
});
