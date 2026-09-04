import { describe, expect, it } from "vitest";
import {
  LOCAL_HOST_ID,
  formatProjectRef,
  hostScopedStorageKey,
  isLocalHostId,
  isRemoteHostId,
  localProject,
  normalizeHostId,
  parseProjectRef,
  projectKey,
  projectRef,
  projectRefKey,
  sameProjectRef,
  sessionRefKey,
} from "@/lib/host";

describe("normalizeHostId", () => {
  it("keeps a well-formed identity and trims surrounding space", () => {
    expect(normalizeHostId(" dev-box.1 ")).toBe("dev-box.1");
    expect(normalizeHostId(LOCAL_HOST_ID)).toBe(LOCAL_HOST_ID);
  });

  it("falls back to this device for anything unusable", () => {
    expect(normalizeHostId(undefined)).toBe(LOCAL_HOST_ID);
    expect(normalizeHostId("")).toBe(LOCAL_HOST_ID);
    expect(normalizeHostId("dev box")).toBe(LOCAL_HOST_ID);
    expect(normalizeHostId("../etc")).toBe(LOCAL_HOST_ID);
    expect(normalizeHostId("a".repeat(65))).toBe(LOCAL_HOST_ID);
  });

  it("separates the local identity from a remote one", () => {
    expect(isLocalHostId(LOCAL_HOST_ID)).toBe(true);
    expect(isRemoteHostId("dev-box")).toBe(true);
    expect(isRemoteHostId(LOCAL_HOST_ID)).toBe(false);
  });
});

describe("projectRefKey", () => {
  it("keeps the local key unqualified so existing stored keys still match", () => {
    expect(projectRefKey(localProject("/home/me/app/"))).toBe("/home/me/app");
  });

  it("separates the same path on two different hosts", () => {
    const local = projectRefKey(localProject("/home/me/app"));
    const remote = projectRefKey(projectRef("dev-box", "/home/me/app"));
    const other = projectRefKey(projectRef("cloud-vm", "/home/me/app"));
    expect(remote).not.toBe(local);
    expect(remote).not.toBe(other);
  });

  it("stays case-insensitive for a Windows host seen from any client", () => {
    expect(projectRefKey(projectRef("dev-box", "C:/Users/Me/App"))).toBe(
      projectRefKey(projectRef("dev-box", "c:/users/me/app")),
    );
  });

  it("compares refs through the same key", () => {
    expect(sameProjectRef(localProject("/a"), { hostId: LOCAL_HOST_ID, path: "/a/" })).toBe(true);
    expect(sameProjectRef(localProject("/a"), projectRef("dev-box", "/a"))).toBe(false);
  });
});

describe("project ref serialization", () => {
  it("writes a local project as the bare path it has always been", () => {
    expect(formatProjectRef(localProject("/home/me/app"))).toBe("/home/me/app");
  });

  it("round-trips a remote project, including an absolute host path", () => {
    const ref = projectRef("dev-box", "/home/me/app");
    expect(formatProjectRef(ref)).toBe("wavex-host://dev-box//home/me/app");
    expect(parseProjectRef(formatProjectRef(ref))).toEqual(ref);
  });

  it("round-trips a Windows host path", () => {
    const ref = projectRef("dev-box", "C:/Users/me/app");
    expect(parseProjectRef(formatProjectRef(ref))).toEqual(ref);
  });

  it("reads a stored bare path as a project on this device", () => {
    expect(parseProjectRef("/home/me/app/")).toEqual(localProject("/home/me/app"));
  });

  it("refuses a malformed reference rather than resolving it on this device", () => {
    expect(parseProjectRef("")).toBeNull();
    expect(parseProjectRef("wavex-host://")).toBeNull();
    expect(parseProjectRef("wavex-host://dev-box")).toBeNull();
    expect(parseProjectRef("wavex-host://dev-box/")).toBeNull();
    expect(parseProjectRef("wavex-host://dev box//home/me/app")).toBeNull();
  });
});

describe("projectKey", () => {
  it("keys a stored bare path exactly as it did before wavex Link", () => {
    expect(projectKey("/home/me/app/")).toBe(projectRefKey(localProject("/home/me/app")));
    expect(projectKey("C:/Users/Me/App")).toBe(projectKey("c:/users/me/app"));
  });

  it("keys a stored host reference apart from the same path locally", () => {
    const remote = projectKey("wavex-host://dev-box//home/me/app");
    expect(remote).toBe(projectRefKey(projectRef("dev-box", "/home/me/app")));
    expect(remote).not.toBe(projectKey("/home/me/app"));
  });

  it("never lets a remote key read as a prefix of a local one", () => {
    expect(projectKey("wavex-host://dev-box//home/me").startsWith(projectKey("/home/me"))).toBe(
      false,
    );
  });
});

describe("host-scoped identities", () => {
  it("leaves local storage keys and session keys unprefixed", () => {
    expect(hostScopedStorageKey("wavex.recentProjects", LOCAL_HOST_ID)).toBe(
      "wavex.recentProjects",
    );
    expect(sessionRefKey(LOCAL_HOST_ID, "abc123")).toBe("abc123");
  });

  it("qualifies a remote host so two hosts cannot share a slot", () => {
    expect(hostScopedStorageKey("wavex.recentProjects", "dev-box")).toBe(
      "wavex.recentProjects@dev-box",
    );
    expect(sessionRefKey("dev-box", "abc123")).not.toBe(sessionRefKey("cloud-vm", "abc123"));
    expect(sessionRefKey("dev-box", "abc123")).not.toBe("abc123");
  });
});
