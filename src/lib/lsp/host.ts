/**
 * Typed wrapper around the Rust language server host.
 *
 * The host owns the child processes and the `Content-Length` framing; every
 * message that crosses here is one complete JSON-RPC frame.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type MessagePayload = { serverId: string; message: string };
type ExitPayload = { serverId: string; code: number | null; pid: number };

export type LspServerHandlers = {
  onMessage: (message: string) => void;
  onStderr: (line: string) => void;
  onExit: (code: number | null) => void;
};

export type LspBinary = { path: string; name: string };

const handlers = new Map<string, LspServerHandlers>();
let bridge: Promise<UnlistenFn[]> | null = null;

function ensureBridge(): Promise<UnlistenFn[]> {
  bridge ??= Promise.all([
    listen<MessagePayload>("lsp-message", (event) => {
      handlers.get(event.payload.serverId)?.onMessage(event.payload.message);
    }),
    listen<MessagePayload>("lsp-stderr", (event) => {
      handlers.get(event.payload.serverId)?.onStderr(event.payload.message);
    }),
    listen<ExitPayload>("lsp-exit", (event) => {
      handlers.get(event.payload.serverId)?.onExit(event.payload.code);
    }),
  ]);
  return bridge;
}

/** First installed candidate for a server definition, or `null` if none is. */
export function resolveLanguageServer(names: string[]): Promise<LspBinary | null> {
  return invoke<LspBinary | null>("lsp_resolve", { names }).catch(() => null);
}

export async function startLanguageServer(
  serverId: string,
  binary: { command: string; args: string[] },
  cwd: string,
  serverHandlers: LspServerHandlers,
): Promise<number> {
  handlers.set(serverId, serverHandlers);
  await ensureBridge();
  try {
    return await invoke<number>("lsp_start", {
      serverId,
      command: binary.command,
      args: binary.args,
      cwd,
    });
  } catch (error) {
    handlers.delete(serverId);
    throw error;
  }
}

export function sendToLanguageServer(serverId: string, message: string): Promise<void> {
  return invoke("lsp_send", { serverId, message });
}

export async function stopLanguageServer(serverId: string): Promise<void> {
  handlers.delete(serverId);
  await invoke("lsp_stop", { serverId }).catch(() => undefined);
}

/** Every server of this profile. Called on profile switch and window close. */
export async function stopAllLanguageServers(): Promise<void> {
  handlers.clear();
  await invoke("lsp_stop_all").catch(() => undefined);
}
