/**
 * wavex Link transport seam. Host-owned commands and streams route through a
 * host identity; client-local window and dialog behavior stays outside it.
 */
import {
  hostPathArgs,
  isRemoteHostId,
  LOCAL_HOST_ID,
  setUnqualifiedHost,
  unqualifiedHost,
  type HostId,
} from "../host";
import { normalizeRemoteEndpoint } from "./endpoint";
import type { HostEventReplay } from "./hostEvents";
import { RemoteHostTransport, type RemoteTransportOptions, type StreamPosition } from "./remote";
import { createLocalTransport } from "./local";
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
  HostAuth,
  HostPlatform,
  HostTransport,
  ListenOptions,
  RemoteConnection,
  TransportEvent,
  UnlistenFn,
} from "./types";
export { normalizeRemoteEndpoint, ticketEndpoint } from "./endpoint";
export { RESYNC_REQUIRED_EVENT } from "./events";
export { type HostEvent, type HostEventReplay } from "./hostEvents";
export { LOCAL_HOST_ID, type HostId } from "../host";
export { RemoteHostTransport, type RemoteTransportOptions } from "./remote";

const local = createLocalTransport();
const remoteHosts = new Map<string, RemoteHostTransport>();
/**
 * Where each host's stream stood when this client last let go of it. A
 * connection the user closed deliberately is still a client coming back to a
 * machine that kept working, so the next one resumes rather than restarts.
 */
const streamPositions = new Map<string, StreamPosition>();
const listeners = new Set<() => void>();

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
  rememberPosition(hostId);
  remoteHosts.get(hostId)?.close();
  const resume = options.resume ?? streamPositions.get(hostId);
  const transport = new RemoteHostTransport(
    hostId,
    { ...connection, endpoint: normalizeRemoteEndpoint(connection.endpoint) },
    { ...options, ...(resume ? { resume } : {}), onChange: announce },
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
  rememberPosition(hostId);
  transport.close();
  remoteHosts.delete(hostId);
  if (unqualifiedHost() === hostId) setUnqualifiedHost(LOCAL_HOST_ID);
  announce();
}

function rememberPosition(hostId: HostId): void {
  const position = remoteHosts.get(hostId)?.streamPosition();
  if (position) streamPositions.set(hostId, position);
}

/**
 * Browser bootstrap only. Desktop workspaces route each project explicitly.
 *
 * The value itself lives in `host.ts`, because it is not a fact about the
 * transport: it is what this client means by an unqualified name, and the path
 * and session vocabulary has to read it without knowing a transport exists.
 */
export function setDefaultHost(hostId: HostId): void {
  transportFor(hostId);
  setUnqualifiedHost(hostId);
  announce();
}

export function getDefaultHostId(): HostId {
  return unqualifiedHost();
}

/**
 * The machine a project reference names. A bare path is a project on whatever
 * this client's default host is, which on the desktop is this device.
 */
export function hostIdForProject(value: string): HostId {
  return hostPathArgs(value, undefined, unqualifiedHost()).hostId;
}

export function connectionSnapshot(hostId = unqualifiedHost()): ConnectionSnapshot {
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

/** Existing local wrappers keep this shape while host identity migrates upward. */
export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invokeOn<T>(unqualifiedHost(), command, args);
}

export function listen<T>(
  event: string,
  handler: EventHandler<T>,
  options?: ListenOptions,
): Promise<UnlistenFn> {
  return listenOn(unqualifiedHost(), event, handler, options);
}

/**
 * Tell the other windows of this client something changed. This never travels
 * to a host: it is window state, and a host has no windows.
 */
export function emit(event: string, payload?: unknown): Promise<void> {
  return local.emit(event, payload);
}

/**
 * Native window behavior this client owns — the Dock badge, the menu bar
 * popover, vibrancy, traffic lights, the native menu's own events. It belongs
 * to the machine drawing the window, so it never follows the default host: a
 * remote host has no Dock to badge, and a browser tab has none of it at all.
 */
export function hostEventsSince(
  afterSequence: number,
  hostId: HostId = LOCAL_HOST_ID,
): Promise<HostEventReplay> {
  return invokeOn<HostEventReplay>(hostId, "host_events_since", { afterSequence });
}

export function invokeLocal<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return local.invoke<T>(command, args);
}

export function listenLocal<T>(
  event: string,
  handler: EventHandler<T>,
  options?: ListenOptions,
): Promise<UnlistenFn> {
  return local.listen(event, handler, options);
}
