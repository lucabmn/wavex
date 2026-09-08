import { projectKey, type HostId } from "../host";
import { gitWritingModelNativeId } from "../models";
import { AcpClient } from "./acp";
import {
  harnessHostId,
  harnessTarget,
  killChild,
  resolveCursorBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "./child";
import { mergeStream } from "./streamText";

const TEXT_CHILD_ID = "wavex-text";
const INIT_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
const TEXT_MODEL = "composer-2.5";

const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
  _meta: { parameterizedModelPicker: true },
};

type LiveText = {
  acp: AcpClient;
  cwd: string;
  acpSessionId: string;
  collecting: boolean;
  output: string;
  closed: boolean;
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

export async function stopCursorTextPrompt(childId?: string, hostIdArg?: HostId): Promise<void> {
  const hostId = harnessHostId("", hostIdArg);
  await dropLive(hostId);
  if (childId && childId !== TEXT_CHILD_ID) {
    unwatchChild(childId, hostId);
    await killChild(childId, hostId).catch(() => undefined);
  }
}

/** Start the shared text ACP process in the background so the first prompt is fast. */
export function warmupCursorText(cwd: string, hostIdArg?: HostId): Promise<void> {
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

/** Cursor ACP turn in ask mode. Reuses a warm `cursor-agent acp` process. */
export async function runCursorTextPrompt(input: {
  cwd: string;
  prompt: string;
  timeoutMs: number;
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
    timeoutMs: number;
  },
  hostId: HostId,
): Promise<string> {
  const session = await ensureLive(input.cwd, hostId);
  session.output = "";
  session.collecting = true;
  try {
    await session.acp.request(
      "session/prompt",
      {
        sessionId: session.acpSessionId,
        prompt: [{ type: "text", text: input.prompt }],
      },
      input.timeoutMs,
    );
    return session.output;
  } catch (error) {
    await session.acp
      .notify("session/cancel", { sessionId: session.acpSessionId })
      .catch(() => undefined);
    if (session.closed) await dropLive(hostId);
    throw error;
  } finally {
    session.collecting = false;
    await dropLive(hostId);
  }
}

async function ensureLive(cwd: string, hostId: HostId): Promise<LiveText> {
  const state = stateFor(hostId);
  const current = state.live;
  if (current && !current.closed) {
    if (projectKey(current.cwd) === projectKey(cwd)) return current;
    try {
      await openSession(current, cwd);
      return current;
    } catch {
      await dropLive(hostId);
    }
  }
  return startLive(cwd, hostId);
}

async function startLive(cwd: string, hostId: HostId): Promise<LiveText> {
  await dropLive(hostId);
  const state = stateFor(hostId);
  const { path } = await resolveCursorBinary(hostId);
  const acpRef: { session: LiveText | null } = { session: null };
  const acp = new AcpClient(
    TEXT_CHILD_ID,
    {
      onNotification: (method, params) => {
        const session = acpRef.session;
        if (!session || method !== "session/update" || !session.collecting) return;
        session.output = mergeStream(session.output, textFromUpdate(params));
      },
      onRequest: (id, method, params) => {
        void handleTextRequest(acp, id, method, params);
      },
    },
    hostId,
  );
  const session: LiveText = {
    acp,
    cwd,
    acpSessionId: "",
    collecting: false,
    output: "",
    closed: false,
  };
  acpRef.session = session;

  watchChild(
    TEXT_CHILD_ID,
    (line) => acp.pushLine(line),
    () => {
      session.closed = true;
      if (state.live === session) state.live = null;
      acp.close(new Error("Cursor text generator exited"));
    },
    undefined,
    hostId,
  );

  try {
    await spawnChild(TEXT_CHILD_ID, path, ["acp"], cwd, hostId);
    await acp.request(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: CLIENT_CAPABILITIES,
        clientInfo: { name: "wavex-text", version: "0.1.0" },
      },
      INIT_TIMEOUT_MS,
    );
    await acp
      .request("authenticate", { methodId: "cursor_login" }, REQUEST_TIMEOUT_MS)
      .catch(() => undefined);
    await openSession(session, cwd);
    state.live = session;
    return session;
  } catch (error) {
    session.closed = true;
    acp.close(error instanceof Error ? error : new Error(String(error)));
    unwatchChild(TEXT_CHILD_ID, hostId);
    await killChild(TEXT_CHILD_ID, hostId).catch(() => undefined);
    throw error;
  }
}

async function openSession(session: LiveText, cwd: string): Promise<void> {
  const setup = await session.acp.request<{
    sessionId?: string;
    configOptions?: unknown;
  }>("session/new", { cwd, mcpServers: [] }, REQUEST_TIMEOUT_MS);
  const acpSessionId = setup.sessionId?.trim();
  if (!acpSessionId) throw new Error("Cursor did not return a session id");

  await session.acp
    .request("session/set_mode", { sessionId: acpSessionId, modeId: "ask" }, REQUEST_TIMEOUT_MS)
    .catch(() => undefined);

  const modelConfigId = extractModelConfigId(setup.configOptions);
  const textModel = gitWritingModelNativeId("cursor") ?? TEXT_MODEL;
  await session.acp
    .request(
      "session/set_config_option",
      {
        sessionId: acpSessionId,
        configId: modelConfigId,
        value: textModel,
      },
      REQUEST_TIMEOUT_MS,
    )
    .catch(() =>
      session.acp
        .request(
          "session/set_model",
          { sessionId: acpSessionId, modelId: textModel },
          REQUEST_TIMEOUT_MS,
        )
        .catch(() => undefined),
    );

  session.cwd = cwd;
  session.acpSessionId = acpSessionId;
}

async function dropLive(hostId: HostId): Promise<void> {
  const state = stateFor(hostId);
  const current = state.live;
  state.live = null;
  if (current) {
    current.closed = true;
    current.acp.close();
  }
  unwatchChild(TEXT_CHILD_ID, hostId);
  await killChild(TEXT_CHILD_ID, hostId).catch(() => undefined);
}

async function handleTextRequest(acp: AcpClient, id: number, method: string, params: unknown) {
  if (method === "session/request_permission") {
    const optionIds = permissionOptionIds(params);
    const optionId = optionIds.find((value) => /reject|deny|cancel/i.test(value)) ?? "reject-once";
    await acp.respond(id, { outcome: { outcome: "selected", optionId } }).catch(() => undefined);
    return;
  }
  if (method === "cursor/ask_question") {
    await acp
      .respond(id, {
        outcome: {
          outcome: "skipped",
          reason: "Text generation does not answer questions",
        },
      })
      .catch(() => undefined);
    return;
  }
  await acp.respond(id, {}).catch(() => undefined);
}

function permissionOptionIds(params: unknown): string[] {
  const rec = asRecord(params);
  const options = Array.isArray(rec?.options) ? rec.options : [];
  return options.flatMap((item) => {
    const id = asRecord(item)?.optionId;
    return typeof id === "string" ? [id] : [];
  });
}

function extractModelConfigId(raw: unknown): string {
  if (!Array.isArray(raw)) return "model";
  for (const item of raw) {
    const rec = asRecord(item);
    const id = String(rec?.id ?? rec?.configId ?? "").trim();
    const category = String(rec?.category ?? "").trim();
    if (id && (category === "model" || id === "model")) return id;
  }
  return "model";
}

function textFromUpdate(params: unknown): string {
  const rec = asRecord(params);
  const update = asRecord(rec?.update) ?? rec;
  if (!update) return "";
  const kind = String(update.sessionUpdate ?? update.session_update ?? update.type ?? "");
  if (kind !== "agent_message_chunk" && kind !== "agent_message") return "";
  return textFromContent(update.content ?? update.text);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  const rec = asRecord(content);
  if (rec && typeof rec.text === "string") return rec.text;
  if (rec && rec.content != null) return textFromContent(rec.content);
  if (Array.isArray(content)) {
    return content.map((item) => textFromContent(item)).join("");
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
