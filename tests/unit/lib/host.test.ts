import { afterEach, describe, expect, it } from "vitest";
import { displayPath, prettyCwd, projectName, stripHostRef } from "@/lib/paths";
import { looksLikeProject, sameProjectPath } from "@/lib/recents";
import {
  LOCAL_HOST_ID,
  formatProjectRef,
  hostPathArgs,
  hostPathKey,
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
  setUnqualifiedHost,
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
  it("leaves a local session key unprefixed", () => {
    expect(sessionRefKey(LOCAL_HOST_ID, "abc123")).toBe("abc123");
  });

  it("qualifies a remote host so two hosts cannot share a slot", () => {
    expect(sessionRefKey("dev-box", "abc123")).not.toBe(sessionRefKey("cloud-vm", "abc123"));
    expect(sessionRefKey("dev-box", "abc123")).not.toBe("abc123");
  });
});

describe("hostPathArgs", () => {
  it("routes a bare path to this client's default host", () => {
    expect(hostPathArgs("/home/me/app", undefined, LOCAL_HOST_ID)).toEqual({
      hostId: LOCAL_HOST_ID,
      path: "/home/me/app",
    });
  });

  it("routes a reference to the host it names, with no host passed", () => {
    expect(hostPathArgs("wavex-host://dev-box//home/me/app", undefined, LOCAL_HOST_ID)).toEqual({
      hostId: "dev-box",
      path: "/home/me/app",
    });
  });

  it("sends the bare path over the wire, never the reference", () => {
    expect(hostPathArgs("wavex-host://dev-box//srv/app", undefined, LOCAL_HOST_ID).path).toBe(
      "/srv/app",
    );
  });

  it("lets an explicitly passed host win over the reference", () => {
    expect(hostPathArgs("wavex-host://dev-box//srv/app", "cloud-vm", LOCAL_HOST_ID)).toEqual({
      hostId: "cloud-vm",
      path: "/srv/app",
    });
  });

  it("resolves a bare path against a browser client whose default is remote", () => {
    expect(hostPathArgs("/srv/app", undefined, "dev-box").hostId).toBe("dev-box");
  });
});

describe("hostPathKey", () => {
  it("puts a project root and the paths under it in one namespace", () => {
    const root = hostPathKey("dev-box", "wavex-host://dev-box//srv/app");
    expect(hostPathKey("dev-box", "/srv/app/src").startsWith(`${root}/`)).toBe(true);
  });

  it("keeps the same path on two hosts apart", () => {
    expect(hostPathKey("dev-box", "/srv/app")).not.toBe(hostPathKey("cloud-vm", "/srv/app"));
    expect(hostPathKey(LOCAL_HOST_ID, "/srv/app")).not.toBe(hostPathKey("dev-box", "/srv/app"));
  });
});

describe("a remote project reference through the workspace", () => {
  const ref = formatProjectRef(projectRef("dev-box", "/home/me/app"));

  it("is a project the rail will accept", () => {
    expect(looksLikeProject(ref)).toBe(true);
  });

  it("matches itself between the rail, a tab, and a pin", () => {
    expect(sameProjectPath(ref, "wavex-host://dev-box//home/me/app/")).toBe(true);
    expect(sameProjectPath(ref, "/home/me/app")).toBe(false);
  });

  it("reads as a path, not as a URL, everywhere it is drawn", () => {
    expect(stripHostRef(ref)).toBe("/home/me/app");
    expect(prettyCwd(ref)).toBe("~/app");
    expect(projectName(ref)).toBe("app");
    expect(displayPath("/home/me/app/src/main.rs", ref)).toBe("src/main.rs");
  });

  it("keys apart from the same path on this device", () => {
    expect(projectKey(ref)).not.toBe(projectKey("/home/me/app"));
  });
});

describe("the machine an unqualified name belongs to", () => {
  afterEach(() => {
    setUnqualifiedHost("local");
  });

  it("keeps a bare path unprefixed on the desktop", () => {
    expect(projectKey("/Users/me/app")).toBe(projectKey("/Users/me/app"));
    expect(projectKey("/Users/me/app")).toBe("/Users/me/app");
  });

  it("collapses a bare path and a reference to the same checkout in a browser", () => {
    // The recents list stores a project bare and the rail order stores it as a
    // reference. On the desktop those are two machines; in a tab, which has no
    // machine of its own, they are one project — and two keys would split it
    // into two rail entries, two tabs, and a pin that never matches.
    setUnqualifiedHost("host-dev-box");
    expect(projectKey("/srv/app")).toBe(projectKey("wavex-host://host-dev-box//srv/app"));
  });

  it("still tells two hosts with the same checkout path apart", () => {
    setUnqualifiedHost("host-dev-box");
    expect(projectKey("/srv/app")).not.toBe(projectKey("wavex-host://other-box//srv/app"));
  });
});
