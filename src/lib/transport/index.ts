/**
 * wavex Link transport seam. Host-owned commands and streams route through a
 * host identity; client-local window and dialog behavior stays outside it.
 */
import { LOCAL_HOST_ID, isRemoteHostId, type HostId } from "../host";
import { normalizeRemoteEndpoint } from "./endpoint";
import { RemoteHostTransport, type RemoteTransportOptions } from "./remote";
import { createTauriTransport } from "./tauri";
import type {
  ConnectionSnapshot,
  EventHandler,
  HostTransport,
  ListenOptions,
  RemoteConnection,
  UnlistenFn,
} from "./types";

export type {
  ConnectionPhase,
  ConnectionSnapshot,
  HostPlatform,
  HostTransport,
  ListenOptions,
  RemoteConnection,
  TransportEvent,
  UnlistenFn,
} from "./types";
export { normalizeRemoteEndpoint, ticketEndpoint } from "./endpoint";
export { RESYNC_REQUIRED_EVENT } from "./events";
export { LOCAL_HOST_ID, type HostId } from "../host";
export { RemoteHostTransport, type RemoteTransportOptions } from "./remote";

const local = createTauriTransport();
const remoteHosts = new Map<string, RemoteHostTransport>();
const listeners = new Set<() => void>();
let defaultHostId: HostId = LOCAL_HOST_ID;

function announce(): void {
  for (const listener of listeners) listener();
}

function transportFor(hostId: HostId): HostTransport {
  if (hostId === LOCAL_HOST_ID) return local;
  const transport = remoteHosts.get(hostId);
  if (!transport) throw new Error(`Host ${hostId} is not configured`);
  return transport;
}

/**
 * Register a remote host without changing the desktop's local default. Callers
 * that own a host-scoped project use invokeOn/listenOn; a browser client may
 * explicitly set this host as its default during bootstrap.
 */
export async function connectRemoteHost(
  hostId: string,
  connection: RemoteConnection,
  options: RemoteTransportOptions = {},
): Promise<void> {
  if (!isRemoteHostId(hostId)) throw new Error("A remote host needs its own identity");
  remoteHosts.get(hostId)?.close();
  const transport = new RemoteHostTransport(
    hostId,
    { ...connection, endpoint: normalizeRemoteEndpoint(connection.endpoint) },
    { ...options, onChange: announce },
  );
  remoteHosts.set(hostId, transport);
  announce();
  try {
    await transport.connect();
  } catch (error) {
    announce();
    throw error;
  }
}

export function completeRemoteResync(hostId: HostId): void {
  const transport = remoteHosts.get(hostId);
  if (!transport) throw new Error(`Host ${hostId} is not configured`);
  transport.completeResync();
}

export function disconnectRemoteHost(hostId: HostId): void {
  const transport = remoteHosts.get(hostId);
  if (!transport) return;
  transport.close();
  remoteHosts.delete(hostId);
  if (defaultHostId === hostId) defaultHostId = LOCAL_HOST_ID;
  announce();
}

/** Browser bootstrap only. Desktop workspaces route each project explicitly. */
export function setDefaultHost(hostId: HostId): void {
  transportFor(hostId);
  defaultHostId = hostId;
  announce();
}

export function getDefaultHostId(): HostId {
  return defaultHostId;
}

export function connectionSnapshot(hostId = defaultHostId): ConnectionSnapshot {
  if (hostId === LOCAL_HOST_ID) {
    return {
      phase: "local",
      hostId: LOCAL_HOST_ID,
      name: "This device",
      platform: "unknown",
    };
  }
  const transport = remoteHosts.get(hostId);
  return (
    transport?.getSnapshot() ?? {
      phase: "offline",
      hostId,
      name: "Remote host",
      platform: "unknown",
      error: "This host is not configured",
    }
  );
}

export function subscribeConnection(listener: () => void): UnlistenFn {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function invokeOn<T>(
  hostId: HostId,
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return transportFor(hostId).invoke<T>(command, args);
}

export function listenOn<T>(
  hostId: HostId,
  event: string,
  handler: EventHandler<T>,
  options?: ListenOptions,
): Promise<UnlistenFn> {
  return transportFor(hostId).listen(event, handler, options);
}

export function emitOn(hostId: HostId, event: string, payload?: unknown): Promise<void> {
  return transportFor(hostId).emit(event, payload);
}

/** Existing local wrappers keep this shape while host identity migrates upward. */
export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invokeOn<T>(defaultHostId, command, args);
}

export function listen<T>(
  event: string,
  handler: EventHandler<T>,
  options?: ListenOptions,
): Promise<UnlistenFn> {
  return listenOn(defaultHostId, event, handler, options);
}

export function emit(event: string, payload?: unknown): Promise<void> {
  return emitOn(defaultHostId, event, payload);
}
