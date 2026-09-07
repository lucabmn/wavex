import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetcher = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal("window", { location: { protocol: "http:", host: "127.0.0.1:47821" } });
  vi.stubGlobal("fetch", fetcher);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function browserHost() {
  return import("@/lib/browserHost");
}

describe("a browser client's session", () => {
  it("connects to the host that served the page rather than to a typed address", async () => {
    const { hostEndpoint } = await browserHost();
    expect(hostEndpoint()).toBe("ws://127.0.0.1:47821/api/v1/connect");
  });

  it("sends the connection code to the host and never keeps it", async () => {
    fetcher.mockResolvedValue(
      jsonResponse(200, { hostId: "host-abc", name: "Desk box", platform: "linux" }),
    );
    const { pairBrowser } = await browserHost();

    const host = await pairBrowser("  wavex-connect:abc  ");
    expect(host).toEqual({ hostId: "host-abc", name: "Desk box", platform: "linux" });

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/session");
    // Same-origin credentials are what carries the cookie the host sets. The
    // token itself is spent here and lives nowhere the page can read it back.
    expect(init.credentials).toBe("same-origin");
    expect(String(init.body)).toContain("wavex-connect:abc");
    expect(String(init.body)).not.toContain("  ");
  });

  it("reports the host's own refusal rather than a status code", async () => {
    fetcher.mockResolvedValue(
      jsonResponse(401, { error: "That connection code is not this host's" }),
    );
    const { pairBrowser } = await browserHost();
    await expect(pairBrowser("wavex-connect:abc")).rejects.toThrow(
      "That connection code is not this host's",
    );
  });

  it("treats a host that does not identify itself as unusable", async () => {
    fetcher.mockResolvedValue(jsonResponse(200, { name: "Desk box" }));
    const { pairBrowser } = await browserHost();
    await expect(pairBrowser("wavex-connect:abc")).rejects.toThrow(/did not identify itself/);
  });

  it("has no host when this browser was never paired", async () => {
    fetcher.mockResolvedValue(jsonResponse(401, { error: "not paired" }));
    const { currentBrowserHost } = await browserHost();
    expect(await currentBrowserHost()).toBeNull();
  });

  it("has no host when the host cannot be reached at all", async () => {
    fetcher.mockRejectedValue(new Error("connection refused"));
    const { currentBrowserHost } = await browserHost();
    expect(await currentBrowserHost()).toBeNull();
  });
});
