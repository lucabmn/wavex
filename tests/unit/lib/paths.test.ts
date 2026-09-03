import { describe, expect, it } from "vitest";
import {
  displayPath,
  isEqualOrInside,
  joinPath,
  normalizeProjectPath,
  parentPath,
  pathKey,
  prettyCwd,
  projectName,
  rebasePath,
  resolveWorkspacePath,
  slash,
} from "@/lib/paths";

describe("windows paths", () => {
  it("normalizes separators so every helper can split on one", () => {
    expect(slash("C:\\Users\\dev\\app")).toBe("C:/Users/dev/app");
    expect(normalizeProjectPath("C:\\Users\\dev\\app\\")).toBe("C:/Users/dev/app");
    expect(normalizeProjectPath("/Users/dev/app/")).toBe("/Users/dev/app");
  });

  it("keys drive and UNC paths case-insensitively without changing display", () => {
    expect(pathKey("C:\\Users\\Dev\\App")).toBe("c:/users/dev/app");
    expect(pathKey("C:/Users/Dev/App")).toBe(pathKey("c:/users/dev/app"));
    expect(pathKey("//server/share/App")).toBe("//server/share/app");
    // POSIX paths are case-sensitive and must stay untouched.
    expect(pathKey("/Users/Dev/App")).toBe("/Users/Dev/App");
  });

  it("collapses a Windows home to ~", () => {
    expect(prettyCwd("C:\\Users\\dev\\code\\app")).toBe("~/code/app");
    expect(prettyCwd("C:/Users/dev")).toBe("~");
    expect(prettyCwd("/Users/dev/code/app")).toBe("~/code/app");
  });

  it("stops walking up at the drive root", () => {
    expect(parentPath("C:/Users/dev/app")).toBe("C:/Users/dev");
    expect(parentPath("C:/Users")).toBe("C:/");
    expect(parentPath("C:/")).toBe("C:/");
    expect(parentPath("/Users")).toBe("/");
  });

  it("names a project from a backslash path", () => {
    expect(projectName("C:\\Users\\dev\\app")).toBe("app");
    expect(projectName("C:/")).toBe("C:");
  });

  it("compares containment on the comparison key", () => {
    expect(isEqualOrInside("C:/Users/Dev/app/src", "c:/users/dev/app")).toBe(true);
    expect(isEqualOrInside("C:\\Users\\dev\\app", "C:/Users/dev/app")).toBe(true);
    expect(isEqualOrInside("C:/Users/dev/apple", "C:/Users/dev/app")).toBe(false);
  });

  it("rebases a renamed folder regardless of case or separator", () => {
    expect(
      rebasePath("C:\\Users\\dev\\app\\src\\a.ts", "c:/users/dev/app", "C:/Users/dev/next"),
    ).toBe("C:/Users/dev/next/src/a.ts");
    expect(rebasePath("/a/b/c", "/a/b", "/a/z")).toBe("/a/z/c");
    expect(rebasePath("/other/file", "/a/b", "/a/z")).toBe("/other/file");
  });

  it("joins and displays against a backslash cwd", () => {
    expect(joinPath("C:\\Users\\dev\\app", "src\\main.ts")).toBe("C:/Users/dev/app/src/main.ts");
    expect(displayPath("C:\\Users\\dev\\app\\src\\main.ts", "C:/Users/Dev/app")).toBe(
      "src/main.ts",
    );
    expect(displayPath("C:/Users/dev/app", "C:/Users/dev/app")).toBe("app");
  });

  it("resolves a workspace href relative to a Windows cwd", () => {
    expect(resolveWorkspacePath("src\\main.ts", "C:/Users/dev/app")).toBe(
      "C:/Users/dev/app/src/main.ts",
    );
    expect(resolveWorkspacePath("C:\\Users\\dev\\app\\src\\main.ts")).toBe(
      "C:/Users/dev/app/src/main.ts",
    );
  });
});
