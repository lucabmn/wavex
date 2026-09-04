/**
 * The language servers wavex knows how to talk to, and where each one's
 * workspace starts.
 *
 * Same posture as the coding-agent CLIs: wavex uses the server the user has
 * installed and never downloads one. A language with no server installed keeps
 * exactly the editor it has today.
 */

import { basename, statFiles } from "../fs";
import { isEqualOrInside, normalizeProjectPath, parentPath, pathKey } from "../paths";

/**
 * What a server needs told about a checkout — or why it cannot run against one.
 *
 * A refusal is worth more than a failed start: the server would exit with its
 * own idea of the problem, which is written for someone who already knows how
 * it is put together.
 */
export type LanguageServerSetup = { ok: true; options: unknown } | { ok: false; reason: string };

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
   * Options that depend on where the server and the checkout are, resolved once
   * when the server starts. Returning `null` means the server's own defaults.
   */
  initializationOptions?: (context: {
    root: string;
    /** The executable that was resolved, for options that sit beside it. */
    binary: string;
  }) => Promise<LanguageServerSetup>;
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

export const LANGUAGE_SERVERS: LanguageServerDefinition[] = [
  {
    id: "typescript",
    name: "TypeScript",
    binaries: ["typescript-language-server"],
    args: ["--stdio"],
    extensions: Object.keys(TYPESCRIPT_LANGUAGE_IDS),
    languageIds: TYPESCRIPT_LANGUAGE_IDS,
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json", ".git"],
    initializationOptions: typescriptOptions,
    installHint: "npm install -g typescript-language-server typescript",
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
 * Where a `tsserver` for this checkout could be, best first.
 *
 * `typescript-language-server` is only a front end: it needs a `tsserver` to
 * drive, and it looks for one in the workspace. Without one it starts and then
 * exits with "Could not find a valid TypeScript installation".
 *
 * The checkout's own copy comes first — that pins the project's version, which
 * is what decides whether the errors in the editor match the ones `tsc`
 * reports. A global install beside the server is the fallback, because
 * `npm install -g typescript-language-server typescript` is the line wavex
 * quotes and it puts both in the same `lib/node_modules`.
 */
export function tsserverCandidates(root: string, binary: string): string[] {
  const prefix = parentPath(parentPath(binary));
  return [
    `${normalizeProjectPath(root)}/node_modules/typescript/lib/tsserver.js`,
    `${prefix}/lib/node_modules/typescript/lib/tsserver.js`,
  ];
}

async function typescriptOptions({
  root,
  binary,
}: {
  root: string;
  binary: string;
}): Promise<LanguageServerSetup> {
  const candidates = tsserverCandidates(root, binary);
  const packages = candidates.map((path) => path.replace(/\/lib\/tsserver\.js$/, "/package.json"));
  const found = await statFiles([...candidates, ...packages]).catch(() => []);
  const exists = (path: string) => found.find((file) => file.path === path)?.mtimeMs != null;

  const path = candidates.find(exists);
  if (path) return { ok: true, options: { tsserver: { path } } };

  // A TypeScript that is installed but has no `tsserver.js` is the confusing
  // case — TypeScript 7 ships `tsc` and no tsserver — and it is worth saying so
  // rather than reporting it as missing.
  const installed = packages.findIndex(exists);
  if (installed !== -1) {
    return {
      ok: false,
      reason: `The TypeScript at ${packages[installed].replace(/\/package\.json$/, "")} has no tsserver.js, which typescript-language-server drives. Install TypeScript 5 in the project: \`npm install -D typescript@5\`.`,
    };
  }
  return {
    ok: false,
    reason: `No TypeScript found for this project — typescript-language-server needs one to drive. Install it with \`npm install -D typescript\`. Looked in ${candidates
      .map((candidate) => candidate.replace(/\/lib\/tsserver\.js$/, ""))
      .join(" and ")}.`,
  };
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
