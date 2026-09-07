import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The transport a client uses for its own machine. In a tab there is no
 * machine behind the document, and these are the two halves of the honest
 * answer: commands fail as commands, events still arrive.
 */
async function browserTransport() {
  vi.stubGlobal("window", {});
  vi.resetModules();
  const { createLocalTransport } = await import("@/lib/transport/local");
  return createLocalTransport();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the local transport in a browser tab", () => {
  it("refuses a native command instead of throwing mid-render", async () => {
    const transport = await browserTransport();
    await expect(transport.invoke("set_dock_badge", { count: 1 })).rejects.toThrow(
      /needs the wavex app on this machine/,
    );
  });

  it("delivers an emit to this document's own listeners", async () => {
    const transport = await browserTransport();
    const seen: unknown[] = [];
    const unlisten = await transport.listen("wavex://host-resynced", (event) => {
      seen.push(event.payload);
    });

    await transport.emit("wavex://host-resynced", { hostId: "host-1" });
    expect(seen).toEqual([{ hostId: "host-1" }]);

    // Without this the resync reload would announce itself to nobody, which
    // is exactly the client where an expired backlog is most likely.
    unlisten();
    await transport.emit("wavex://host-resynced", { hostId: "host-1" });
    expect(seen).toHaveLength(1);
  });

  it("keeps an event for one name from reaching another", async () => {
    const transport = await browserTransport();
    const seen: string[] = [];
    await transport.listen("quit_requested", () => seen.push("quit"));
    await transport.emit("open_settings");
    expect(seen).toEqual([]);
  });
});
