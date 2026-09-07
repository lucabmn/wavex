import { describe, expect, it } from "vitest";
import {
  LANGUAGE_SERVERS,
  nativeTypescriptBinaries,
  nativeTypescriptDirs,
  typescriptLaunch,
  typescriptPackages,
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

describe("typescriptPackages", () => {
  it("prefers the checkout's own TypeScript over a global one", () => {
    expect(typescriptPackages("/app", "/Users/me/.local/bin/typescript-language-server")[0]).toBe(
      "/app/node_modules/typescript",
    );
  });

  it("finds both npm global layouts beside the resolved binary", () => {
    const [, unix, windows] = typescriptPackages(
      "/app",
      "C:/Users/me/AppData/Roaming/npm/typescript-language-server.cmd",
    );
    expect(unix).toBe("C:/Users/me/AppData/Roaming/lib/node_modules/typescript");
    expect(windows).toBe("C:/Users/me/AppData/Roaming/npm/node_modules/typescript");
  });

  it("does not double a trailing slash on the checkout", () => {
    expect(typescriptPackages("/app/", "/usr/local/bin/typescript-language-server")[0]).toBe(
      "/app/node_modules/typescript",
    );
  });
});

describe("nativeTypescriptDirs", () => {
  it("looks where a package manager may nest or hoist the platform package", () => {
    expect(nativeTypescriptDirs("/app/node_modules/typescript")).toEqual([
      "/app/node_modules/typescript/node_modules/@typescript",
      "/app/node_modules/@typescript",
    ]);
  });
});

describe("nativeTypescriptBinaries", () => {
  it("covers the Windows entry point too", () => {
    expect(nativeTypescriptBinaries("/p/@typescript/typescript-win32-x64")).toEqual([
      "/p/@typescript/typescript-win32-x64/lib/tsc",
      "/p/@typescript/typescript-win32-x64/lib/tsc.exe",
    ]);
  });
});

describe("typescriptLaunch", () => {
  const languageServer = {
    path: "/Users/me/.local/bin/typescript-language-server",
    name: "typescript-language-server",
  };
  const tsc = { path: "/Users/me/.local/bin/tsc", name: "tsc" };
  const lookedIn = ["/app/node_modules/typescript"];

  it("runs TypeScript 7 as its own language server", () => {
    const engine = {
      kind: "native" as const,
      command: "/app/node_modules/typescript/node_modules/@typescript/x/lib/tsc",
    };
    expect(typescriptLaunch({ engine, binary: languageServer, packages: [], lookedIn })).toEqual({
      ok: true,
      command: engine.command,
      args: ["--lsp", "--stdio"],
    });
  });

  it("prefers the native server even when typescript-language-server is installed", () => {
    const engine = { kind: "native" as const, command: "/app/native/tsc" };
    const launch = typescriptLaunch({ engine, binary: languageServer, packages: [], lookedIn });
    expect(launch.ok && launch.command).toBe("/app/native/tsc");
  });

  it("points typescript-language-server at the tsserver it has to drive", () => {
    const engine = {
      kind: "tsserver" as const,
      path: "/app/node_modules/typescript/lib/tsserver.js",
    };
    expect(typescriptLaunch({ engine, binary: languageServer, packages: [], lookedIn })).toEqual({
      ok: true,
      command: languageServer.path,
      args: ["--stdio"],
      initializationOptions: { tsserver: { path: engine.path } },
    });
  });

  it("refuses a TypeScript 5 with no front end to drive it", () => {
    const engine = {
      kind: "tsserver" as const,
      path: "/app/node_modules/typescript/lib/tsserver.js",
    };
    const launch = typescriptLaunch({ engine, binary: tsc, packages: [], lookedIn });
    expect(launch.ok).toBe(false);
    expect(!launch.ok && launch.reason).toContain("typescript-language-server");
  });

  it("names the TypeScript it found when that install serves neither way", () => {
    const launch = typescriptLaunch({
      engine: null,
      binary: languageServer,
      packages: ["/app/node_modules/typescript"],
      lookedIn,
    });
    expect(!launch.ok && launch.reason).toContain("/app/node_modules/typescript");
  });

  it("says where it looked when the project has no TypeScript at all", () => {
    const launch = typescriptLaunch({
      engine: null,
      binary: languageServer,
      packages: [],
      lookedIn: ["/app/node_modules/typescript", "/usr/lib/node_modules/typescript"],
    });
    expect(!launch.ok && launch.reason).toContain("/usr/lib/node_modules/typescript");
  });
});
