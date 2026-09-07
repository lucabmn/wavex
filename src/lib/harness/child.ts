import { getDefaultHostId, invokeOn, listenOn, type UnlistenFn } from "../transport";
import { hostPathArgs, type HostId } from "../host";

type LinePayload = { sessionId: string; line: string };
type ExitPayload = { sessionId: string; code: number | null; pid?: number };
type SsePayload = { sessionId: string; data: string };
type SseEndPayload = { sessionId: string; error?: string | null };

type LineHandler = (line: string) => void;
type ExitHandler = (code: number | null) => void;
type SseHandler = (data: string) => void;
type SseEndHandler = (error?: string) => void;

/** True when this exit belongs to the child we currently have spawned. */
export function isCurrentChildExit(
  expectedPid: number | undefined,
  exitedPid: number | undefined,
): boolean {
  if (expectedPid == null || expectedPid <= 0) return false;
  if (exitedPid == null || exitedPid <= 0) return false;
  return exitedPid === expectedPid;
}

const MAX_BUFFERED = 1000;

/**
 * The machine a harness call belongs to, and the working directory to name on
 * it.
 *
 * An adapter is handed a working directory that is either a project reference
 * or — when the session runs in a worktree — a bare child path that names no
 * host at all. So an explicitly passed host wins, then the host named by the
 * reference, then this device.
 *
 * `path` is the bare form. A provider CLI has never heard of the reference
 * scheme, so anything that reaches it — a spawn directory, a `thread/start`
 * or `session/new` parameter — has to be the path as that machine spells it.
 */
export function harnessTarget(cwd: string, hostId?: HostId): { hostId: HostId; path: string } {
  return hostPathArgs(cwd, hostId, getDefaultHostId());
}

export function harnessHostId(cwd: string, hostId?: HostId): HostId {
  return harnessTarget(cwd, hostId).hostId;
}

/**
 * One host's supervised children. A session id is minted by the host that
 * stores it, so two hosts can hand out the same one: a single global handler
 * map would deliver one machine's transcript into the other machine's session.
 * The event bridge is per host for the same reason — `harness-stdout` is a
 * stream on one connection, not a fact about this client.
 */
type HostChildren = {
  lineHandlers: Map<string, LineHandler>;
  exitHandlers: Map<string, ExitHandler>;
  lineBuffer: Map<string, string[]>;
  stderrHandlers: Map<string, LineHandler>;
  sseHandlers: Map<string, SseHandler>;
  sseEndHandlers: Map<string, SseEndHandler>;
  sseBuffer: Map<string, string[]>;
  livePid: Map<string, number>;
  pendingExit: Map<string, Array<{ code: number | null; pid: number }>>;
  bridge: Promise<UnlistenFn[]> | null;
  bridgeAttempt: symbol | null;
  users: number;
  teardownTimer: ReturnType<typeof setTimeout> | undefined;
};

const hosts = new Map<HostId, HostChildren>();

function hostChildren(hostId: HostId): HostChildren {
  let state = hosts.get(hostId);
  if (!state) {
    state = {
      lineHandlers: new Map(),
      exitHandlers: new Map(),
      lineBuffer: new Map(),
      stderrHandlers: new Map(),
      sseHandlers: new Map(),
      sseEndHandlers: new Map(),
      sseBuffer: new Map(),
      livePid: new Map(),
      pendingExit: new Map(),
      bridge: null,
      bridgeAttempt: null,
      users: 0,
      teardownTimer: undefined,
    };
    hosts.set(hostId, state);
  }
  return state;
}

function pushBounded(map: Map<string, string[]>, sessionId: string, item: string) {
  const queued = map.get(sessionId) ?? [];
  queued.push(item);
  if (queued.length > MAX_BUFFERED) {
    queued.splice(0, queued.length - MAX_BUFFERED);
  }
  map.set(sessionId, queued);
}

function ensureBridge(hostId: HostId) {
  const state = hostChildren(hostId);
  if (state.bridge) return;
  let failed = false;
  const installed: UnlistenFn[] = [];
  const register = (pending: Promise<UnlistenFn>) =>
    pending.then((unlisten) => {
      if (failed) {
        unlisten();
        return () => undefined;
      }
      installed.push(unlisten);
      return unlisten;
    });
  const attempt = Symbol("bridge-installation");
  state.bridgeAttempt = attempt;
  const installation = Promise.all([
    register(
      listenOn<LinePayload>(hostId, "harness-stdout", (event) => {
        const { sessionId, line } = event.payload;
        const handler = state.lineHandlers.get(sessionId);
        if (handler) {
          handler(line);
          return;
        }
        pushBounded(state.lineBuffer, sessionId, line);
      }),
    ),
    register(
      listenOn<LinePayload>(hostId, "harness-stderr", (event) => {
        const { sessionId, line } = event.payload;
        state.stderrHandlers.get(sessionId)?.(line);
      }),
    ),
    register(
      listenOn<ExitPayload>(hostId, "harness-exit", (event) => {
        const { sessionId, code, pid } = event.payload;
        const handler = state.exitHandlers.get(sessionId);
        if (!handler || pid == null || pid <= 0) return;
        const currentPid = state.livePid.get(sessionId);
        if (isCurrentChildExit(currentPid, pid)) {
          state.livePid.delete(sessionId);
          handler(code);
          return;
        }
        if (currentPid != null) return;
        const exits = state.pendingExit.get(sessionId) ?? [];
        exits.push({ code, pid });
        if (exits.length > 8) exits.splice(0, exits.length - 8);
        state.pendingExit.set(sessionId, exits);
      }),
    ),
    register(
      listenOn<SsePayload>(hostId, "harness-sse", (event) => {
        const { sessionId, data } = event.payload;
        const handler = state.sseHandlers.get(sessionId);
        if (handler) {
          handler(data);
          return;
        }
        pushBounded(state.sseBuffer, sessionId, data);
      }),
    ),
    register(
      listenOn<SseEndPayload>(hostId, "harness-sse-end", (event) => {
        const { sessionId, error } = event.payload;
        state.sseEndHandlers.get(sessionId)?.(error ?? undefined);
      }),
    ),
  ]).catch((error: unknown) => {
    failed = true;
    installed.splice(0).forEach((unlisten) => unlisten());
    if (state.bridgeAttempt === attempt) {
      state.bridge = null;
      state.bridgeAttempt = null;
    }
    throw error;
  });
  void installation.catch(() => undefined);
  state.bridge = installation;
}

/**
 * Drops the event subscriptions and nothing else.
 *
 * A connection going away is not a session going away: the children keep
 * running on the host, so the handlers that belong to them stay registered and
 * a later `ensureBridge` delivers to the same sessions. Forgetting them here is
 * what used to leave a reconnected client writing into a child whose output
 * arrived nowhere.
 */
function teardownBridge(hostId: HostId) {
  const state = hostChildren(hostId);
  const pending = state.bridge;
  state.bridge = null;
  state.bridgeAttempt = null;
  void pending?.then((fns) => fns.forEach((fn) => fn())).catch(() => undefined);
}

/** Every session this client tracked on one host, dropped along with the bridge. */
function forgetHostChildren(hostId: HostId) {
  const state = hostChildren(hostId);
  state.lineHandlers.clear();
  state.exitHandlers.clear();
  state.lineBuffer.clear();
  state.stderrHandlers.clear();
  state.sseHandlers.clear();
  state.sseEndHandlers.clear();
  state.sseBuffer.clear();
  state.livePid.clear();
  state.pendingExit.clear();
}

export function startHarnessBridge(hostId: HostId = getDefaultHostId()): () => void {
  const state = hostChildren(hostId);
  state.users += 1;
  if (state.teardownTimer) {
    clearTimeout(state.teardownTimer);
    state.teardownTimer = undefined;
  }
  ensureBridge(hostId);
  return () => {
    state.users -= 1;
    if (state.users > 0) return;
    state.users = 0;
    state.teardownTimer = setTimeout(() => {
      state.teardownTimer = undefined;
      if (state.users === 0) teardownBridge(hostId);
    }, 0);
  };
}

export async function acquireHarnessBridge(
  hostId: HostId = getDefaultHostId(),
): Promise<() => void> {
  const release = startHarnessBridge(hostId);
  const installation = hostChildren(hostId).bridge;
  try {
    await installation;
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const [hostId, state] of hosts) {
      state.users = 0;
      if (state.teardownTimer) {
        clearTimeout(state.teardownTimer);
        state.teardownTimer = undefined;
      }
      // The module is being replaced, so every handler closes over code that
      // no longer exists. This is the one teardown that forgets sessions too.
      teardownBridge(hostId);
      forgetHostChildren(hostId);
    }
  });
}

export function watchChild(
  sessionId: string,
  onLine: LineHandler,
  onExit: ExitHandler,
  onStderr?: LineHandler,
  hostId: HostId = getDefaultHostId(),
) {
  const state = hostChildren(hostId);
  const queued = state.lineBuffer.get(sessionId);
  state.lineBuffer.delete(sessionId);
  state.lineHandlers.set(sessionId, onLine);
  state.exitHandlers.set(sessionId, onExit);
  if (onStderr) state.stderrHandlers.set(sessionId, onStderr);
  if (queued) queued.forEach(onLine);
}

export function unwatchChild(sessionId: string, hostId: HostId = getDefaultHostId()) {
  const state = hostChildren(hostId);
  state.lineHandlers.delete(sessionId);
  state.exitHandlers.delete(sessionId);
  state.lineBuffer.delete(sessionId);
  state.stderrHandlers.delete(sessionId);
  state.pendingExit.delete(sessionId);
}

export function watchSse(
  sessionId: string,
  onData: SseHandler,
  onEnd?: SseEndHandler,
  hostId: HostId = getDefaultHostId(),
) {
  const state = hostChildren(hostId);
  const queued = state.sseBuffer.get(sessionId);
  state.sseBuffer.delete(sessionId);
  state.sseHandlers.set(sessionId, onData);
  if (onEnd) state.sseEndHandlers.set(sessionId, onEnd);
  if (queued) queued.forEach(onData);
}

export function unwatchSse(sessionId: string, hostId: HostId = getDefaultHostId()) {
  const state = hostChildren(hostId);
  state.sseHandlers.delete(sessionId);
  state.sseEndHandlers.delete(sessionId);
  state.sseBuffer.delete(sessionId);
}

export async function spawnChild(
  sessionId: string,
  command: string,
  args: string[],
  cwd: string,
  hostIdArg?: HostId,
): Promise<void> {
  const target = hostPathArgs(cwd, hostIdArg, getDefaultHostId());
  const hostId = target.hostId;
  const state = hostChildren(hostId);
  state.livePid.delete(sessionId);
  state.pendingExit.delete(sessionId);
  const pid = await invokeOn<number>(hostId, "harness_spawn", {
    sessionId,
    command,
    args,
    cwd: target.path,
  });
  if (typeof pid !== "number" || pid <= 0) return;
  state.livePid.set(sessionId, pid);
  const exits = state.pendingExit.get(sessionId);
  state.pendingExit.delete(sessionId);
  const exited = exits?.find((event) => event.pid === pid);
  if (!exited) return;
  state.livePid.delete(sessionId);
  state.exitHandlers.get(sessionId)?.(exited.code);
}

export function writeChild(
  sessionId: string,
  line: string,
  hostId: HostId = getDefaultHostId(),
): Promise<void> {
  return invokeOn(hostId, "harness_write", { sessionId, line });
}

export function killChild(sessionId: string, hostId: HostId = getDefaultHostId()): Promise<void> {
  const state = hostChildren(hostId);
  state.livePid.delete(sessionId);
  state.pendingExit.delete(sessionId);
  unwatchChild(sessionId, hostId);
  return invokeOn(hostId, "harness_kill", { sessionId });
}

/**
 * Every child on one host. Scoped to a host on purpose: a client shutting down
 * must never reach across a connection and stop the agents another machine is
 * still running — that is the whole point of leaving a run behind.
 */
export function killAllChildren(hostId: HostId = getDefaultHostId()): Promise<void> {
  forgetHostChildren(hostId);
  return invokeOn(hostId, "harness_kill_all");
}

export function resolveCursorBinary(
  hostId: HostId = getDefaultHostId(),
): Promise<{ path: string }> {
  return invokeOn(hostId, "harness_resolve_cursor");
}

export function resolveCodexBinary(hostId: HostId = getDefaultHostId()): Promise<{ path: string }> {
  return invokeOn(hostId, "harness_resolve_codex");
}

export function resolveOpenCodeBinary(
  hostId: HostId = getDefaultHostId(),
): Promise<{ path: string }> {
  return invokeOn(hostId, "harness_resolve_opencode");
}

export function resolveClaudeBinary(
  hostId: HostId = getDefaultHostId(),
): Promise<{ path: string }> {
  return invokeOn(hostId, "harness_resolve_claude");
}

export function resolvePiBinary(hostId: HostId = getDefaultHostId()): Promise<{ path: string }> {
  return invokeOn(hostId, "harness_resolve_pi");
}

export function resolveOmpBinary(hostId: HostId = getDefaultHostId()): Promise<{ path: string }> {
  return invokeOn(hostId, "harness_resolve_omp");
}

export function resolveFxBinary(hostId: HostId = getDefaultHostId()): Promise<{ path: string }> {
  return invokeOn(hostId, "harness_resolve_fx");
}

export function resolveGrokBinary(hostId: HostId = getDefaultHostId()): Promise<{ path: string }> {
  return invokeOn(hostId, "harness_resolve_grok");
}

export function freeHarnessPort(hostId: HostId = getDefaultHostId()): Promise<number> {
  return invokeOn(hostId, "harness_free_port");
}

export function harnessHttp(
  input: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  },
  hostId: HostId = getDefaultHostId(),
): Promise<{ status: number; body: string }> {
  return invokeOn(hostId, "harness_http", input);
}

export function openHarnessSse(
  sessionId: string,
  url: string,
  headers?: Record<string, string>,
  hostId: HostId = getDefaultHostId(),
): Promise<void> {
  return invokeOn(hostId, "harness_sse_open", { sessionId, url, headers });
}

export function closeHarnessSse(
  sessionId: string,
  hostId: HostId = getDefaultHostId(),
): Promise<void> {
  unwatchSse(sessionId, hostId);
  return invokeOn(hostId, "harness_sse_close", { sessionId });
}

export function execChild(
  command: string,
  args: string[],
  cwd?: string,
  hostId: HostId = getDefaultHostId(),
): Promise<string> {
  return invokeOn(hostId, "harness_exec", { command, args, cwd });
}
