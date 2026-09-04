import { describe, expect, it } from "vitest";
import { nextTabIndex } from "@/lib/tabNavigation";

describe("nextTabIndex", () => {
  it("wraps horizontal arrow navigation", () => {
    expect(nextTabIndex(0, 3, "ArrowLeft")).toBe(2);
    expect(nextTabIndex(2, 3, "ArrowRight")).toBe(0);
  });

  it("supports vertical lists and ignores the other axis", () => {
    expect(nextTabIndex(1, 3, "ArrowUp", "vertical")).toBe(0);
    expect(nextTabIndex(1, 3, "ArrowDown", "vertical")).toBe(2);
    expect(nextTabIndex(1, 3, "ArrowRight", "vertical")).toBeNull();
  });

  it("moves to either edge with Home and End", () => {
    expect(nextTabIndex(2, 5, "Home")).toBe(0);
    expect(nextTabIndex(2, 5, "End")).toBe(4);
  });

  it("does nothing for unrelated keys or an empty list", () => {
    expect(nextTabIndex(0, 3, "Enter")).toBeNull();
    expect(nextTabIndex(0, 0, "ArrowRight")).toBeNull();
  });
});
