import { describe, expect, it } from "vitest";
import {
  groupMcpServers,
  mcpDefinitionKey,
  mcpGroupBlockedReason,
  mcpServerDetail,
  mcpSourceSummary,
  usableMcpGroup,
  type McpServer,
} from "@/lib/mcp/types";

function server(overrides: Partial<McpServer> = {}): McpServer {
  return {
    name: "context7",
    source: "claude",
    scope: "user",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    url: null,
    envKeys: [],
    headerKeys: [],
    cwd: null,
    enabledInCli: true,
    configPath: "/home/me/.claude.json",
    ...overrides,
  };
}

describe("groupMcpServers", () => {
  it("folds the same server configured for several CLIs into one entry", () => {
    const groups = groupMcpServers([
      server({ source: "claude" }),
      server({ source: "codex" }),
      server({ name: "shadcn", source: "codex" }),
    ]);
    expect(groups.map((group) => group.name)).toEqual(["context7", "shadcn"]);
    expect(groups[0].definitions).toHaveLength(2);
  });

  it("keeps each transport once, so a row can name them", () => {
    const groups = groupMcpServers([
      server({ source: "claude" }),
      server({ source: "codex" }),
      server({ source: "cursor", transport: "http", url: "https://example.test" }),
    ]);
    expect(groups[0].transports).toEqual(["stdio", "http"]);
  });

  it("counts the group as on while any one CLI has it on", () => {
    const groups = groupMcpServers([
      server({ source: "claude", enabledInCli: false }),
      server({ source: "codex", enabledInCli: true }),
    ]);
    expect(groups[0].enabledInCli).toBe(true);
    expect(usableMcpGroup(groups[0])).toBe(true);
  });

  it("sorts by name without letting case decide", () => {
    const groups = groupMcpServers([server({ name: "Zed" }), server({ name: "apple" })]);
    expect(groups.map((group) => group.name)).toEqual(["apple", "Zed"]);
  });
});

describe("mcpGroupBlockedReason", () => {
  it("says nothing about a server wavex can forward", () => {
    expect(mcpGroupBlockedReason(groupMcpServers([server()])[0])).toBeNull();
  });

  it("reports the CLI's own off switch rather than overriding it", () => {
    const group = groupMcpServers([server({ enabledInCli: false })])[0];
    expect(mcpGroupBlockedReason(group)).toBe("Switched off in its own configuration.");
  });

  it("reports a transport wavex does not forward", () => {
    const group = groupMcpServers([
      server({ transport: "sse", url: "https://example.test/sse", command: null }),
    ])[0];
    expect(mcpGroupBlockedReason(group)).toBe("wavex cannot forward a sse server.");
  });
});

describe("mcpServerDetail", () => {
  it("shows the command a stdio server runs", () => {
    expect(mcpServerDetail(server())).toBe("npx -y @upstash/context7-mcp");
  });

  it("shows the url of a remote server", () => {
    expect(
      mcpServerDetail(
        server({ transport: "http", command: null, args: [], url: "https://example.test/mcp" }),
      ),
    ).toBe("https://example.test/mcp");
  });

  it("names the secrets a server needs without carrying one", () => {
    const detail = mcpServerDetail(server({ envKeys: ["API_KEY"], headerKeys: ["Authorization"] }));
    expect(detail).toContain("Needs API_KEY, Authorization");
  });
});

describe("identity and labels", () => {
  it("keys a definition by the CLI and scope, not the name alone", () => {
    expect(mcpDefinitionKey(server())).toBe("claude:user:context7");
    expect(mcpDefinitionKey(server({ source: "codex" }))).not.toBe(mcpDefinitionKey(server()));
  });

  it("lists each CLI once", () => {
    const group = groupMcpServers([
      server({ source: "claude", scope: "user" }),
      server({ source: "claude", scope: "project" }),
      server({ source: "codex" }),
    ])[0];
    expect(mcpSourceSummary(group, (source) => source)).toBe("claude, codex");
  });
});
