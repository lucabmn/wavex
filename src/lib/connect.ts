/**
 * wavex Link on the client side: the hosts this profile has paired with, and
 * the state of the connection to each one.
 *
 * A host token grants filesystem access, process execution, and Git write
 * access on the machine that serves it, so it is never written to browser
 * storage. It lives in the profile's data directory and is read back only at
 * the moment a connection is opened.
 */
import { startHarnessBridge } from "./harness/child";
import {
  completeRemoteResync,
  connectionSnapshot,
  connectRemoteHost,
  disconnectRemoteHost,
  emit,
  invokeLocal,
  invokeOn,
  listenOn,
  LOCAL_HOST_ID,
  RESYNC_REQUIRED_EVENT,
  subscribeConnection,
  type ConnectionSnapshot,
  type HostId,
  type RemoteConnection,
} from "./transport";

/** A host's backlog no longer reached this client; its state was reloaded. */
export const HOST_RESYNCED_EVENT = "wavex://host-resynced";

export type HostStatus = {
  hostId: string;
  name: string;
  platform: "macos" | "windows" | "linux" | "unknown";
  running: boolean;
  port: number | null;
  clients: number;
};

/** What the UI is allowed to see: everything except the token. */
export type SavedHost = {
  hostId: string;
  name: string;
  endpoint: string;
};

type SavedConnection = SavedHost & { token: string };

export function hostStatus(): Promise<HostStatus> {
  return invokeLocal<HostStatus>("connect_host_status");
}

export function startHost(port?: number): Promise<HostStatus> {
  return invokeLocal<HostStatus>("connect_host_start", { port: port ?? null });
}

export function stopHost(): Promise<HostStatus> {
  return invokeLocal<HostStatus>("connect_host_stop");
}

export function renameHost(name: string): Promise<HostStatus> {
  return invokeLocal<HostStatus>("connect_host_set_name", { name });
}

/** Carries the host token. Show it deliberately; never log or persist it. */
export function hostPairingCode(): Promise<string> {
  return invokeLocal<string>("connect_host_pairing_code");
}

export function rotateHostToken(): Promise<HostStatus> {
  return invokeLocal<HostStatus>("connect_host_rotate_token");
}

export function listSavedHosts(): Promise<SavedHost[]> {
  return invokeLocal<SavedHost[]>("connect_client_list");
}

export function addSavedHost(code: string): Promise<SavedHost> {
  return invokeLocal<SavedHost>("connect_client_add", { code });
}

export function removeSavedHost(hostId: string): Promise<void> {
  return invokeLocal<void>("connect_client_remove", { hostId });
}

/**
 * Opens the connection for a paired host. The token is fetched here rather
 * than held by a component, so it exists in the WebView only for the length of
 * this call.
 */
export async function connectSavedHost(hostId: HostId): Promise<void> {
  if (hostId === LOCAL_HOST_ID) return;
  const connection = await invokeLocal<SavedConnection>("connect_client_connection", { hostId });
  await openHostConnection(hostId, {
    endpoint: connection.endpoint,
    auth: { kind: "bearer", token: connection.token },
    name: connection.name,
  });
}

/**
 * Opens a connection and attaches everything that has to be listening when the
 * replay arrives.
 *
 * The transport registers itself before its socket opens, and everything this
 * client missed is replayed the moment it does. So the bridge and the resync
 * watcher attach first: subscribing afterwards would deliver that replay into
 * a transport nobody is listening to yet, which reads on screen as a session
 * that went quiet while the host was busy.
 */
export async function openHostConnection(
  hostId: HostId,
  connection: RemoteConnection,
): Promise<void> {
  const opening = connectRemoteHost(hostId, connection);
  holdHarnessBridge(hostId);
  const watching = watchForResync(hostId);
  try {
    await opening;
    await watching;
  } catch (error) {
    disconnectSavedHost(hostId);
    throw error;
  }
}

export function disconnectSavedHost(hostId: HostId): void {
  resyncWatchers.get(hostId)?.();
  resyncWatchers.delete(hostId);
  bridgeLeases.get(hostId)?.();
  bridgeLeases.delete(hostId);
  disconnectRemoteHost(hostId);
}

const resyncWatchers = new Map<HostId, () => void>();
const bridgeLeases = new Map<HostId, () => void>();

/**
 * A harness child streams stdout through `harness-stdout` on the connection it
 * runs on, and nothing delivers those events until someone subscribes. The app
 * shell leases a bridge for this device only, so without a lease here a remote
 * agent would start and then appear to say nothing at all. The connection owns
 * the lease because it outlives any one window's mount.
 */
function holdHarnessBridge(hostId: HostId): void {
  bridgeLeases.get(hostId)?.();
  bridgeLeases.set(hostId, startHarnessBridge(hostId));
}

/**
 * Without a subscriber the replay barrier never lifts: events stop arriving
 * while commands keep working, which reads on screen as a live app showing a
 * transcript that stopped growing. Reloading first and lifting the barrier
 * after is what makes the reattach non-destructive.
 */
async function watchForResync(hostId: HostId): Promise<void> {
  resyncWatchers.get(hostId)?.();
  const unlisten = await listenOn(hostId, RESYNC_REQUIRED_EVENT, () => {
    void reloadAfterResync(hostId);
  });
  resyncWatchers.set(hostId, unlisten);
}

type ResyncHandler = (hostId: HostId) => Promise<void> | void;

const resyncHandlers = new Set<ResyncHandler>();

/**
 * Re-read what this window holds for a host whose backlog expired.
 *
 * The barrier is not lifted until every handler has finished, which is the
 * whole reason this is a registry and not just the broadcast below: an event
 * that is merely announced would be answered after the stream had already
 * resumed, and the reload would then race the events it was meant to replace.
 */
export function onHostResynced(handler: ResyncHandler): () => void {
  resyncHandlers.add(handler);
  return () => {
    resyncHandlers.delete(handler);
  };
}

async function reloadAfterResync(hostId: HostId): Promise<void> {
  try {
    // Round-trips the host so the reload only starts once it is answering.
    await invokeOn(hostId, "session_list_in_flight");
    await Promise.all(
      [...resyncHandlers].map(async (handler) => {
        try {
          await handler(hostId);
        } catch {
          // A store that cannot reload is still better off with the barrier
          // lifted: events resume, and it is stale rather than frozen.
        }
      }),
    );
    // Other windows of this client hold their own copies and their own
    // connections. They are told, but they are not waited on: each one lifts
    // its own barrier when its own reload is done.
    await emit(HOST_RESYNCED_EVENT, { hostId });
  } finally {
    completeRemoteResync(hostId);
  }
}

type Snapshot = {
  status: HostStatus | null;
  hosts: SavedHost[];
  connections: Record<string, ConnectionSnapshot>;
};

let snapshot: Snapshot = { status: null, hosts: [], connections: {} };
const listeners = new Set<() => void>();
let transportUnsubscribe: (() => void) | null = null;

function publish(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function withConnections(base: Omit<Snapshot, "connections">): Snapshot {
  const connections: Record<string, ConnectionSnapshot> = {};
  for (const host of base.hosts) connections[host.hostId] = connectionSnapshot(host.hostId);
  return { ...base, connections };
}

export function getConnectSnapshot(): Snapshot {
  return snapshot;
}

export function subscribeConnect(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    transportUnsubscribe = subscribeConnection(() => {
      publish(withConnections({ status: snapshot.status, hosts: snapshot.hosts }));
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      transportUnsubscribe?.();
      transportUnsubscribe = null;
    }
  };
}

export async function refreshConnect(): Promise<void> {
  const [status, hosts] = await Promise.all([
    hostStatus().catch(() => null),
    listSavedHosts().catch(() => []),
  ]);
  publish(withConnections({ status, hosts }));
}

/** Reads as a sentence in the chrome, not as a state machine label. */
export function connectionLabel(state: ConnectionSnapshot | undefined): string {
  switch (state?.phase) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return "Reconnecting…";
    case "resynchronizing":
      return "Catching up…";
    case "offline":
      return state.error ?? "Not connected";
    default:
      return "Not connected";
  }
}
