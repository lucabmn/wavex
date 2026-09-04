/**
 * Which servers are running, and which documents they are tracking.
 *
 * The same file can be open in two panes at once, and `textDocument/didOpen`
 * is per URI — a second one for a document the server already has is a
 * protocol violation. Ownership is therefore refcounted here, above the
 * components, and every editor view attaches to the one open document.
 */

import type { ChangeSet, Text } from "@codemirror/state";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listDir } from "../fs";
import { pathKey } from "../paths";
import { LspClient, type LspStatus } from "./client";

import { stopAllLanguageServers } from "./host";
import { clearDiagnosticsFor, publishDiagnostics, resetDiagnostics } from "./diagnostics";
import { isLanguageServerEnabled } from "./enabled";
import {
  pickServerRoot,
  rootCandidates,
  serverForPath,
  serverKey,
  type LanguageServerDefinition,
} from "./servers";
import { uriToPath } from "./uri";

/**
 * A server with nothing open stays warm for this long. Switching between two
 * files of a project must not pay for a rust-analyzer restart, and closing the
 * last tab of a language usually means the next one is seconds away.
 */
const IDLE_SHUTDOWN_MS = 120_000;

export type LspServerStatus = {
  /** The definition this server is an instance of, e.g. `rust-analyzer`. */
  serverId: string;
  name: string;
  root: string;
  status: LspStatus;
};

type Entry = {
  client: LspClient;
  /** Open documents by `pathKey`, refcounted across panes. */
  documents: Map<string, { path: string; open: number }>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  status: LspStatus;
};

const entries = new Map<string, Entry>();
const rootCache = new Map<string, string>();
const statusListeners = new Set<() => void>();
let statusSnapshot: LspServerStatus[] = [];

export type DocumentHandle = {
  client: LspClient;
  path: string;
  /** Push an editor transaction to the server. */
  change: (after: Text, edit?: { before: Text; changes: ChangeSet }) => void;
  save: (text: string) => void;
  release: () => void;
};

/**
 * Open `path` against its language server, starting the server if needed.
 *
 * Resolves to `null` when wavex knows no server for the language, the user has
 * not turned that server on, it is not installed, or it failed to start — every
 * one of which leaves the editor exactly as it behaves without language server
 * support.
 */
export async function acquireDocument(
  path: string,
  cwd: string,
  text: string,
): Promise<DocumentHandle | null> {
  const definition = serverForPath(path);
  if (!definition || !cwd || cwd === "~") return null;
  // Nothing starts on its own. The editor offers the server the first time a
  // file it covers is opened, and only an answered yes gets past here.
  if (!isLanguageServerEnabled(definition.id)) return null;

  const root = await resolveRoot(definition, path, cwd);
  const key = serverKey(definition.id, root, getCurrentWindow().label);
  const entry = entries.get(key) ?? createEntry(key, definition, root);

  clearIdle(entry);
  try {
    await entry.client.start();
  } catch {
    // The status carries the reason; the caller falls back to plain editing.
    scheduleIdle(key, entry);
    return null;
  }

  const documentKey = pathKey(path);
  const open = entry.documents.get(documentKey)?.open ?? 0;
  entry.documents.set(documentKey, { path, open: open + 1 });
  if (open === 0) entry.client.openDocument(path, text);

  let released = false;
  return {
    client: entry.client,
    path,
    change: (after, edit) => entry.client.changeDocument(path, after, edit),
    save: (saved) => entry.client.saveDocument(path, saved),
    release: () => {
      if (released) return;
      released = true;
      releaseDocument(key, documentKey, path);
    },
  };
}

function releaseDocument(key: string, documentKey: string, path: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  const open = entry.documents.get(documentKey)?.open ?? 0;
  if (open <= 1) {
    entry.documents.delete(documentKey);
    entry.client.closeDocument(path);
    clearDiagnosticsFor(path);
  } else {
    entry.documents.set(documentKey, { path, open: open - 1 });
  }
  if (entry.documents.size === 0) scheduleIdle(key, entry);
}

function createEntry(key: string, definition: LanguageServerDefinition, root: string): Entry {
  const entry: Entry = {
    client: new LspClient(definition, root, key, {
      onDiagnostics: (uri, diagnostics) => {
        const target = uriToPath(uri);
        if (target) publishDiagnostics(target, diagnostics);
      },
      onStatus: (status) => {
        const current = entries.get(key);
        if (!current) return;
        current.status = status;
        emitStatus();
      },
    }),
    documents: new Map(),
    idleTimer: null,
    status: { state: "starting" },
  };
  entries.set(key, entry);
  emitStatus();
  return entry;
}

function clearIdle(entry: Entry): void {
  if (entry.idleTimer === null) return;
  clearTimeout(entry.idleTimer);
  entry.idleTimer = null;
}

function scheduleIdle(key: string, entry: Entry): void {
  clearIdle(entry);
  entry.idleTimer = setTimeout(() => {
    const current = entries.get(key);
    if (!current || current.documents.size > 0) return;
    entries.delete(key);
    emitStatus();
    void current.client.stop();
  }, IDLE_SHUTDOWN_MS);
}

/**
 * Root markers are read once per file. The walk touches every directory
 * between the file and the project, and a server root does not move while the
 * project is open.
 */
async function resolveRoot(
  definition: LanguageServerDefinition,
  path: string,
  cwd: string,
): Promise<string> {
  const cacheKey = `${definition.id}:${pathKey(path)}`;
  const cached = rootCache.get(cacheKey);
  if (cached) return cached;

  // Outermost first, so the common case — the project directory itself carries
  // the marker — costs one directory listing and stops.
  const marked = new Map<string, ReadonlySet<string>>();
  for (const directory of rootCandidates(path, cwd)) {
    const names = await listDir(directory)
      .then((files) => new Set(files.map((file) => file.name)))
      .catch(() => new Set<string>());
    marked.set(directory, names);
    if (definition.rootMarkers.some((marker) => names.has(marker))) break;
  }

  const root = pickServerRoot(definition, path, cwd, (directory, marker) =>
    (marked.get(directory) ?? new Set<string>()).has(marker),
  );
  rootCache.set(cacheKey, root);
  return root;
}

export function subscribeLspStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function lspStatusSnapshot(): LspServerStatus[] {
  return statusSnapshot;
}

function emitStatus(): void {
  statusSnapshot = [...entries.values()].map((entry) => ({
    serverId: entry.client.server.id,
    name: entry.client.server.name,
    root: entry.client.root,
    status: entry.status,
  }));
  for (const listener of statusListeners) listener();
}

/** Every running server, for a query that is not about one open file. */
export function runningLspClients(): LspClient[] {
  return [...entries.values()].filter((entry) => entry.client.isReady).map((entry) => entry.client);
}

/** The client that already has `path` open, for a command outside the editor. */
export function clientForOpenDocument(path: string): LspClient | null {
  for (const entry of entries.values()) {
    if (entry.client.hasDocument(path)) return entry.client;
  }
  return null;
}

/**
 * Drop the failed instances of one definition so the next open starts fresh.
 *
 * Only on an explicit retry. A failed client is otherwise kept and reused —
 * returning its rejected start immediately — so a server that cannot run is not
 * respawned on every file the user opens.
 */
export async function retryLspServersFor(serverId: string): Promise<void> {
  const failed = [...entries.entries()].filter(
    ([, entry]) => entry.client.server.id === serverId && entry.status.state === "failed",
  );
  if (failed.length === 0) return;
  for (const [key, entry] of failed) {
    clearIdle(entry);
    entries.delete(key);
  }
  emitStatus();
  await Promise.all(failed.map(([, entry]) => entry.client.stop().catch(() => undefined)));
}

/** Stop every running instance of one definition, e.g. when it is turned off. */
export async function stopLspServersFor(serverId: string): Promise<void> {
  const stopping = [...entries.entries()].filter(
    ([, entry]) => entry.client.server.id === serverId,
  );
  if (stopping.length === 0) return;
  for (const [key, entry] of stopping) {
    clearIdle(entry);
    entries.delete(key);
    for (const document of entry.documents.values()) clearDiagnosticsFor(document.path);
  }
  emitStatus();
  await Promise.all(stopping.map(([, entry]) => entry.client.stop().catch(() => undefined)));
}

/**
 * Every server this window started. Called when the window is torn down.
 *
 * Only this window's, not the host's whole map: another window may be open on
 * the same project, and its servers are keyed separately precisely so this can
 * stop without reaching into them.
 */
export async function stopWindowLspServers(): Promise<void> {
  const running = [...entries.values()];
  entries.clear();
  rootCache.clear();
  statusSnapshot = [];
  for (const entry of running) clearIdle(entry);
  resetDiagnostics();
  emitStatus();
  await Promise.all(running.map((entry) => entry.client.stop().catch(() => undefined)));
}

/**
 * Every server of every window. Only for a profile switch, where the whole app
 * moves off the profile the servers were indexing. The host drains its own map
 * too, so a client that never reached `initialize` cannot leave a child behind.
 */
export async function stopAllLspServers(): Promise<void> {
  await stopWindowLspServers();
  await stopAllLanguageServers();
}
