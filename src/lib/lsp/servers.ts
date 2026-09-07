/**
 * The language servers wavex knows how to talk to, and where each one's
 * workspace starts.
 *
 * Same posture as the coding-agent CLIs: wavex uses the server the user has
 * installed and never downloads one. A language with no server installed keeps
 * exactly the editor it has today.
 */

import { basename, listDir, statFiles } from "../fs";
import { isEqualOrInside, normalizeProjectPath, parentPath, pathKey } from "../paths";
import type { LspBinary } from "./host";

/**
 * How to run a server against one checkout — or why it cannot run against it.
 *
 * A refusal is worth more than a failed start: the server would exit with its
 * own idea of the problem, which is written for someone who already knows how
 * it is put together.
 */
export type LanguageServerLaunch =
  | { ok: true; command: string; args: string[]; initializationOptions?: unknown }
  | { ok: false; reason: string };

export type LanguageServerDefinition = {
  id: string;
  /** Shown in settings and in the "not installed" hint. */
  name: string;
  /** Executables to try, in order. The first one installed wins. */
  binaries: string[];
  args: string[];
  /** File extensions this server owns, lower-case and dot-prefixed. */
  extensions: string[];
  /** Protocol `languageId` per extension, for `textDocument/didOpen`. */
  languageIds: Record<string, string>;
  /**
   * Files that mark a workspace root. The outermost match inside the project
   * wins, so a monorepo gets one server rather than one per package.
   */
  rootMarkers: string[];
  /**
   * Which executable to run for this checkout, and what to tell it, resolved
   * once when the server starts. Absent means the resolved binary and the
   * definition's own `args`.
   */
  resolve?: (context: { root: string; binary: LspBinary }) => Promise<LanguageServerLaunch>;
  /** How to install it, quoted verbatim in the UI. */
  installHint: string;
};

const TYPESCRIPT_LANGUAGE_IDS: Record<string, string> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascriptreact",
};

const TYPESCRIPT_INSTALL_HINT = "npm install -g typescript-language-server typescript";

export const LANGUAGE_SERVERS: LanguageServerDefinition[] = [
  {
    id: "typescript",
    name: "TypeScript",
    // `tsc` is here because TypeScript 7 is its own language server: an install
    // with no `typescript-language-server` beside it can still serve a checkout.
    binaries: ["typescript-language-server", "tsc"],
    args: ["--stdio"],
    extensions: Object.keys(TYPESCRIPT_LANGUAGE_IDS),
    languageIds: TYPESCRIPT_LANGUAGE_IDS,
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json", ".git"],
    resolve: resolveTypescript,
    installHint: TYPESCRIPT_INSTALL_HINT,
  },
  {
    id: "rust-analyzer",
    name: "rust-analyzer",
    binaries: ["rust-analyzer"],
    args: [],
    extensions: [".rs"],
    languageIds: { ".rs": "rust" },
    rootMarkers: ["Cargo.toml", "rust-project.json", ".git"],
    installHint: "rustup component add rust-analyzer",
  },
  {
    id: "pyright",
    name: "Pyright",
    binaries: ["basedpyright-langserver", "pyright-langserver"],
    args: ["--stdio"],
    extensions: [".py", ".pyi"],
    languageIds: { ".py": "python", ".pyi": "python" },
    rootMarkers: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", ".git"],
    installHint: "npm install -g pyright",
  },
  {
    id: "gopls",
    name: "gopls",
    binaries: ["gopls"],
    args: [],
    extensions: [".go"],
    languageIds: { ".go": "go" },
    rootMarkers: ["go.work", "go.mod", ".git"],
    installHint: "go install golang.org/x/tools/gopls@latest",
  },
];

/**
 * The engine a TypeScript install offers, if it offers one.
 *
 * TypeScript 7 is a native binary that speaks the protocol itself. TypeScript 5
 * ships `tsserver.js`, which is not a language server but the back end of one:
 * `typescript-language-server` drives it and has to be told where it is.
 */
export type TypescriptEngine =
  | { kind: "native"; command: string }
  | { kind: "tsserver"; path: string };

/**
 * TypeScript packages that could serve this checkout, best first.
 *
 * The checkout's own copy comes first — that pins the project's version, which
 * is what decides whether the errors in the editor match the ones `tsc`
 * reports. A global install beside the resolved binary is the fallback, in both
 * npm layouts: `lib/node_modules` under a Unix prefix, and `node_modules`
 * beside the shim on Windows.
 */
export function typescriptPackages(root: string, binary: string): string[] {
  const bin = parentPath(normalizeProjectPath(binary));
  return [
    `${normalizeProjectPath(root)}/node_modules/typescript`,
    `${parentPath(bin)}/lib/node_modules/typescript`,
    `${bin}/node_modules/typescript`,
  ];
}

/**
 * Where TypeScript 7's platform package sits relative to its own package.
 *
 * `@typescript/typescript-<platform>-<arch>` is resolved by Node from inside
 * the `typescript` package, so a package manager may nest it or hoist it. Both
 * directories are listed rather than named, because the platform half of the
 * name is the host's and the WebView has no `process.platform` to build it
 * from.
 */
export function nativeTypescriptDirs(pkg: string): string[] {
  return [`${pkg}/node_modules/@typescript`, `${parentPath(pkg)}/@typescript`];
}

/** The native entry points inside one platform package, Windows included. */
export function nativeTypescriptBinaries(platformPackage: string): string[] {
  return [`${platformPackage}/lib/tsc`, `${platformPackage}/lib/tsc.exe`];
}

/**
 * How to launch TypeScript, given what is actually installed.
 *
 * Split from the probing so the precedence is testable: an engine found in the
 * project beats one found globally, and a native TypeScript beats a `tsserver`
 * because it needs no front end and is the version the project pinned.
 */
export function typescriptLaunch(context: {
  engine: TypescriptEngine | null;
  binary: LspBinary;
  /** TypeScript packages that exist, for a refusal that can name one. */
  packages: string[];
  lookedIn: string[];
}): LanguageServerLaunch {
  const { engine, binary, packages, lookedIn } = context;

  if (engine?.kind === "native") {
    return { ok: true, command: engine.command, args: ["--lsp", "--stdio"] };
  }

  if (engine?.kind === "tsserver") {
    if (binary.name !== "typescript-language-server") {
      return {
        ok: false,
        reason: `The TypeScript at ${parentPath(parentPath(engine.path))} is version 5, which needs typescript-language-server to drive it. Install it with \`${TYPESCRIPT_INSTALL_HINT}\`.`,
      };
    }
    return {
      ok: true,
      command: binary.path,
      args: ["--stdio"],
      initializationOptions: { tsserver: { path: engine.path } },
    };
  }

  if (packages.length > 0) {
    return {
      ok: false,
      reason: `The TypeScript at ${packages[0]} has neither a native language server nor a tsserver.js, so wavex cannot drive it. Reinstall it with \`${TYPESCRIPT_INSTALL_HINT}\`.`,
    };
  }
  return {
    ok: false,
    reason: `No TypeScript found for this project. Install it with \`npm install -D typescript\`. Looked in ${lookedIn.join(" and ")}.`,
  };
}

async function resolveTypescript({
  root,
  binary,
}: {
  root: string;
  binary: LspBinary;
}): Promise<LanguageServerLaunch> {
  const packages = typescriptPackages(root, binary.path);
  const present: string[] = [];
  let engine: TypescriptEngine | null = null;

  for (const pkg of packages) {
    engine = await typescriptEngineIn(pkg);
    if (engine) break;
    if (await fileExists(`${pkg}/package.json`)) present.push(pkg);
  }

  return typescriptLaunch({ engine, binary, packages: present, lookedIn: packages });
}

/** The best engine one TypeScript package offers, or `null` if it offers none. */
async function typescriptEngineIn(pkg: string): Promise<TypescriptEngine | null> {
  for (const directory of nativeTypescriptDirs(pkg)) {
    const entries = await listDir(directory).catch(() => []);
    for (const entry of entries) {
      const candidates = nativeTypescriptBinaries(`${directory}/${entry.name}`);
      const command = await firstExisting(candidates);
      if (command) return { kind: "native", command };
    }
  }
  const tsserver = `${pkg}/lib/tsserver.js`;
  return (await fileExists(tsserver)) ? { kind: "tsserver", path: tsserver } : null;
}

async function firstExisting(paths: string[]): Promise<string | null> {
  const found = await statFiles(paths).catch(() => []);
  return paths.find((path) => found.some((file) => file.path === path)) ?? null;
}

function fileExists(path: string): Promise<boolean> {
  return firstExisting([path]).then((found) => found !== null);
}

export function fileExtension(path: string): string {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/** The server that owns this file, or `null` for a language wavex has none for. */
export function serverForPath(path: string): LanguageServerDefinition | null {
  const extension = fileExtension(path);
  if (!extension) return null;
  return LANGUAGE_SERVERS.find((server) => server.extensions.includes(extension)) ?? null;
}

export function languageIdForPath(
  server: LanguageServerDefinition,
  path: string,
): string | undefined {
  return server.languageIds[fileExtension(path)];
}

/** The outermost candidate directory carrying one of this server's markers. */
export function pickServerRoot(
  server: LanguageServerDefinition,
  path: string,
  cwd: string,
  hasMarker: (directory: string, marker: string) => boolean,
): string {
  const candidates = rootCandidates(path, cwd);
  const marked = candidates.find((directory) =>
    server.rootMarkers.some((marker) => hasMarker(directory, marker)),
  );
  return marked ?? normalizeProjectPath(cwd);
}

/**
 * Directories that could root a server for `path`, outermost first.
 *
 * The walk starts at the project and never leaves it, and `cwd` for a worktree
 * tab is that worktree's checkout — which is the whole scoping decision. A
 * server is rooted per checkout, never at the shared repository, because a
 * worktree holds a different branch's files and a server rooted above it would
 * index, and report diagnostics against, text that is not in the file being
 * edited.
 *
 * Outermost first also means a monorepo or a Cargo workspace runs one server
 * rather than one per package.
 */
export function rootCandidates(path: string, cwd: string): string[] {
  const project = normalizeProjectPath(cwd);
  if (!isEqualOrInside(path, project)) return [project];

  const directories: string[] = [];
  for (
    let directory = parentPath(normalizeProjectPath(path));
    isEqualOrInside(directory, project);
    directory = parentPath(directory)
  ) {
    directories.push(directory);
    if (pathKey(directory) === pathKey(project)) break;
  }
  return directories.reverse();
}

/**
 * Stable key for one running server: one per definition, per checkout root,
 * per window.
 *
 * The window belongs in the key. The Rust host keys its children on this string
 * and broadcasts every frame to every webview, so two windows sharing a key
 * would answer each other's requests — their request ids both start at one —
 * and each window's start would terminate the other's child. Two windows on one
 * project therefore run two servers, which is also what makes closing one
 * window able to stop its own without reaching into the other's.
 */
export function serverKey(serverId: string, root: string, windowLabel: string): string {
  return `${windowLabel}:${serverId}@${pathKey(root)}`;
}
