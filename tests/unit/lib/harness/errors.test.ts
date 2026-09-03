import { describe, expect, it } from "vitest";
import { harnessErrorMessage } from "@/lib/harness/errors";

describe("harnessErrorMessage", () => {
  it("keeps the message a rejected Tauri command carries", () => {
    // `invoke` rejects with the command's raw `Err(String)`, not an Error.
    expect(harnessErrorMessage("Harness process is not running", "claude")).toBe(
      "Harness process is not running",
    );
  });

  it("keeps an Error message", () => {
    expect(harnessErrorMessage(new Error("Claude Code exited"), "claude")).toBe(
      "Claude Code exited",
    );
  });

  it("falls back only when there is nothing to say", () => {
    expect(harnessErrorMessage(new Error("  "), "claude")).toBe("claude adapter failed");
    expect(harnessErrorMessage("", "claude")).toBe("claude adapter failed");
    expect(harnessErrorMessage({ code: 1 }, "codex")).toBe("codex adapter failed");
  });
});
