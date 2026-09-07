import { afterEach, describe, expect, it } from "vitest";

import { setUnqualifiedHost } from "@/lib/host";
import { sessionHostId } from "@/lib/session";

/**
 * Which machine a session's work belongs to when its path names none.
 *
 * A bare path is unqualified, and what "unqualified" means is a property of
 * the client: this device on the desktop, and the host that served the page in
 * a browser tab, which has no device of its own.
 */
afterEach(() => {
  setUnqualifiedHost("local");
});

describe("sessionHostId", () => {
  it("keeps a bare path on this device for a desktop client", () => {
    expect(sessionHostId({ cwd: "/repo" })).toBe("local");
  });

  it("reads the host out of a project reference", () => {
    expect(sessionHostId({ cwd: "wavex-host://dev-box//srv/app" })).toBe("dev-box");
  });

  it("prefers the host the session already carries", () => {
    expect(sessionHostId({ hostId: "dev-box", cwd: "/repo" })).toBe("dev-box");
  });

  it("sends a browser client's bare path to the host that served the page", () => {
    // A worktree session's cwd is a bare child path that names no host at all.
    // Answering "local" here would route the turn to a machine a tab does not
    // have, and the harness would fail with a command that never left it.
    setUnqualifiedHost("host-dev-box");
    expect(sessionHostId({ cwd: "/srv/app/.worktrees/feature" })).toBe("host-dev-box");
  });
});
