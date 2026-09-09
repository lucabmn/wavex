import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  invokeLocal: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/lib/transport", () => transport);

import { acpMcpServers, mcpHttpSupported } from "@/lib/mcp/session";
import { resetMcpServerChoices, setMcpServerEnabled } from "@/lib/mcp/enabled";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
      clear: () => {
        data.clear();
      },
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
    configurable: true,
  });
}

beforeEach(() => {
  mockLocalStorage();
  resetMcpServerChoices();
  transport.invokeLocal.mockClear();
  transport.invokeLocal.mockResolvedValue([]);
});

describe("mcpHttpSupported", () => {
  it("believes only what the agent advertised", () => {
    expect(mcpHttpSupported({ agentCapabilities: { mcpCapabilities: { http: true } } })).toBe(true);
    expect(mcpHttpSupported({ agentCapabilities: { mcpCapabilities: { http: false } } })).toBe(
      false,
    );
    expect(mcpHttpSupported({ agentCapabilities: {} })).toBe(false);
    expect(mcpHttpSupported({})).toBe(false);
    expect(mcpHttpSupported(undefined)).toBe(false);
    expect(mcpHttpSupported("initialized")).toBe(false);
  });
});

describe("acpMcpServers", () => {
  it("asks for nothing when the user has turned nothing on", async () => {
    expect(await acpMcpServers({ cwd: "/repo" })).toEqual([]);
    expect(transport.invokeLocal).not.toHaveBeenCalled();
  });

  it("passes the turned-on names and the agent's http answer", async () => {
    setMcpServerEnabled("context7", true);
    setMcpServerEnabled("shadcn", true);
    transport.invokeLocal.mockResolvedValue([{ name: "context7" }]);

    const servers = await acpMcpServers({
      cwd: "/repo",
      initializeResult: { agentCapabilities: { mcpCapabilities: { http: true } } },
    });

    expect(transport.invokeLocal).toHaveBeenCalledWith("mcp_session_servers", {
      cwd: "/repo",
      names: ["context7", "shadcn"],
      http: true,
    });
    expect(servers).toEqual([{ name: "context7" }]);
  });

  it("hands a remote host nothing, so no API key crosses a connection", async () => {
    setMcpServerEnabled("context7", true);
    expect(await acpMcpServers({ cwd: "/repo", hostId: "dev-box" })).toEqual([]);
    expect(transport.invokeLocal).not.toHaveBeenCalled();
  });

  it("falls back to the empty list a session always used to get", async () => {
    setMcpServerEnabled("context7", true);
    transport.invokeLocal.mockRejectedValue(new Error("no such command"));
    expect(await acpMcpServers({ cwd: "/repo" })).toEqual([]);
  });
});
