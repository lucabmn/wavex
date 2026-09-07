import { ticketEndpoint } from "./endpoint";
import { RESYNC_REQUIRED_EVENT } from "./events";
import type {
  ConnectionSnapshot,
  EventHandler,
  HostPlatform,
  HostTransport,
  ListenOptions,
  RemoteConnection,
  TransportEvent,
  UnlistenFn,
} from "./types";

const MAX_PENDING_CALLS = 256;
const RECONNECT_DELAYS = [400, 800, 1_500, 3_000, 5_000, 10_000] as const;
const PROTOCOL = "wavex.remote.v1";

type ReadyMessage = {
  type: "ready";
  host: { id: string; name: string; platform: HostPlatform };
  stream: { id: string; oldestSequence: number; latestSequence: number };
};

type ResultMessage =
  | { type: "result"; id: number; ok: true; value: unknown }
  | { type: "result"; id: number; ok: false; error: string };

type EventMessage = {
  type: "event";
  streamId: string;
  sequence: number;
  event: string;
  payload: unknown;
};

/** A run of events in sequence order, which is how a busy host sends them. */
type EventBatchMessage = {
  type: "events";
  streamId: string;
  events: Array<{ sequence: number; event: string; payload: unknown }>;
};

type ServerMessage =
  | ReadyMessage
  | ResultMessage
  | EventMessage
  | EventBatchMessage
  | { type: "sync_complete"; streamId: string; throughSequence: number }
  | { type: "resync_required"; streamId: string; latestSequence: number; reason?: string };

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type SocketFactory = (url: string, protocols: string[]) => WebSocket;
type Fetch = typeof fetch;

export type StreamPosition = { streamId: string; sequence: number };

export type RemoteTransportOptions = {
  fetch?: Fetch;
  socket?: SocketFactory;
  onChange?: () => void;
  /**
   * Where this client stopped reading the host's stream. A reconnect that
   * carries it is handed the events it missed; one that does not silently
   * starts at the host's latest, which is a transcript with a hole in it.
   */
  resume?: StreamPosition;
};

export class RemoteHostTransport implements HostTransport {
  private socket: WebSocket | null = null;
  /** The host answered `ready`, so commands can travel even mid-resync. */
  private handshaken = false;
  private connectionPromise: Promise<void> | null = null;
  private connectionResolve: (() => void) | null = null;
  private connectionReject: ((error: Error) => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** A ticket is being spent right now; the socket it buys is not here yet. */
  private opening = false;
  private retryAttempt = 0;
  private nextId = 1;
  private streamId: string | null = null;
  private sequence = 0;
  private pendingResync: { streamId: string; latestSequence: number } | null = null;
  private closed = false;
  private refusal: string | null = null;
  private pending = new Map<number, PendingCall>();
  private listeners = new Map<string, Set<EventHandler<unknown>>>();
  private snapshot: ConnectionSnapshot;
  private readonly fetcher: Fetch;
  private readonly socketFactory: SocketFactory;
  private readonly onChange: () => void;

  constructor(
    private readonly hostId: string,
    private readonly connection: RemoteConnection,
    options: RemoteTransportOptions = {},
  ) {
    // WebKit rejects a bare `fetch` reference called with any other receiver
    // ("Can only call Window.fetch on instances of Window"), so the global one
    // stays bound to the window it belongs to.
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.socketFactory = options.socket ?? ((url, protocols) => new WebSocket(url, protocols));
    this.onChange = options.onChange ?? (() => undefined);
    if (options.resume) {
      this.streamId = options.resume.streamId;
      this.sequence = options.resume.sequence;
    }
    this.snapshot = {
      phase: "connecting",
      hostId,
      name: connection.name?.trim() || "Remote host",
      platform: "unknown",
      endpoint: connection.endpoint,
    };
  }

  getSnapshot(): ConnectionSnapshot {
    return this.snapshot;
  }

  /** What a later connection to this host resumes from. */
  streamPosition(): StreamPosition | null {
    return this.streamId ? { streamId: this.streamId, sequence: this.sequence } : null;
  }

  private canSend(): boolean {
    return this.handshaken && this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    if (this.refusal) return Promise.reject(new Error(this.refusal));
    if (this.snapshot.phase === "connected") return Promise.resolve();
    if (this.snapshot.phase === "resynchronizing" && this.canSend()) return Promise.resolve();
    const promise = this.connectionPromise ?? this.makeConnectionPromise();
    if (!this.socket && !this.retryTimer && !this.opening) void this.open();
    return promise;
  }

  close(): void {
    this.closed = true;
    this.handshaken = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close(1000, "Client disconnected");
    this.socket = null;
    this.rejectPending("Connection closed before the host replied");
    this.rejectConnection("Connection closed");
    this.setSnapshot({ ...this.snapshot, phase: "offline", retryInMs: undefined });
  }

  async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    // A resync barrier is lifted by refetching host state, so gate commands on
    // a live handshake rather than on the connected phase — waiting for the
    // phase here would make the refetch wait on itself.
    if (!this.canSend()) await this.connect();
    if (!this.canSend()) {
      throw new Error("The host is not connected");
    }
    if (this.pending.size >= MAX_PENDING_CALLS) {
      throw new Error("The host is busy; wait for earlier requests to finish");
    }

    const id = this.nextId++;
    const result = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
    });
    this.send({ type: "invoke", id, command, args });
    return result;
  }

  async listen<T>(
    event: string,
    handler: EventHandler<T>,
    _options?: ListenOptions,
  ): Promise<UnlistenFn> {
    const handlers = this.listeners.get(event) ?? new Set<EventHandler<unknown>>();
    handlers.add(handler as EventHandler<unknown>);
    this.listeners.set(event, handlers);
    // A barrier that is already up has to be announced to whoever arrives
    // next: the resync was raised during the connect this caller awaited, so
    // the one announcement it would otherwise get was made to nobody, and the
    // barrier would never come down.
    if (event === RESYNC_REQUIRED_EVENT && this.pendingResync) {
      const pending = this.pendingResync;
      (handler as EventHandler<unknown>)({
        event,
        id: pending.latestSequence,
        payload: { hostId: this.hostId, streamId: pending.streamId },
      });
    }
    void this.connect().catch(() => undefined);
    return () => {
      handlers.delete(handler as EventHandler<unknown>);
      if (handlers.size === 0) this.listeners.delete(event);
    };
  }

  /** Resume event delivery only after the caller replaced stale domain state. */
  completeResync(): void {
    const pending = this.pendingResync;
    if (!pending) return;
    this.pendingResync = null;
    this.streamId = pending.streamId;
    this.sequence = pending.latestSequence;
    this.send({
      type: "subscribe",
      streamId: pending.streamId,
      afterSequence: pending.latestSequence,
    });
  }

  private makeConnectionPromise(): Promise<void> {
    this.connectionPromise = new Promise<void>((resolve, reject) => {
      this.connectionResolve = resolve;
      this.connectionReject = reject;
    });
    return this.connectionPromise;
  }

  private async open(): Promise<void> {
    if (this.closed || this.opening) return;
    // A caller that connects and a listener that arrives during the ticket
    // exchange both find no socket yet. Without this the second one buys a
    // second ticket and opens a second connection, and whichever loses the
    // race reports the host as unreachable while it is answering the other.
    this.opening = true;
    try {
      await this.openSocket();
    } finally {
      this.opening = false;
    }
  }

  private async openSocket(): Promise<void> {
    if (this.closed) return;
    this.setSnapshot({
      ...this.snapshot,
      phase: this.retryAttempt === 0 ? "connecting" : "reconnecting",
      retryInMs: undefined,
      error: undefined,
    });

    let ticket: string;
    try {
      ticket = await this.acquireTicket();
    } catch (error) {
      this.failAuthentication(error instanceof Error ? error.message : String(error));
      return;
    }
    if (this.closed) return;

    let socket: WebSocket;
    try {
      socket = this.socketFactory(this.connection.endpoint, [PROTOCOL, `wavex-ticket.${ticket}`]);
    } catch (error) {
      this.failConnection(error instanceof Error ? error.message : String(error));
      return;
    }

    this.socket = socket;
    socket.addEventListener("message", (event) => this.onMessage(String(event.data)));
    socket.addEventListener("error", () => {
      if (socket === this.socket && socket.readyState !== WebSocket.OPEN) {
        this.failConnection("Could not reach the host");
      }
    });
    socket.addEventListener("close", (event) => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.handshaken = false;
      this.rejectPending("Connection interrupted before the host replied");
      if (event.code === 4001 || event.code === 4003) {
        this.closed = true;
        this.failAuthentication(event.reason || "The host refused this connection");
        return;
      }
      this.scheduleReconnect();
    });
  }

  private async acquireTicket(): Promise<string> {
    const auth = this.connection.auth;
    // A bearer is a header, so it never depends on the browser deciding to
    // attach anything; a cookie session is the opposite and is only ever sent
    // same-origin, which is also the only place the host will honour it.
    const response = await this.fetcher(ticketEndpoint(this.connection.endpoint), {
      method: "POST",
      headers:
        auth.kind === "bearer"
          ? { Authorization: `Bearer ${auth.token}`, "X-Wavex-Protocol": PROTOCOL }
          : { "X-Wavex-Protocol": PROTOCOL },
      credentials: auth.kind === "cookie" ? "same-origin" : "omit",
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        auth.kind === "cookie"
          ? "This host no longer recognises this browser. Paste its connection code again."
          : "Authentication failed. Replace the host token and try again.",
      );
    }
    if (!response.ok) throw new Error(`The host returned HTTP ${response.status} while pairing`);

    const body = (await response.json()) as { ticket?: unknown };
    if (typeof body.ticket !== "string" || !/^[A-Za-z0-9_-]{20,512}$/.test(body.ticket)) {
      throw new Error("The host returned an invalid connection ticket");
    }
    return body.ticket;
  }

  private onMessage(raw: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      this.socket?.close(4002, "Invalid host message");
      return;
    }

    if (message.type === "ready") {
      this.onReady(message);
      return;
    }
    if (message.type === "result") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.value);
      else pending.reject(new Error(message.error || "The host rejected the request"));
      return;
    }
    if (message.type === "resync_required") {
      this.requireResync(message.streamId, message.latestSequence, message.reason);
      return;
    }
    if (message.type === "sync_complete") {
      if (message.streamId !== this.streamId) return;
      this.sequence = Math.max(this.sequence, message.throughSequence);
      this.retryAttempt = 0;
      this.setSnapshot({
        ...this.snapshot,
        phase: "connected",
        retryInMs: undefined,
        error: undefined,
      });
      this.resolveConnection();
      return;
    }
    if (message.type === "events") {
      for (const event of message.events) {
        this.onEvent({
          type: "event",
          streamId: message.streamId,
          sequence: event.sequence,
          event: event.event,
          payload: event.payload,
        });
      }
      return;
    }
    this.onEvent(message);
  }

  private onReady(message: ReadyMessage): void {
    if (message.host.id !== this.hostId) {
      const error = "This address belongs to a different host";
      this.closed = true;
      this.socket?.close(4003, error);
      this.failAuthentication(error);
      return;
    }

    this.handshaken = true;
    this.setSnapshot({
      ...this.snapshot,
      name: message.host.name,
      platform: message.host.platform,
    });

    const firstConnection = this.streamId == null;
    if (firstConnection) {
      this.streamId = message.stream.id;
      this.sequence = message.stream.latestSequence;
    } else if (
      this.streamId !== message.stream.id ||
      this.sequence + 1 < message.stream.oldestSequence
    ) {
      this.requireResync(message.stream.id, message.stream.latestSequence);
      return;
    }

    this.send({
      type: "subscribe",
      streamId: this.streamId,
      afterSequence: this.sequence,
    });
  }

  private onEvent(message: EventMessage): void {
    if (message.streamId !== this.streamId || message.sequence <= this.sequence) return;
    if (message.sequence !== this.sequence + 1) {
      if (this.snapshot.phase !== "resynchronizing") {
        this.send({ type: "resync", streamId: this.streamId, afterSequence: this.sequence });
        this.setSnapshot({
          ...this.snapshot,
          phase: "resynchronizing",
          error: "Some host updates were missed; resynchronizing…",
        });
      }
      return;
    }

    this.sequence = message.sequence;
    if (this.snapshot.phase === "resynchronizing" && !this.pendingResync) {
      this.setSnapshot({ ...this.snapshot, phase: "connected", error: undefined });
    }
    this.dispatch(message.event, message.payload, message.sequence);
  }

  private requireResync(streamId: string, latestSequence: number, reason?: string): void {
    this.pendingResync = { streamId, latestSequence };
    // Commands already travel — `invoke` waits on the handshake, not on the
    // phase — so the caller that is waiting to connect is not blocked by the
    // barrier. Leaving its promise pending would strand the very code that
    // has to refetch host state before the barrier can come down.
    this.resolveConnection();
    this.setSnapshot({
      ...this.snapshot,
      phase: "resynchronizing",
      error: reason || "The event backlog expired; refreshing host state…",
    });
    this.dispatch(RESYNC_REQUIRED_EVENT, { hostId: this.hostId, streamId }, latestSequence);
  }

  private dispatch(event: string, payload: unknown, id: number): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    const transportEvent: TransportEvent<unknown> = { event, id, payload };
    for (const handler of handlers) handler(transportEvent);
  }

  private send(value: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(value));
  }

  private scheduleReconnect(): void {
    if (this.closed || this.retryTimer) return;
    if (!this.connectionPromise) this.makeConnectionPromise();
    const delay = RECONNECT_DELAYS[Math.min(this.retryAttempt, RECONNECT_DELAYS.length - 1)];
    this.retryAttempt += 1;
    this.setSnapshot({
      ...this.snapshot,
      phase: "reconnecting",
      retryInMs: delay,
      error: "Connection interrupted. Work continues on the host.",
    });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.open();
    }, delay);
  }

  private failAuthentication(message: string): void {
    this.closed = true;
    this.refusal = message;
    this.setSnapshot({ ...this.snapshot, phase: "offline", retryInMs: undefined, error: message });
    this.rejectConnection(message);
  }

  private failConnection(message: string): void {
    if (this.retryAttempt === 0) {
      this.setSnapshot({
        ...this.snapshot,
        phase: "offline",
        retryInMs: undefined,
        error: message,
      });
      this.rejectConnection(message);
      return;
    }
    this.scheduleReconnect();
  }

  private resolveConnection(): void {
    this.connectionResolve?.();
    this.connectionPromise = null;
    this.connectionResolve = null;
    this.connectionReject = null;
  }

  private rejectConnection(message: string): void {
    this.connectionReject?.(new Error(message));
    this.connectionPromise = null;
    this.connectionResolve = null;
    this.connectionReject = null;
  }

  private rejectPending(message: string): void {
    const error = new Error(message);
    for (const call of this.pending.values()) call.reject(error);
    this.pending.clear();
  }

  private setSnapshot(next: ConnectionSnapshot): void {
    this.snapshot = next;
    this.onChange();
  }
}
