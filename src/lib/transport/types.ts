export type UnlistenFn = () => void;

export type TransportEvent<T> = {
  event: string;
  id: number;
  payload: T;
};

export type ListenOptions = {
  target?: string | { kind: string; label?: string };
};

export type EventHandler<T> = (event: TransportEvent<T>) => void;

export type HostTransport = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: EventHandler<T>, options?: ListenOptions): Promise<UnlistenFn>;
  close?(): void;
};

/**
 * The transport for this device. Only it can broadcast an event between the
 * windows of this client — a host has no windows to tell.
 */
export type LocalTransport = HostTransport & {
  emit(event: string, payload?: unknown): Promise<void>;
};

export type ConnectionPhase =
  | "local"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "resynchronizing"
  | "offline";

export type HostPlatform = "macos" | "windows" | "linux" | "unknown";

export type ConnectionSnapshot = {
  phase: ConnectionPhase;
  hostId: string;
  name: string;
  platform: HostPlatform;
  endpoint?: string;
  retryInMs?: number;
  error?: string;
};

export type RemoteConnection = {
  endpoint: string;
  token: string;
  name?: string;
};
