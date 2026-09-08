import { projectKey, type HostId } from "../host";
import { gitWritingModelNativeId, modelsFor } from "../models";
import {
  harnessHostId,
  killChild,
  resolveClaudeBinary,
  spawnChild,
  unwatchChild,
  watchChild,
  writeChild,
} from "./child";
import {
  assistantTextBlocks,
  buildClaudeSpawnArgs,
  buildClaudeUserMessage,
  parseJsonLine,
  stringField,
  turnStatusFromResult,
} from "./claudeProtocol";
import { mergeStream } from "./streamText";

const TEXT_CHILD_ID = "wavex-claude-text";
const INIT_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 45_000;
const TEXT_MODEL = "claude-haiku-4-5";

type LiveText = {
  cwd: string;
  collecting: boolean;
  output: string;
  closed: boolean;
  ready: boolean;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  readyDone: (() => void) | null;
};

type TextState = {
  live: LiveText | null;
  turns: Promise<void>;
};

/**
 * One warm generator per host. A single module-level slot is one process: with
 * two hosts, the second request tore down the first machine's child and then
 * addressed its fixed child id over the wrong connection.
 */
const stateByHost = new Map<HostId, TextState>();

function stateFor(hostId: HostId): TextState {
  let state = stateByHost.get(hostId);
  if (!state) {
    state = { live: null, turns: Promise.resolve() };
    stateByHost.set(hostId, state);
  }
  return state;
}

function pickTextModel(): string {
  // The git-writings setting names the exact model; the cheap Haiku stays
  // the fallback for a choice that belongs to another provider.
  const configured = gitWritingModelNativeId("claude");
  if (configured) return configured;
  const models = modelsFor("claude");
  const haiku = models.find((model) =>
    /haiku/i.test(`${model.nativeId ?? ""} ${model.name} ${model.id}`),
  );
  return haiku?.nativeId ?? TEXT_MODEL;
}

export async function stopClaudeTextPrompt(hostId?: HostId): Promise<void> {
  await dropLive(harnessHostId("", hostId));
}

export function warmupClaudeText(cwd: string, hostIdArg?: HostId): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  const hostId = harnessHostId(cwd, hostIdArg);
  const state = stateFor(hostId);
  const run = state.turns
    .catch(() => undefined)
    .then(async () => {
      await ensureLive(cwd, hostId);
    });
  state.turns = run.then(
    () => undefined,
    () => undefined,
  );
  return run.catch(() => undefined);
}

export async function runClaudeTextPrompt(input: {
  cwd: string;
  prompt: string;
  timeoutMs?: number;
  hostId?: HostId;
}): Promise<string> {
  const hostId = harnessHostId(input.cwd, input.hostId);
  const state = stateFor(hostId);
  const run = state.turns.catch(() => undefined).then(() => promptOnLive(input, hostId));
  state.turns = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function promptOnLive(
  input: {
    cwd: string;
    prompt: string;
    timeoutMs?: number;
  },
  hostId: HostId,
): Promise<string> {
  const session = await ensureLive(input.cwd, hostId);
  session.output = "";
  session.collecting = true;
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;

  try {
    const turnPromise = new Promise<void>((resolve, reject) => {
      session.turnDone = resolve;
      session.turnFailed = reject;
    });

    await writeChild(
      TEXT_CHILD_ID,
      JSON.stringify(buildClaudeUserMessage({ text: input.prompt })),
      hostId,
    );

    await Promise.race([
      turnPromise,
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("Claude text generation timed out")), timeoutMs);
      }),
    ]);

    const output = session.output.trim();
    if (!output) throw new Error("Claude returned empty output.");
    return output;
  } catch (error) {
    if (session.closed) await dropLive(hostId);
    throw error;
  } finally {
    session.collecting = false;
    session.turnDone = null;
    session.turnFailed = null;
    await dropLive(hostId);
  }
}

async function ensureLive(cwd: string, hostId: HostId): Promise<LiveText> {
  const state = stateFor(hostId);
  const current = state.live;
  if (current && !current.closed && projectKey(current.cwd) === projectKey(cwd)) return current;
  await dropLive(hostId);
  return startLive(cwd, hostId);
}

async function startLive(cwd: string, hostId: HostId): Promise<LiveText> {
  const state = stateFor(hostId);
  const { path } = await resolveClaudeBinary(hostId);
  const session: LiveText = {
    cwd,
    collecting: false,
    output: "",
    closed: false,
    ready: false,
    turnDone: null,
    turnFailed: null,
    readyDone: null,
  };

  watchChild(
    TEXT_CHILD_ID,
    (line) => handleLine(session, line),
    () => {
      session.closed = true;
      if (state.live === session) state.live = null;
      session.turnFailed?.(new Error("Claude text generator exited"));
      session.readyDone?.();
      session.turnDone = null;
      session.turnFailed = null;
      session.readyDone = null;
    },
    undefined,
    hostId,
  );

  try {
    await spawnChild(
      TEXT_CHILD_ID,
      path,
      buildClaudeSpawnArgs({
        isolated: true,
        model: pickTextModel(),
      }),
      cwd,
      hostId,
    );
    state.live = session;
    await waitForReady(session, INIT_TIMEOUT_MS);
    return session;
  } catch (error) {
    session.closed = true;
    unwatchChild(TEXT_CHILD_ID, hostId);
    await killChild(TEXT_CHILD_ID, hostId).catch(() => undefined);
    throw error;
  }
}

async function dropLive(hostId: HostId): Promise<void> {
  const state = stateFor(hostId);
  const current = state.live;
  state.live = null;
  if (current) {
    current.closed = true;
    current.readyDone?.();
    current.turnFailed?.(new Error("Claude text generator stopped"));
    current.turnDone = null;
    current.turnFailed = null;
    current.readyDone = null;
  }
  unwatchChild(TEXT_CHILD_ID, hostId);
  await killChild(TEXT_CHILD_ID, hostId).catch(() => undefined);
}

function handleLine(session: LiveText, line: string): void {
  const rec = parseJsonLine(line);
  if (!rec) return;
  const type = stringField(rec, "type");
  if (
    type === "system" &&
    (stringField(rec, "subtype") === "init" || stringField(rec, "subtype") === "initialized")
  ) {
    session.ready = true;
    session.readyDone?.();
    session.readyDone = null;
  }
  if (!session.collecting) return;
  if (type === "assistant") {
    const snapshot = assistantTextBlocks(rec).join("");
    if (snapshot) session.output = mergeStream(session.output, snapshot);
    return;
  }
  if (type === "stream_event") {
    const event = rec.event;
    if (!event || typeof event !== "object") return;
    const delta = (event as { delta?: { type?: string; text?: string } }).delta;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      session.output = mergeStream(session.output, delta.text);
    }
    return;
  }
  if (type === "result") {
    const result = turnStatusFromResult(rec);
    if (result.status === "failed") {
      session.turnFailed?.(new Error(result.error ?? "Claude turn failed"));
    } else {
      session.turnDone?.();
    }
    session.turnDone = null;
    session.turnFailed = null;
  }
}

function waitForReady(session: LiveText, timeoutMs: number): Promise<void> {
  if (session.ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.readyDone = null;
      resolve();
    }, timeoutMs);
    session.readyDone = () => {
      clearTimeout(timer);
      if (session.closed) {
        reject(new Error("Claude text generator exited"));
        return;
      }
      resolve();
    };
  });
}
