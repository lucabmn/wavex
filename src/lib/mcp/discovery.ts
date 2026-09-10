/**
 * Reading the installed CLIs' MCP configuration, and asking one server what it
 * can do.
 */

import { hostPathArgs, type HostId } from "../host";
import { getDefaultHostId, hostIdForProject, invokeOn } from "../transport";
import type { McpProbeResult, McpServer } from "./types";

/** Every MCP server the installed agent CLIs define, for this checkout. */
export function listMcpServers(cwd: string, hostId?: HostId): Promise<McpServer[]> {
  const target = hostPathArgs(cwd, hostId ?? hostIdForProject(cwd), getDefaultHostId());
  return invokeOn<McpServer[]>(target.hostId, "list_mcp_servers", { cwd: target.path });
}

/**
 * Start one server, ask for its tools, and stop it again.
 *
 * Only ever called from an explicit action. Listing a server is not consent to
 * run it — the program behind `command` is arbitrary, and the settings page
 * showing it must not be what executes it.
 *
 * The server is named rather than described so its API keys never have to
 * travel out to the WebView and back; Rust re-reads the definition it already
 * parsed.
 */
export function probeMcpServer(
  cwd: string,
  server: { source: string; scope: string; name: string },
  hostId?: HostId,
): Promise<McpProbeResult> {
  const target = hostPathArgs(cwd, hostId ?? hostIdForProject(cwd), getDefaultHostId());
  return invokeOn<McpProbeResult>(target.hostId, "probe_mcp_server", {
    cwd: target.path,
    source: server.source,
    scope: server.scope,
    name: server.name,
  });
}
