import { describe, expect, it } from "vitest";
import { pathToUri, uriToPath } from "@/lib/lsp/uri";

describe("pathToUri", () => {
  it("encodes a posix path", () => {
    expect(pathToUri("/Users/me/app/src/main.ts")).toBe("file:///Users/me/app/src/main.ts");
  });

  it("lower-cases the drive letter and keeps its colon unencoded", () => {
    expect(pathToUri("C:/Users/me/app/src/main.ts")).toBe("file:///c:/Users/me/app/src/main.ts");
  });

  it("accepts a backslash path", () => {
    expect(pathToUri("C:\\Users\\me\\main.rs")).toBe("file:///c:/Users/me/main.rs");
  });

  it("percent-encodes characters that are not path syntax", () => {
    expect(pathToUri("/Users/me/my project/a b#c.ts")).toBe(
      "file:///Users/me/my%20project/a%20b%23c.ts",
    );
  });

  it("keeps a UNC share as an authority", () => {
    expect(pathToUri("//build-server/share/main.rs")).toBe("file://build-server/share/main.rs");
  });

  it("has no URI for a relative path", () => {
    expect(pathToUri("src/main.ts")).toBeNull();
    expect(pathToUri("")).toBeNull();
  });
});

describe("uriToPath", () => {
  it("decodes a posix path", () => {
    expect(uriToPath("file:///Users/me/app/src/main.ts")).toBe("/Users/me/app/src/main.ts");
  });

  it("upper-cases the drive letter back", () => {
    expect(uriToPath("file:///c:/Users/me/main.ts")).toBe("C:/Users/me/main.ts");
  });

  it("accepts a percent-encoded drive colon", () => {
    expect(uriToPath("file:///c%3A/Users/me/main.ts")).toBe("C:/Users/me/main.ts");
  });

  it("decodes escaped characters", () => {
    expect(uriToPath("file:///Users/me/my%20project/a%20b%23c.ts")).toBe(
      "/Users/me/my project/a b#c.ts",
    );
  });

  it("restores a UNC share", () => {
    expect(uriToPath("file://build-server/share/main.rs")).toBe("//build-server/share/main.rs");
  });

  it("drops a query or fragment", () => {
    expect(uriToPath("file:///Users/me/main.ts#L12")).toBe("/Users/me/main.ts");
  });

  it("has no path for another scheme", () => {
    expect(uriToPath("untitled:Untitled-1")).toBeNull();
    expect(uriToPath("https://example.com/main.ts")).toBeNull();
  });

  it("survives a malformed escape", () => {
    expect(uriToPath("file:///Users/me/100%.ts")).toBe("/Users/me/100%.ts");
  });
});

describe("round trip", () => {
  for (const path of [
    "/Users/me/app/src/main.ts",
    "/Users/me/my project/a b.ts",
    "C:/Users/me/app/src/main.ts",
    "//build-server/share/main.rs",
  ]) {
    it(`returns the same path for ${path}`, () => {
      const uri = pathToUri(path);
      expect(uri).not.toBeNull();
      expect(uriToPath(uri as string)).toBe(path);
    });
  }
});
