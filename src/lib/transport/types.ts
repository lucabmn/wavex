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
  emit(event: string, payload?: unknown): Promise<void>;
  close?(): void;
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
