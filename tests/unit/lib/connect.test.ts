import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  completeRemoteResync: vi.fn(),
  connectionSnapshot: vi.fn(() => ({
    phase: "connected",
    hostId: "host-1",
    name: "Dev box",
    platform: "linux",
  })),
  connectRemoteHost: vi.fn(async () => undefined),
  disconnectRemoteHost: vi.fn(),
  emit: vi.fn(async () => undefined),
  invokeLocal: vi.fn(),
  invokeOn: vi.fn(async () => undefined),
  listenOn: vi.fn(
    async (_hostId: string, _event: string, _handler: () => void): Promise<() => void> =>
      () =>
        undefined,
  ),
  subscribeConnection: vi.fn(() => () => undefined),
  LOCAL_HOST_ID: "local",
  RESYNC_REQUIRED_EVENT: "wavex://resync-required",
}));

vi.mock("@/lib/transport", () => transport);

const {
  connectionLabel,
  connectSavedHost,
  getConnectSnapshot,
  HOST_RESYNCED_EVENT,
  onHostResynced,
  refreshConnect,
} = await import("@/lib/connect");

describe("connectionLabel", () => {
  it("names each phase the way the chrome shows it", () => {
    expect(connectionLabel({ phase: "connected", hostId: "h", name: "", platform: "linux" })).toBe(
      "Connected",
    );
    expect(
      connectionLabel({ phase: "reconnecting", hostId: "h", name: "", platform: "linux" }),
    ).toBe("Reconnecting…");
    expect(
      connectionLabel({ phase: "resynchronizing", hostId: "h", name: "", platform: "linux" }),
    ).toBe("Catching up…");
    expect(connectionLabel(undefined)).toBe("Not connected");
  });

  it("shows why an offline host is offline rather than only that it is", () => {
    expect(
      connectionLabel({
        phase: "offline",
        hostId: "h",
        name: "",
        platform: "linux",
        error: "Authentication failed",
      }),
    ).toBe("Authentication failed");
  });
});

describe("the paired host list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads status and hosts from the host rather than from browser storage", async () => {
    transport.invokeLocal.mockImplementation(async (command: string) => {
      if (command === "connect_host_status") {
        return {
          hostId: "host-self",
          name: "This machine",
          platform: "macos",
          running: true,
          port: 8787,
          clients: 0,
        };
      }
      return [
        { hostId: "host-1", name: "Dev box", endpoint: "ws://127.0.0.1:8787/api/v1/connect" },
      ];
    });

    await refreshConnect();

    const snapshot = getConnectSnapshot();
    expect(snapshot.status?.port).toBe(8787);
    expect(snapshot.hosts).toHaveLength(1);
    expect(snapshot.connections["host-1"]?.phase).toBe("connected");
  });
});

describe("the replay barrier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reloads host state before it lets events start again", async () => {
    const order: string[] = [];
    let onResync: (() => void) | undefined;
    transport.invokeLocal.mockResolvedValue({
      hostId: "host-1",
      name: "Dev box",
      endpoint: "ws://127.0.0.1:8787/api/v1/connect",
      token: "long-lived-secret",
    });
    transport.listenOn.mockImplementation(
      async (_host: string, _event: string, handler: () => void) => {
        onResync = handler;
        return () => undefined;
      },
    );
    transport.invokeOn.mockImplementation(async () => {
      order.push("reload");
    });
    transport.emit.mockImplementation(async () => {
      order.push("announce");
    });
    transport.completeRemoteResync.mockImplementation(() => {
      order.push("resume");
    });

    await connectSavedHost("host-1");
    expect(transport.connectRemoteHost).toHaveBeenCalledWith(
      "host-1",
      expect.objectContaining({ auth: { kind: "bearer", token: "long-lived-secret" } }),
    );

    onResync?.();
    await vi.waitFor(() => expect(order).toContain("resume"));
    // Lifting the barrier first would reopen the stream onto state the client
    // already knows is stale.
    expect(order).toEqual(["reload", "announce", "resume"]);
    expect(transport.emit).toHaveBeenCalledWith(HOST_RESYNCED_EVENT, { hostId: "host-1" });
  });

  it("waits for this window's stores before it reopens the stream", async () => {
    const order: string[] = [];
    let onResync: (() => void) | undefined;
    let finishReload: (() => void) | undefined;
    transport.invokeLocal.mockResolvedValue({
      hostId: "host-2",
      name: "Dev box",
      endpoint: "ws://127.0.0.1:8787/api/v1/connect",
      token: "long-lived-secret",
    });
    transport.listenOn.mockImplementation(
      async (_host: string, _event: string, handler: () => void) => {
        onResync = handler;
        return () => undefined;
      },
    );
    transport.completeRemoteResync.mockImplementation(() => order.push("resume"));

    const release = onHostResynced(async (hostId) => {
      expect(hostId).toBe("host-2");
      order.push("store reload started");
      await new Promise<void>((resolve) => {
        finishReload = resolve;
      });
      order.push("store reload finished");
    });

    await connectSavedHost("host-2");
    onResync?.();
    await vi.waitFor(() => expect(order).toContain("store reload started"));
    // The whole reason this is a registry and not only a broadcast: an event
    // merely announced would be answered after the stream had resumed, and
    // the reload would race the events it was meant to replace.
    expect(order).not.toContain("resume");

    finishReload?.();
    await vi.waitFor(() => expect(order).toContain("resume"));
    expect(order).toEqual(["store reload started", "store reload finished", "resume"]);
    release();
  });
});
