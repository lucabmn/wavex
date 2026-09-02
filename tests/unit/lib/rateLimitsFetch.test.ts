import { describe, expect, it } from "vitest";
import { codexUsageChildId } from "@/lib/rateLimitsFetch";

describe("codexUsageChildId", () => {
  it("does not collide across menu-bar and app WebViews", () => {
    expect(codexUsageChildId("app-window", 1)).not.toBe(codexUsageChildId("menu-bar", 1));
  });
});
