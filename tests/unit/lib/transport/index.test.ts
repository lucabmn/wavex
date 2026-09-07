import { describe, expect, it } from "vitest";
import { normalizeRemoteEndpoint } from "@/lib/transport";

describe("normalizeRemoteEndpoint", () => {
  it("defaults a local SSH tunnel to the Link websocket path", () => {
    expect(normalizeRemoteEndpoint("127.0.0.1:4819")).toBe("ws://127.0.0.1:4819/api/v1/connect");
    expect(normalizeRemoteEndpoint("ws://localhost:4819/")).toBe(
      "ws://localhost:4819/api/v1/connect",
    );
  });

  it("leaves the address a paired host hands out untouched", () => {
    // What `connect_host_pairing_code` emits. A rewrite here would fail only
    // at connect time, where nothing else is watching.
    expect(normalizeRemoteEndpoint("ws://127.0.0.1:8787/api/v1/connect")).toBe(
      "ws://127.0.0.1:8787/api/v1/connect",
    );
  });

  it("keeps an explicit websocket path", () => {
    expect(normalizeRemoteEndpoint("wss://dev.example.com/wavex")).toBe(
      "wss://dev.example.com/wavex",
    );
  });

  it("refuses plaintext connections to non-loopback hosts", () => {
    expect(() => normalizeRemoteEndpoint("ws://192.168.1.20:4819")).toThrow(
      "encrypted wss:// connection or a local tunnel",
    );
  });

  it("refuses credentials and tokens in the URL", () => {
    expect(() => normalizeRemoteEndpoint("wss://token@example.com")).toThrow(
      "cannot contain credentials",
    );
    expect(() => normalizeRemoteEndpoint("wss://example.com?token=secret")).toThrow(
      "cannot contain credentials",
    );
  });

  it("rejects non-websocket protocols", () => {
    expect(() => normalizeRemoteEndpoint("https://example.com")).toThrow("ws:// or wss://");
  });
});
