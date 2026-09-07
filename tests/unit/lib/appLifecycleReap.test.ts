import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  forgotten: [] as Array<{ sessionId: string; hostId?: string }>,
  killedAll: [] as Array<string | undefined>,
  killedPtys: [] as Array<{ id: string; hostId?: string }>,
  browser: false,
}));

vi.mock("@/lib/clientRuntime", () => ({
  get IS_BROWSER_CLIENT() {
    return mocks.browser;
  },
  get IS_TAURI() {
    return !mocks.browser;
  },
}));

vi.mock("@/lib/harness", () => ({
  bindHarnessSession: () => undefined,
  isLiveHarness: () => true,
  forgetHarnessSession: async (_harness: string, sessionId: string, hostId?: string) => {
    mocks.forgotten.push({ sessionId, hostId });
  },
  killAllChildren: async (hostId?: string) => {
    mocks.killedAll.push(hostId);
  },
}));

vi.mock("@/lib/terminal/pty", () => ({
  killPty: async (id: string, hostId?: string) => {
    mocks.killedPtys.push({ id, hostId });
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: async () => true }));
vi.mock("@/lib/transport", () => ({ invokeLocal: async () => undefined }));

const { reapWindowRuntime } = await import("@/lib/appLifecycle");
const { newSession } = await import("@/lib/session");
const { setUnqualifiedHost } = await import("@/lib/host");

function reset() {
  mocks.forgotten.length = 0;
  mocks.killedAll.length = 0;
  mocks.killedPtys.length = 0;
}

function terminalTab(fileId: string) {
  return {
    id: "tab-1",
    editorPanes: [{ id: "pane-1", files: [{ id: fileId, terminal: true }] }],
    terminalPanes: [],
  } as never;
}

afterEach(() => {
  setUnqualifiedHost("local");
  mocks.browser = false;
});

describe("reapWindowRuntime", () => {
  it("leaves another machine's agents running when this window closes", async () => {
    reset();
    const local = newSession("claude", "/repo");
    const remote = newSession("claude", "wavex-host://dev-box//srv/app");

    await reapWindowRuntime([local, remote], []);

    expect(mocks.forgotten.map((call) => call.sessionId)).toEqual([local.id]);
    // Probes and generators are reaped on this device only, for the same reason,
    // and they say so rather than following whatever host this client routes to.
    expect(mocks.killedAll).toEqual(["local"]);
  });

  it("stops nothing on the host when a browser tab goes away", async () => {
    // A tab has no machine of its own. Every agent, terminal, and probe it can
    // see belongs to the host, which is still running them — closing the tab is
    // a client leaving, not a machine shutting down.
    reset();
    mocks.browser = true;
    setUnqualifiedHost("host-dev-box");
    const session = newSession("claude", "/srv/app");
    const tabs = [terminalTab("term-1")];

    await reapWindowRuntime([session], tabs);

    expect(mocks.forgotten).toEqual([]);
    expect(mocks.killedPtys).toEqual([]);
    expect(mocks.killedAll).toEqual([]);
  });
});
