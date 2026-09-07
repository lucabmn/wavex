import { projectKey, type HostId } from "../host";
import { modelsFor } from "../models";
import { harnessHostId, killChild, spawnChild, unwatchChild, watchChild } from "./child";
import { PiRpc } from "./piClient";
import { OMP_FLAVOR, PI_FLAVOR, type PiFlavor } from "./piFlavor";
import {
  agentEndWillRetry,
  asRecord,
  assistantDeltaFromEvent,
  buildPiPrompt,
  buildPiSpawnArgs,
  isAgentSettled,
} from "./piProtocol";
import { mergeStream } from "./streamText";

const INIT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 45_000;

type LiveText = {
  rpc: PiRpc;
  cwd: string;
  collecting: boolean;
  output: string;
  closed: boolean;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  turnEndPending: boolean;
};

type TextState = {
  live: LiveText | null;
  turns: Promise<void>;
};

/**
 * One warm text child per flavor *per host*. The single slot this used to hold
 * is one process: with two hosts, asking the second for a commit message tore
 * down the first machine's generator and reported its child id to the wrong
 * connection.
 */
const stateByFlavor = new Map<string, TextState>();

function stateKey(flavor: PiFlavor, hostId: HostId): string {
  return `${flavor.id}\u0000${hostId}`;
}

function stateFor(flavor: PiFlavor, hostId: HostId): TextState {
  const key = stateKey(flavor, hostId);
  let state = stateByFlavor.get(key);
  if (!state) {
    state = { live: null, turns: Promise.resolve() };
    stateByFlavor.set(key, state);
  }
  return state;
}

function pickTextModel(flavor: PiFlavor): string | undefined {
  const models = modelsFor(flavor.id).filter((model) => Boolean(model.nativeId?.includes("/")));
  const cheap = models.find((model) =>
    /haiku|mini|flash|nano|lite|luna/i.test(`${model.nativeId ?? ""} ${model.name} ${model.id}`),
  );
  return (cheap ?? models[0])?.nativeId?.trim() || undefined;
}

export async function stopTextPrompt(flavor: PiFlavor, hostId?: HostId): Promise<void> {
  await dropLive(flavor, harnessHostId("", hostId));
}

export function warmupText(flavor: PiFlavor, cwd: string, hostIdArg?: HostId): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  const hostId = harnessHostId(cwd, hostIdArg);
  const state = stateFor(flavor, hostId);
  const run = state.turns
    .catch(() => undefined)
    .then(async () => {
      await ensureLive(flavor, cwd, hostId);
    });
  state.turns = run.then(
    () => undefined,
    () => undefined,
  );
  return run.catch(() => undefined);
}

export async function runTextPrompt(
  flavor: PiFlavor,
  input: {
    cwd: string;
    prompt: string;
    timeoutMs?: number;
    hostId?: HostId;
  },
): Promise<string> {
  const hostId = harnessHostId(input.cwd, input.hostId);
  const state = stateFor(flavor, hostId);
  const run = state.turns.catch(() => undefined).then(() => promptOnLive(flavor, input, hostId));
  state.turns = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function promptOnLive(
  flavor: PiFlavor,
  input: {
    cwd: string;
    prompt: string;
    timeoutMs?: number;
    hostId?: HostId;
  },
  hostId: HostId,
): Promise<string> {
  const session = await ensureLive(flavor, input.cwd, hostId);
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;

  try {
    await session.rpc.request({ type: "new_session" }).catch(() => undefined);
    await session.rpc.request({ type: "set_thinking_level", level: "off" }).catch(() => undefined);

    session.output = "";
    session.collecting = true;
    session.turnEndPending = false;

    const turnPromise = new Promise<void>((resolve, reject) => {
      session.turnDone = resolve;
      session.turnFailed = reject;
    });

    await session.rpc.request(buildPiPrompt({ text: input.prompt }), timeoutMs);
    if (session.turnEndPending) finishTurn(session);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        turnPromise,
        new Promise<void>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${flavor.label} text generation timed out`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    let output = session.output.trim();
    if (!output) {
      const rec = await session.rpc.request({ type: "get_last_assistant_text" }).catch(() => null);
      const text = asRecord(rec?.data)?.text;
      if (typeof text === "string") output = text.trim();
    }
    if (!output) throw new Error(`${flavor.label} returned empty output.`);
    await dropLive(flavor, hostId);
    return output;
  } catch (error) {
    session.turnDone = null;
    session.turnFailed = null;
    await session.rpc.request({ type: "abort" }).catch(() => undefined);
    await dropLive(flavor, hostId);
    throw error;
  } finally {
    session.collecting = false;
    session.turnDone = null;
    session.turnFailed = null;
  }
}

async function ensureLive(flavor: PiFlavor, cwd: string, hostId: HostId): Promise<LiveText> {
  const state = stateFor(flavor, hostId);
  const current = state.live;
  if (current && !current.closed && projectKey(current.cwd) === projectKey(cwd)) return current;
  await dropLive(flavor, hostId);
  return startLive(flavor, cwd, hostId);
}

async function startLive(flavor: PiFlavor, cwd: string, hostId: HostId): Promise<LiveText> {
  const state = stateFor(flavor, hostId);
  const childId = flavor.textChildId;
  const { path } = await flavor.resolveBinary(hostId);
  const liveRef: { current: LiveText | null } = { current: null };
  const rpc = new PiRpc(
    childId,
    (rec) => {
      const current = liveRef.current;
      if (current) handleFrame(current, rec);
    },
    flavor.label,
    hostId,
  );
  const session: LiveText = {
    rpc,
    cwd,
    collecting: false,
    output: "",
    closed: false,
    turnDone: null,
    turnFailed: null,
    turnEndPending: false,
  };
  liveRef.current = session;

  watchChild(
    childId,
    (line) => rpc.pushLine(line),
    () => {
      session.closed = true;
      if (state.live === session) state.live = null;
      const exited = new Error(`${flavor.label} text generator exited`);
      rpc.close(exited);
      session.turnFailed?.(exited);
      session.turnDone = null;
      session.turnFailed = null;
    },
    undefined,
    hostId,
  );

  try {
    await spawnChild(
      childId,
      path,
      buildPiSpawnArgs(flavor, {
        isolated: true,
        model: pickTextModel(flavor),
      }),
      cwd,
      hostId,
    );
    await rpc.request({ type: "get_state" }, INIT_TIMEOUT_MS);
    state.live = session;
    return session;
  } catch (error) {
    session.closed = true;
    rpc.close(error instanceof Error ? error : new Error(String(error)));
    unwatchChild(childId, hostId);
    await killChild(childId, hostId).catch(() => undefined);
    throw error;
  }
}

async function dropLive(flavor: PiFlavor, hostId: HostId): Promise<void> {
  const state = stateFor(flavor, hostId);
  const current = state.live;
  const childId = flavor.textChildId;
  state.live = null;
  if (current) {
    current.closed = true;
    current.rpc.close();
    current.turnFailed?.(new Error(`${flavor.label} text generator stopped`));
    current.turnDone = null;
    current.turnFailed = null;
  }
  unwatchChild(childId, hostId);
  await killChild(childId, hostId).catch(() => undefined);
}

function handleFrame(session: LiveText, rec: Record<string, unknown>) {
  if (!session.collecting) return;
  const delta = assistantDeltaFromEvent(rec);
  if (delta?.kind === "text") {
    session.output = mergeStream(session.output, delta.text);
  }
  if (isAgentSettled(rec) || agentEndWillRetry(rec) === false) {
    if (session.turnDone) finishTurn(session);
    else session.turnEndPending = true;
  }
}

function finishTurn(session: LiveText) {
  session.turnEndPending = false;
  const done = session.turnDone;
  session.turnDone = null;
  session.turnFailed = null;
  done?.();
}

export type PiTextPromptInput = {
  cwd: string;
  prompt: string;
  timeoutMs?: number;
  hostId?: HostId;
};

export const stopPiTextPrompt = (hostId?: HostId) => stopTextPrompt(PI_FLAVOR, hostId);
export const warmupPiText = (cwd: string, hostId?: HostId) => warmupText(PI_FLAVOR, cwd, hostId);
export const runPiTextPrompt = (input: PiTextPromptInput) => runTextPrompt(PI_FLAVOR, input);

export const stopOmpTextPrompt = (hostId?: HostId) => stopTextPrompt(OMP_FLAVOR, hostId);
export const warmupOmpText = (cwd: string, hostId?: HostId) => warmupText(OMP_FLAVOR, cwd, hostId);
export const runOmpTextPrompt = (input: PiTextPromptInput) => runTextPrompt(OMP_FLAVOR, input);
