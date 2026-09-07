import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  invokeOn: vi.fn(async () => undefined),
  getDefaultHostId: vi.fn(() => "local"),
}));

vi.mock("@/lib/transport", () => transport);

import { gitDiffIndex, isCheckoutBlockedByChanges, listDir, readTextFile } from "@/lib/fs";

describe("host routing", () => {
  beforeEach(() => {
    transport.invokeOn.mockClear();
    transport.getDefaultHostId.mockReturnValue("local");
  });

  it("sends a project root on this device to this device, unchanged", async () => {
    await gitDiffIndex("/home/me/app");
    expect(transport.invokeOn).toHaveBeenCalledWith("local", "git_diff_index", {
      cwd: "/home/me/app",
    });
  });

  it("follows the host a project reference names, with no host argument", async () => {
    await gitDiffIndex("wavex-host://dev-box//srv/app");
    expect(transport.invokeOn).toHaveBeenCalledWith("dev-box", "git_diff_index", {
      cwd: "/srv/app",
    });
  });

  it("never puts a reference on the wire", async () => {
    await listDir("wavex-host://dev-box//srv/app");
    expect(transport.invokeOn).toHaveBeenCalledWith("dev-box", "list_dir", { path: "/srv/app" });
  });

  it("lets a caller that knows the host override the reference", async () => {
    await gitDiffIndex("wavex-host://dev-box//srv/app", "cloud-vm");
    expect(transport.invokeOn).toHaveBeenCalledWith("cloud-vm", "git_diff_index", {
      cwd: "/srv/app",
    });
  });

  it("sends a child path to the host its caller passed", async () => {
    await readTextFile("/srv/app/src/main.rs", "dev-box");
    expect(transport.invokeOn).toHaveBeenCalledWith("dev-box", "read_text_file", {
      path: "/srv/app/src/main.rs",
    });
  });
});

describe("isCheckoutBlockedByChanges", () => {
  it("detects git's tracked-file checkout error", () => {
    expect(
      isCheckoutBlockedByChanges(
        "error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\nPlease commit your changes or stash them before you switch branches.",
      ),
    ).toBe(true);
  });

  it("detects git's untracked-file checkout error", () => {
    expect(
      isCheckoutBlockedByChanges(
        "error: The following untracked working tree files would be overwritten by checkout:\n\tnew.txt\nPlease move or remove them before you switch branches.",
      ),
    ).toBe(true);
  });

  it("detects the mapped app error", () => {
    expect(
      isCheckoutBlockedByChanges(
        "Your local changes would be overwritten. Commit or stash them first.",
      ),
    ).toBe(true);
  });

  it("ignores unrelated git errors", () => {
    expect(isCheckoutBlockedByChanges("Branch missing not found")).toBe(false);
    expect(isCheckoutBlockedByChanges("Not a git repository")).toBe(false);
  });
});
