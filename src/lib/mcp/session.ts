/**
 * The `mcpServers` an ACP agent is started with.
 *
 * Cursor, fx, and grok take their MCP servers in `session/new`, so wavex has to
 * put them there — unlike Claude and Codex, which read their own configuration
 * and need nothing from wavex. Until this existed every ACP session started
 * with an empty list, which is still what an agent gets when the user has
 * turned nothing on.
 */

import { isLocalHostId, type HostId } from "../host";
import { invokeLocal } from "../transport";
import { enabledMcpServerNames } from "./enabled";

/**
 * Whether the agent said it can talk to an HTTP server.
 *
 * Derived from what the agent advertised rather than assumed from a protocol
 * version, because an entry an agent does not understand fails `session/new` —
 * and a failed `session/new` is a session that never starts. Stdio is the
 * baseline every ACP agent has.
 */
export function mcpHttpSupported(initializeResult: unknown): boolean {
  if (!initializeResult || typeof initializeResult !== "object") return false;
  const agent = (initializeResult as { agentCapabilities?: unknown }).agentCapabilities;
  if (!agent || typeof agent !== "object") return false;
  const mcp = (agent as { mcpCapabilities?: unknown }).mcpCapabilities;
  if (!mcp || typeof mcp !== "object") return false;
  return (mcp as { http?: unknown }).http === true;
}

/**
 * The payload for `session/new` and `session/load`, which must match: a resumed
 * session with fewer tools than a fresh one is a bug nobody can see.
 *
 * Empty is always a valid answer, and the answer whenever anything is unusual —
 * no servers turned on, a remote host, a command that failed. The caller can
 * then fall back to it without a second code path.
 */
export async function acpMcpServers(input: {
  cwd: string;
  hostId?: HostId;
  /** The `initialize` result, for the HTTP capability check. */
  initializeResult?: unknown;
}): Promise<unknown[]> {
  // A connected client composing this message would be shipping the host's API
  // keys across the connection, so `mcp_session_servers` is not on the connect
  // allowlist and a remote session keeps the empty list it always had.
  if (input.hostId && !isLocalHostId(input.hostId)) return [];
  const names = enabledMcpServerNames();
  if (names.length === 0) return [];
  try {
    return await invokeLocal<unknown[]>("mcp_session_servers", {
      cwd: input.cwd,
      names,
      http: mcpHttpSupported(input.initializeResult),
    });
  } catch {
    return [];
  }
}
