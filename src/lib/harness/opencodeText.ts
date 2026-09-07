import { projectKey, type HostId } from "../host";
import { modelsFor } from "../models";
import {
  execChild,
  freeHarnessPort,
  harnessHostId,
  harnessTarget,
  killChild,
  resolveOpenCodeBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "./child";
import { OpenCodeClient } from "./opencodeClient";
import {
  compareSemver,
  MINIMUM_OPENCODE_VERSION,
  parseOpenCodeModelSlug,
  parseOpenCodeVersion,
  parseServerUrlFromOutput,
} from "./opencodeProtocol";

const TEXT_CHILD_ID = "wavex-opencode-text";
const SERVER_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 45_000;

type LiveText = {
  client: OpenCodeClient;
  sessionId: string;
  cwd: string;
  model: { providerID: string; modelID: string };
};

type TextState = {
  live: LiveText | null;
  turns: Promise<void>;
  serverUrl: string;
};

/**
 * One warm server per host. A single module-level slot is one process, and
 * `serverUrl` is a loopback address that only means anything on the machine
 * that printed it: with two hosts, sharing either one crosses the wires.
 */
const stateByHost = new Map<HostId, TextState>();

function stateFor(hostId: HostId): TextState {
  let state = stateByHost.get(hostId);
  if (!state) {
    state = { live: null, turns: Promise.resolve(), serverUrl: "" };
    stateByHost.set(hostId, state);
  }
  return state;
}

export async function stopOpenCodeTextPrompt(hostId?: HostId): Promise<void> {
  await dropLive(harnessHostId("", hostId));
}

export function warmupOpenCodeText(cwd: string, hostIdArg?: HostId): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  const target = harnessTarget(cwd, hostIdArg);
  const state = stateFor(target.hostId);
  const run = state.turns
    .catch(() => undefined)
    .then(async () => {
      await ensureLive(target.path, target.hostId);
    });
  state.turns = run.then(
    () => undefined,
    () => undefined,
  );
  return run.catch(() => undefined);
}

export async function runOpenCodeTextPrompt(input: {
  cwd: string;
  prompt: string;
  timeoutMs?: number;
  hostId?: HostId;
}): Promise<string> {
  const target = harnessTarget(input.cwd, input.hostId);
  const state = stateFor(target.hostId);
  const run = state.turns
    .catch(() => undefined)
    .then(() => promptOnLive({ ...input, cwd: target.path }, target.hostId));
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
  try {
    const result = await session.client.prompt({
      sessionID: session.sessionId,
      model: session.model,
      parts: [{ type: "text", text: input.prompt }],
      timeoutMs: input.timeoutMs ?? REQUEST_TIMEOUT_MS,
    });
    const error = result.info?.error;
    if (error) {
      throw new Error(
        typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : "OpenCode text generation failed",
      );
    }
    const text = getOpenCodeTextResponse(result.parts);
    if (!text) throw new Error("OpenCode returned empty output.");
    return text;
  } finally {
    await dropLive(hostId);
  }
}

async function ensureLive(cwd: string, hostId: HostId): Promise<LiveText> {
  const model = pickTextModel();
  const state = stateFor(hostId);
  const current = state.live;
  if (current && projectKey(current.cwd) === projectKey(cwd) && sameModel(current.model, model)) {
    return current;
  }
  if (current) await dropLive(hostId);
  return startLive(cwd, model, hostId);
}

async function startLive(
  cwd: string,
  model: { providerID: string; modelID: string },
  hostId: HostId,
): Promise<LiveText> {
  const state = stateFor(hostId);
  const { path } = await resolveOpenCodeBinary(hostId);
  const versionOut = await execChild(path, ["--version"], cwd, hostId).catch(() => "");
  const version = parseOpenCodeVersion(versionOut);
  if (!version || compareSemver(version, MINIMUM_OPENCODE_VERSION) < 0) {
    throw new Error(`OpenCode v${version ?? "unknown"} is too old for text generation.`);
  }

  state.serverUrl = "";
  watchChild(
    TEXT_CHILD_ID,
    (line) => {
      const parsed = parseServerUrlFromOutput(line);
      if (parsed) state.serverUrl = parsed;
    },
    () => {
      state.live = null;
    },
    (line) => {
      const parsed = parseServerUrlFromOutput(line);
      if (parsed) state.serverUrl = parsed;
    },
    hostId,
  );

  const port = await freeHarnessPort(hostId);
  await spawnChild(
    TEXT_CHILD_ID,
    path,
    ["serve", `--hostname=127.0.0.1`, `--port=${port}`],
    cwd,
    hostId,
  );

  try {
    const url = await waitForUrl(() => state.serverUrl, SERVER_TIMEOUT_MS);
    const client = new OpenCodeClient(url, cwd, hostId);
    const created = await client.createSession({
      permission: [{ permission: "*", pattern: "*", action: "deny" }],
    });
    const session: LiveText = { client, sessionId: created.id, cwd, model };
    state.live = session;
    return session;
  } catch (error) {
    await dropLive(hostId);
    throw error;
  }
}

async function dropLive(hostId: HostId): Promise<void> {
  const state = stateFor(hostId);
  const current = state.live;
  state.live = null;
  if (current) {
    await current.client.abortSession(current.sessionId);
    await current.client.closeEvents(TEXT_CHILD_ID);
  }
  unwatchChild(TEXT_CHILD_ID, hostId);
  await killChild(TEXT_CHILD_ID, hostId).catch(() => undefined);
}

function pickTextModel(): { providerID: string; modelID: string } {
  const models = modelsFor("opencode");
  for (const model of models) {
    const parsed = parseOpenCodeModelSlug(model.nativeId ?? model.id);
    if (parsed) return parsed;
  }
  return { providerID: "opencode", modelID: "glm-5" };
}

function sameModel(
  left: { providerID: string; modelID: string },
  right: { providerID: string; modelID: string },
): boolean {
  return left.providerID === right.providerID && left.modelID === right.modelID;
}

export function getOpenCodeTextResponse(parts: unknown[] | undefined): string {
  return (parts ?? [])
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      if (!("type" in part) || part.type !== "text") return [];
      if (!("text" in part) || typeof part.text !== "string") return [];
      return [part.text];
    })
    .join("")
    .trim();
}

function waitForUrl(read: () => string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const url = read();
      if (url) {
        resolve(url);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error("Timed out waiting for OpenCode text server"));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}
