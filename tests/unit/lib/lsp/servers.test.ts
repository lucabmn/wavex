import { describe, expect, it } from "vitest";
import {
  LANGUAGE_SERVERS,
  languageIdForPath,
  serverForPath,
  serverKey,
  pickServerRoot,
} from "@/lib/lsp/servers";

const rustAnalyzer = LANGUAGE_SERVERS.find((server) => server.id === "rust-analyzer")!;
const typescript = LANGUAGE_SERVERS.find((server) => server.id === "typescript")!;

function markersIn(paths: Record<string, string[]>) {
  return (directory: string, marker: string) => (paths[directory] ?? []).includes(marker);
}

describe("serverForPath", () => {
  it("routes a file to the server that owns its extension", () => {
    expect(serverForPath("/app/src/main.rs")?.id).toBe("rust-analyzer");
    expect(serverForPath("/app/src/App.tsx")?.id).toBe("typescript");
    expect(serverForPath("/app/main.go")?.id).toBe("gopls");
  });

  it("is case-insensitive about the extension", () => {
    expect(serverForPath("/app/Main.RS")?.id).toBe("rust-analyzer");
  });

  it("has no server for a language wavex does not cover", () => {
    expect(serverForPath("/app/README.md")).toBeNull();
    expect(serverForPath("/app/Makefile")).toBeNull();
  });
});

describe("languageIdForPath", () => {
  it("distinguishes the JSX language ids", () => {
    expect(languageIdForPath(typescript, "/a/b.ts")).toBe("typescript");
    expect(languageIdForPath(typescript, "/a/b.tsx")).toBe("typescriptreact");
    expect(languageIdForPath(typescript, "/a/b.jsx")).toBe("javascriptreact");
  });
});

describe("pickServerRoot", () => {
  it("takes the outermost marker inside the project", () => {
    const markers = markersIn({
      "/app": ["Cargo.toml", ".git"],
      "/app/crates/core": ["Cargo.toml"],
    });
    expect(pickServerRoot(rustAnalyzer, "/app/crates/core/src/lib.rs", "/app", markers)).toBe(
      "/app",
    );
  });

  it("never leaves the project even when a marker sits above it", () => {
    const markers = markersIn({ "/": ["Cargo.toml"], "/repo": [] });
    expect(pickServerRoot(rustAnalyzer, "/repo/src/main.rs", "/repo", markers)).toBe("/repo");
  });

  it("roots per worktree checkout rather than at the shared repository", () => {
    const markers = markersIn({
      "/repo": ["Cargo.toml", ".git"],
      "/repo/.wavex/worktrees/feature": ["Cargo.toml", ".git"],
    });
    const worktree = "/repo/.wavex/worktrees/feature";
    expect(pickServerRoot(rustAnalyzer, `${worktree}/src/main.rs`, worktree, markers)).toBe(
      worktree,
    );
  });

  it("falls back to the project when nothing is marked", () => {
    expect(pickServerRoot(typescript, "/app/src/a.ts", "/app", () => false)).toBe("/app");
  });

  it("falls back to the project for a file outside it", () => {
    expect(pickServerRoot(typescript, "/elsewhere/a.ts", "/app", () => true)).toBe("/app");
  });

  it("finds a marker in the file's own directory", () => {
    const markers = markersIn({ "/app/pkg": ["package.json"] });
    expect(pickServerRoot(typescript, "/app/pkg/a.ts", "/app", markers)).toBe("/app/pkg");
  });
});

describe("serverKey", () => {
  it("separates two checkouts of the same repository", () => {
    expect(serverKey("rust-analyzer", "/repo", "main")).not.toBe(
      serverKey("rust-analyzer", "/repo/.wavex/worktrees/feature", "main"),
    );
  });

  it("separates two windows on the same checkout", () => {
    expect(serverKey("rust-analyzer", "/repo", "main")).not.toBe(
      serverKey("rust-analyzer", "/repo", "main-2"),
    );
  });

  it("folds Windows case so one checkout is one server", () => {
    expect(serverKey("typescript", "C:/Users/me/app", "main")).toBe(
      serverKey("typescript", "c:/users/me/app", "main"),
    );
  });
});
