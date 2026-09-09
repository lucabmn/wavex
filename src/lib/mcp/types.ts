/**
 * MCP server vocabulary.
 *
 * wavex does not define MCP servers; the installed agent CLIs do, each in its
 * own configuration file. Rust reads those files and this is the shape it hands
 * back. Nothing here carries a secret: a definition's API keys are named, never
 * valued — see `src-tauri/src/mcp.rs`.
 */

export type McpTransport = "stdio" | "http" | "sse";
export type McpScope = "user" | "project";

export type McpServer = {
  name: string;
  /** The agent CLI whose configuration this came from. */
  source: string;
  scope: McpScope;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  /** Environment variable names the definition sets. Values stay in Rust. */
  envKeys: string[];
  /** Header names, for the same reason. */
  headerKeys: string[];
  cwd: string | null;
  /** False when the CLI's own configuration switched the server off. */
  enabledInCli: boolean;
  configPath: string;
};

export type McpTool = {
  name: string;
  description: string;
};

export type McpProbeResult = {
  ok: boolean;
  tools: McpTool[];
  error: string | null;
};

/**
 * One server as the user thinks of it: a name, and every CLI that configured
 * it.
 *
 * The same server is routinely configured for several CLIs, so listing each
 * definition as its own row would show `context7` four times and hide the one
 * fact that matters — which agents have it.
 */
export type McpServerGroup = {
  name: string;
  definitions: McpServer[];
  /** True while at least one CLI has it switched on. */
  enabledInCli: boolean;
  /** The transports across its definitions, in a stable order. */
  transports: McpTransport[];
};

/** Identifies one definition — a name alone is ambiguous across CLIs. */
export function mcpDefinitionKey(server: McpServer): string {
  return `${server.source}:${server.scope}:${server.name}`;
}

export function groupMcpServers(servers: McpServer[]): McpServerGroup[] {
  const groups = new Map<string, McpServerGroup>();
  for (const server of servers) {
    const existing = groups.get(server.name);
    if (existing) {
      existing.definitions.push(server);
      existing.enabledInCli ||= server.enabledInCli;
      if (!existing.transports.includes(server.transport)) {
        existing.transports.push(server.transport);
      }
      continue;
    }
    groups.set(server.name, {
      name: server.name,
      definitions: [server],
      enabledInCli: server.enabledInCli,
      transports: [server.transport],
    });
  }
  return [...groups.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** "Claude, Codex" — which CLIs already have this server. */
export function mcpSourceSummary(group: McpServerGroup, title: (source: string) => string): string {
  const seen: string[] = [];
  for (const definition of group.definitions) {
    const label = title(definition.source);
    if (!seen.includes(label)) seen.push(label);
  }
  return seen.join(", ");
}

/**
 * What a row says about where a server comes from and what it needs, without
 * repeating the name.
 */
export function mcpServerDetail(server: McpServer): string {
  const parts: string[] = [];
  if (server.transport === "stdio") {
    parts.push([server.command ?? "no command", ...server.args].join(" "));
  } else if (server.url) {
    parts.push(server.url);
  }
  const secrets = [...server.envKeys, ...server.headerKeys];
  if (secrets.length > 0) parts.push(`Needs ${secrets.join(", ")}`);
  if (!server.enabledInCli) parts.push("Switched off in its own configuration");
  return parts.join(" · ");
}

/**
 * Whether wavex could hand this server to an agent it starts.
 *
 * A server its own CLI switched off stays off, and the deprecated HTTP+SSE
 * transport is one wavex neither forwards nor probes — so the row says so
 * instead of offering a switch that would do nothing.
 */
export function usableMcpDefinition(server: McpServer): boolean {
  return server.enabledInCli && (server.transport === "stdio" || server.transport === "http");
}

export function usableMcpGroup(group: McpServerGroup): boolean {
  return group.definitions.some(usableMcpDefinition);
}

/** Why a group cannot be switched on, or `null` when it can. */
export function mcpGroupBlockedReason(group: McpServerGroup): string | null {
  if (usableMcpGroup(group)) return null;
  if (group.definitions.every((server) => !server.enabledInCli)) {
    return "Switched off in its own configuration.";
  }
  return `wavex cannot forward a ${group.transports.join(" or ")} server.`;
}
