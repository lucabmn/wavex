import { describe, expect, it, vi } from "vitest";
import { RemoteHostTransport } from "@/lib/transport";

class FakeSocket {
  readyState = WebSocket.OPEN;
  sent: string[] = [];
  protocols: string[] = [];
  private listeners = new Map<string, Set<(event: MessageEvent | CloseEvent | Event) => void>>();

  addEventListener(name: string, listener: (event: MessageEvent | CloseEvent | Event) => void) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }

  send(value: string) {
    this.sent.push(value);
  }

  close() {}

  message(value: unknown) {
    this.dispatch("message", { data: JSON.stringify(value) } as MessageEvent);
  }

  private dispatch(name: string, event: MessageEvent | CloseEvent | Event) {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setup() {
  const socket = new FakeSocket();
  const fetcher = vi.fn(async () => response({ ticket: "a_secure_one_time_ticket" }));
  const transport = new RemoteHostTransport(
    "host-1",
    {
      endpoint: "wss://dev.example.com/api/v1/connect",
      token: "long-lived-secret",
      name: "Dev box",
    },
    {
      fetch: fetcher,
      socket: (_url, protocols) => {
        socket.protocols = protocols;
        return socket as unknown as WebSocket;
      },
    },
  );
  return { fetcher, socket, transport };
}

function completeHandshake(socket: FakeSocket) {
  socket.message({
    type: "ready",
    host: { id: "host-1", name: "Desk workstation", platform: "linux" },
    stream: { id: "stream-a", oldestSequence: 4, latestSequence: 8 },
  });
  socket.message({
    type: "sync_complete",
    streamId: "stream-a",
    throughSequence: 8,
  });
}

describe("RemoteHostTransport", () => {
  it("exchanges the bearer for a one-time websocket ticket", async () => {
    const { fetcher, socket, transport } = setup();
    const connected = transport.connect();
    await vi.waitFor(() => expect(socket.protocols).toHaveLength(2));

    expect(fetcher).toHaveBeenCalledWith(
      "https://dev.example.com/api/v1/tickets",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer long-lived-secret" }),
      }),
    );
    expect(socket.protocols).toEqual(["wavex.remote.v1", "wavex-ticket.a_secure_one_time_ticket"]);
    expect(socket.protocols.join(" ")).not.toContain("long-lived-secret");

    completeHandshake(socket);
    await connected;
    expect(transport.getSnapshot()).toMatchObject({
      phase: "connected",
      name: "Desk workstation",
      platform: "linux",
    });
  });

  it("correlates out-of-order command results", async () => {
    const { socket, transport } = setup();
    const connected = transport.connect();
    await vi.waitFor(() => expect(socket.protocols).toHaveLength(2));
    completeHandshake(socket);
    await connected;

    const first = transport.invoke<string>("first");
    const second = transport.invoke<string>("second");
    await vi.waitFor(() => {
      const commands = socket.sent
        .map((value) => JSON.parse(value))
        .filter((item) => item.type === "invoke");
      expect(commands).toHaveLength(2);
    });
    socket.message({ type: "result", id: 2, ok: true, value: "two" });
    socket.message({ type: "result", id: 1, ok: true, value: "one" });

    await expect(first).resolves.toBe("one");
    await expect(second).resolves.toBe("two");
  });

  it("deduplicates replayed events and detects a sequence gap", async () => {
    const { socket, transport } = setup();
    const events: string[] = [];
    await transport.listen<{ line: string }>("harness-stdout", ({ payload }) => {
      events.push(payload.line);
    });
    await vi.waitFor(() => expect(socket.protocols).toHaveLength(2));
    completeHandshake(socket);

    socket.message({
      type: "event",
      streamId: "stream-a",
      sequence: 9,
      event: "harness-stdout",
      payload: { line: "once" },
    });
    socket.message({
      type: "event",
      streamId: "stream-a",
      sequence: 9,
      event: "harness-stdout",
      payload: { line: "duplicate" },
    });
    socket.message({
      type: "event",
      streamId: "stream-a",
      sequence: 11,
      event: "harness-stdout",
      payload: { line: "gap" },
    });

    expect(events).toEqual(["once"]);
    expect(transport.getSnapshot().phase).toBe("resynchronizing");
    expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual({
      type: "resync",
      streamId: "stream-a",
      afterSequence: 9,
    });
  });

  it("holds the replay barrier until stale domain state is replaced", async () => {
    const { socket, transport } = setup();
    const connected = transport.connect();
    await vi.waitFor(() => expect(socket.protocols).toHaveLength(2));
    completeHandshake(socket);
    await connected;

    socket.message({
      type: "resync_required",
      streamId: "stream-b",
      latestSequence: 40,
      reason: "Backlog expired",
    });
    expect(transport.getSnapshot().phase).toBe("resynchronizing");
    expect(socket.sent.map((value) => JSON.parse(value))).not.toContainEqual({
      type: "subscribe",
      streamId: "stream-b",
      afterSequence: 40,
    });

    transport.completeResync();
    expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual({
      type: "subscribe",
      streamId: "stream-b",
      afterSequence: 40,
    });
  });

  it("serves the resync refetch while the replay barrier is closed", async () => {
    const { socket, transport } = setup();
    const connected = transport.connect();
    await vi.waitFor(() => expect(socket.protocols).toHaveLength(2));
    completeHandshake(socket);
    await connected;

    socket.message({ type: "resync_required", streamId: "stream-b", latestSequence: 40 });

    // The consumer replaces stale state by calling the host, so a command sent
    // during the barrier must not wait on the barrier it is there to lift.
    const reloaded = transport.invoke<string>("session_store_read");
    await vi.waitFor(() => {
      const commands = socket.sent
        .map((value) => JSON.parse(value))
        .filter((item) => item.type === "invoke");
      expect(commands).toHaveLength(1);
    });
    socket.message({ type: "result", id: 1, ok: true, value: "fresh" });
    await expect(reloaded).resolves.toBe("fresh");
  });

  it("reports authentication failure without opening a socket", async () => {
    const socket = vi.fn();
    const transport = new RemoteHostTransport(
      "host-1",
      { endpoint: "wss://dev.example.com/api/v1/connect", token: "bad" },
      {
        fetch: async () => response({}, 401),
        socket,
      },
    );

    await expect(transport.connect()).rejects.toThrow("Authentication failed");
    expect(socket).not.toHaveBeenCalled();
    expect(transport.getSnapshot().phase).toBe("offline");
  });
});
