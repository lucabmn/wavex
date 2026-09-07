import { getDefaultHostId, invokeOn, listenOn, type UnlistenFn } from "../transport";
import { hostPathArgs, type HostId } from "../host";

type DataPayload = { id: string; data: string };
type ExitPayload = { id: string; code: number | null };

type DataHandler = (data: Uint8Array) => void;
type ExitHandler = (code: number | null) => void;

/**
 * Replay budget for a PTY whose view is not mounted. Chunks arrive at up to
 * 32KB each, so a count-based cap let one unsubscribed terminal retain
 * megabytes; bound the bytes instead. Whole chunks are dropped oldest-first.
 */
const MAX_BUFFERED_BYTES = 256 * 1024;
const MAX_BUFFERED = 200;

/**
 * One host's terminals. PTY ids are minted by the host that spawned them, so
 * two hosts can hand out the same id: a single global handler map would route
 * one machine's terminal output into the other machine's terminal. The event
 * bridge is per host for the same reason — `pty-data` is a stream on one
 * connection, not a fact about this client.
 */
type HostPtys = {
  dataHandlers: Map<string, DataHandler>;
  exitHandlers: Map<string, ExitHandler>;
  dataBuffer: Map<string, Uint8Array[]>;
  dataBufferBytes: Map<string, number>;
  /** PTYs this window opened. Global `pty-data` still fires for every terminal
   * in the process; decoding those in a window that never mounted them was
   * megabytes of base64 work and a 256KB replay buffer per stranger id. */
  openedPtys: Set<string>;
  bridge: Promise<UnlistenFn[]> | null;
  users: number;
  teardownTimer: ReturnType<typeof setTimeout> | undefined;
};

const hosts = new Map<HostId, HostPtys>();

function hostPtys(hostId: HostId): HostPtys {
  let entry = hosts.get(hostId);
  if (!entry) {
    entry = {
      dataHandlers: new Map(),
      exitHandlers: new Map(),
      dataBuffer: new Map(),
      dataBufferBytes: new Map(),
      openedPtys: new Set(),
      bridge: null,
      users: 0,
      teardownTimer: undefined,
    };
    hosts.set(hostId, entry);
  }
  return entry;
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Leading chunks to drop to bring a replay buffer back within budget, and the
 * byte total that remains. Never drops the newest chunk, even when that chunk
 * alone exceeds the budget — replaying something beats replaying nothing.
 */
export function trimReplay(sizes: number[], bytes: number): { drop: number; bytes: number } {
  let drop = 0;
  let left = bytes;
  while (
    drop < sizes.length - 1 &&
    (left > MAX_BUFFERED_BYTES || sizes.length - drop > MAX_BUFFERED)
  ) {
    left -= sizes[drop];
    drop += 1;
  }
  return { drop, bytes: left };
}

function pushBuffered(state: HostPtys, id: string, chunk: Uint8Array) {
  const queued = state.dataBuffer.get(id) ?? [];
  queued.push(chunk);
  const trimmed = trimReplay(
    queued.map((entry) => entry.byteLength),
    (state.dataBufferBytes.get(id) ?? 0) + chunk.byteLength,
  );
  if (trimmed.drop > 0) queued.splice(0, trimmed.drop);
  state.dataBuffer.set(id, queued);
  state.dataBufferBytes.set(id, trimmed.bytes);
}

function clearBuffered(state: HostPtys, id: string) {
  state.dataBuffer.delete(id);
  state.dataBufferBytes.delete(id);
}

function ensureBridge(hostId: HostId) {
  const state = hostPtys(hostId);
  if (state.bridge) return;
  state.bridge = Promise.all([
    listenOn<DataPayload>(hostId, "pty-data", (event) => {
      const { id, data } = event.payload;
      const handler = state.dataHandlers.get(id);
      if (!handler && !state.openedPtys.has(id)) return;
      const chunk = decodeBase64(data);
      if (handler) handler(chunk);
      else pushBuffered(state, id, chunk);
    }),
    listenOn<ExitPayload>(hostId, "pty-exit", (event) => {
      const { id, code } = event.payload;
      state.exitHandlers.get(id)?.(code);
    }),
  ]);
}

function retain(hostId: HostId) {
  const state = hostPtys(hostId);
  state.users += 1;
  if (state.teardownTimer) {
    clearTimeout(state.teardownTimer);
    state.teardownTimer = undefined;
  }
  ensureBridge(hostId);
}

function release(hostId: HostId) {
  const state = hostPtys(hostId);
  state.users = Math.max(0, state.users - 1);
  if (state.users > 0 || !state.bridge) return;
  const pending = state.bridge;
  state.teardownTimer = setTimeout(() => {
    state.teardownTimer = undefined;
    if (state.users > 0) return;
    state.bridge = null;
    void pending.then((fns) => fns.forEach((fn) => fn()));
  }, 500);
}

export async function spawnPty(
  id: string,
  cwd: string,
  cols: number,
  rows: number,
  hostId?: HostId,
): Promise<void> {
  const target = hostPathArgs(cwd, hostId, getDefaultHostId());
  await invokeOn(target.hostId, "pty_spawn", { id, cwd: target.path, cols, rows });
}

export async function writePty(
  id: string,
  data: string,
  hostId: HostId = getDefaultHostId(),
): Promise<void> {
  await invokeOn(hostId, "pty_write", { id, data });
}

export async function resizePty(
  id: string,
  cols: number,
  rows: number,
  hostId: HostId = getDefaultHostId(),
): Promise<void> {
  await invokeOn(hostId, "pty_resize", { id, cols, rows });
}

export async function getPtyStatus(
  id: string,
  hostId: HostId = getDefaultHostId(),
): Promise<{ foreground: string | null }> {
  return invokeOn<{ foreground: string | null }>(hostId, "pty_status", { id });
}

export async function killPty(id: string, hostId: HostId = getDefaultHostId()): Promise<void> {
  const state = hostPtys(hostId);
  state.dataHandlers.delete(id);
  state.exitHandlers.delete(id);
  state.openedPtys.delete(id);
  clearBuffered(state, id);
  await invokeOn(hostId, "pty_kill", { id }).catch(() => undefined);
}

/**
 * Every terminal on one host. Scoped to a host on purpose: closing a client
 * must never reach across a connection and kill the terminals another machine
 * is still running.
 */
export async function killAllPtys(hostId: HostId = getDefaultHostId()): Promise<void> {
  const state = hostPtys(hostId);
  state.dataHandlers.clear();
  state.exitHandlers.clear();
  state.openedPtys.clear();
  state.dataBuffer.clear();
  state.dataBufferBytes.clear();
  await invokeOn(hostId, "pty_kill_all").catch(() => undefined);
}

export function subscribePty(
  id: string,
  onData: DataHandler,
  onExit: ExitHandler,
  hostId: HostId = getDefaultHostId(),
): () => void {
  const state = hostPtys(hostId);
  retain(hostId);
  state.openedPtys.add(id);
  state.dataHandlers.set(id, onData);
  state.exitHandlers.set(id, onExit);
  const queued = state.dataBuffer.get(id);
  if (queued) {
    clearBuffered(state, id);
    for (const chunk of queued) onData(chunk);
  }
  return () => {
    if (state.dataHandlers.get(id) === onData) state.dataHandlers.delete(id);
    if (state.exitHandlers.get(id) === onExit) state.exitHandlers.delete(id);
    release(hostId);
  };
}
