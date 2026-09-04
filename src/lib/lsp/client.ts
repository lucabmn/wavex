/**
 * One running language server, and the documents it is tracking.
 *
 * The client owns the handshake, the capability record, and document sync. It
 * is deliberately unaware of CodeMirror: the editor extensions in
 * `lib/editor/` call these methods and translate the results.
 */

import type { ChangeSet, Text } from "@codemirror/state";
import { pathKey } from "../paths";
import { LspConnection } from "./connection";
import { contentChangesFor } from "./documentSync";
import { resolveLanguageServer, startLanguageServer, stopLanguageServer } from "./host";
import { languageIdForPath, type LanguageServerDefinition } from "./servers";
import { pathToUri } from "./uri";
import type {
  LspCompletionItem,
  LspCompletionList,
  LspDiagnostic,
  LspDocumentSymbol,
  LspHover,
  LspLocation,
  LspLocationLink,
  LspPosition,
  LspPublishDiagnostics,
  LspServerCapabilities,
  LspSignatureHelp,
  LspSymbolInformation,
  LspTextDocumentSyncKind,
  LspTextEdit,
  LspWorkspaceEdit,
} from "./types";

/** A server that has not answered `initialize` by now is not going to. */
const INITIALIZE_TIMEOUT_MS = 60_000;

/** Long enough for rust-analyzer to flush, short enough not to hold a quit. */
const SHUTDOWN_TIMEOUT_MS = 1_500;

/** Enough of a failing server's output to say what went wrong. */
const MAX_STDERR_LINES = 10;

export type LspStatus =
  | { state: "starting" }
  | { state: "ready" }
  | { state: "failed"; message: string }
  | { state: "stopped" };

export type LspClientEvents = {
  onDiagnostics: (path: string, diagnostics: LspDiagnostic[]) => void;
  onStatus: (status: LspStatus) => void;
};

type TrackedDocument = {
  uri: string;
  languageId: string;
  version: number;
};

export class LspClient {
  private connection: LspConnection | null = null;
  private capabilities: LspServerCapabilities = {};
  private readonly documents = new Map<string, TrackedDocument>();
  private ready: Promise<void> | null = null;
  private stopped = false;
  /** Last stderr lines, so a failed start can say why rather than "failed". */
  private readonly stderr: string[] = [];
  /** Set once the server has failed, so late stderr can still explain it. */
  private failure: string | null = null;

  constructor(
    readonly server: LanguageServerDefinition,
    readonly root: string,
    private readonly serverId: string,
    private readonly events: LspClientEvents,
  ) {}

  get isReady(): boolean {
    return this.ready !== null && !this.stopped;
  }

  /** Idempotent: every document that opens against this server awaits it. */
  start(): Promise<void> {
    this.ready ??= this.handshake().catch((error: unknown) => {
      this.fail(error instanceof Error ? error.message : String(error));
      // Rethrow so callers `catch` rather than proceed against a dead server.
      throw error;
    });
    return this.ready;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const connection = this.connection;
    this.documents.clear();
    if (connection && !connection.isClosed) {
      // A polite shutdown lets rust-analyzer drop its on-disk caches cleanly.
      // It is best-effort: the host terminates the child either way.
      await Promise.race([
        connection.request<null>("shutdown").catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
      ]);
      connection.notify("exit");
      connection.close();
    }
    this.connection = null;
    await stopLanguageServer(this.serverId);
    this.events.onStatus({ state: "stopped" });
  }

  // Documents -------------------------------------------------------------

  openDocument(path: string, text: string): void {
    const connection = this.connection;
    const uri = pathToUri(path);
    const languageId = languageIdForPath(this.server, path);
    if (!connection || !uri || !languageId) return;
    const key = pathKey(path);
    if (this.documents.has(key)) return;

    const document: TrackedDocument = { uri, languageId, version: 1 };
    this.documents.set(key, document);
    connection.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: document.version, text },
    });
  }

  /**
   * Push an edit. `before` and `changes` describe the transaction; when they
   * are absent — a disk reload or a remount — the whole document is sent.
   */
  changeDocument(path: string, after: Text, edit?: { before: Text; changes: ChangeSet }): void {
    const connection = this.connection;
    const document = this.documents.get(pathKey(path));
    if (!connection || !document) return;

    const syncKind = this.syncKind();
    const contentChanges = edit
      ? contentChangesFor(syncKind, edit.before, after, edit.changes)
      : syncKind === 0
        ? []
        : [{ text: after.toString() }];
    if (contentChanges.length === 0) return;

    document.version += 1;
    connection.notify("textDocument/didChange", {
      textDocument: { uri: document.uri, version: document.version },
      contentChanges,
    });
  }

  saveDocument(path: string, text: string): void {
    const document = this.documents.get(pathKey(path));
    if (!this.connection || !document) return;
    this.connection.notify("textDocument/didSave", {
      textDocument: { uri: document.uri },
      text,
    });
  }

  closeDocument(path: string): void {
    const key = pathKey(path);
    const document = this.documents.get(key);
    if (!document) return;
    this.documents.delete(key);
    this.connection?.notify("textDocument/didClose", {
      textDocument: { uri: document.uri },
    });
  }

  hasDocument(path: string): boolean {
    return this.documents.has(pathKey(path));
  }

  // Requests --------------------------------------------------------------

  /** Characters that should ask the server rather than filter locally. */
  get triggerCharacters(): string[] {
    return this.capabilities.completionProvider?.triggerCharacters ?? [];
  }

  get signatureTriggerCharacters(): string[] {
    return this.capabilities.signatureHelpProvider?.triggerCharacters ?? [];
  }

  get signatureRetriggerCharacters(): string[] {
    return this.capabilities.signatureHelpProvider?.retriggerCharacters ?? [];
  }

  completion(
    path: string,
    position: LspPosition,
    context: { triggerKind: 1 | 2 | 3; triggerCharacter?: string },
    signal?: AbortSignal,
  ): Promise<LspCompletionList | LspCompletionItem[] | null> {
    if (!this.capabilities.completionProvider) return Promise.resolve(null);
    return this.send("textDocument/completion", path, { position, context }, signal);
  }

  resolveCompletion(item: LspCompletionItem, signal?: AbortSignal): Promise<LspCompletionItem> {
    if (!this.capabilities.completionProvider?.resolveProvider || !this.connection) {
      return Promise.resolve(item);
    }
    return this.connection
      .request<LspCompletionItem>("completionItem/resolve", item, signal)
      .catch(() => item);
  }

  signatureHelp(
    path: string,
    position: LspPosition,
    signal?: AbortSignal,
  ): Promise<LspSignatureHelp | null> {
    if (!this.capabilities.signatureHelpProvider) return Promise.resolve(null);
    return this.send("textDocument/signatureHelp", path, { position }, signal);
  }

  hover(path: string, position: LspPosition, signal?: AbortSignal): Promise<LspHover | null> {
    if (!this.capabilities.hoverProvider) return Promise.resolve(null);
    return this.send("textDocument/hover", path, { position }, signal);
  }

  definition(
    path: string,
    position: LspPosition,
    signal?: AbortSignal,
  ): Promise<LspLocation | LspLocation[] | LspLocationLink[] | null> {
    if (!this.capabilities.definitionProvider) return Promise.resolve(null);
    return this.send("textDocument/definition", path, { position }, signal);
  }

  references(
    path: string,
    position: LspPosition,
    signal?: AbortSignal,
  ): Promise<LspLocation[] | null> {
    if (!this.capabilities.referencesProvider) return Promise.resolve(null);
    return this.send(
      "textDocument/references",
      path,
      { position, context: { includeDeclaration: true } },
      signal,
    );
  }

  get canRename(): boolean {
    return !!this.capabilities.renameProvider;
  }

  rename(
    path: string,
    position: LspPosition,
    newName: string,
    signal?: AbortSignal,
  ): Promise<LspWorkspaceEdit | null> {
    if (!this.capabilities.renameProvider) return Promise.resolve(null);
    return this.send("textDocument/rename", path, { position, newName }, signal);
  }

  documentSymbols(path: string, signal?: AbortSignal): Promise<LspDocumentSymbol[] | null> {
    if (!this.capabilities.documentSymbolProvider) return Promise.resolve(null);
    return this.send("textDocument/documentSymbol", path, {}, signal);
  }

  workspaceSymbols(query: string, signal?: AbortSignal): Promise<LspSymbolInformation[] | null> {
    if (!this.capabilities.workspaceSymbolProvider || !this.connection) {
      return Promise.resolve(null);
    }
    return this.connection
      .request<LspSymbolInformation[] | null>("workspace/symbol", { query }, signal)
      .catch(() => null);
  }

  get canFormat(): boolean {
    return !!this.capabilities.documentFormattingProvider;
  }

  formatting(
    path: string,
    options: { tabSize: number; insertSpaces: boolean },
    signal?: AbortSignal,
  ): Promise<LspTextEdit[] | null> {
    if (!this.capabilities.documentFormattingProvider) return Promise.resolve(null);
    return this.send("textDocument/formatting", path, { options }, signal);
  }

  // Internals -------------------------------------------------------------

  private send<T>(
    method: string,
    path: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T | null> {
    const document = this.documents.get(pathKey(path));
    if (!this.connection || !document) return Promise.resolve(null);
    return this.connection
      .request<T | null>(method, { textDocument: { uri: document.uri }, ...params }, signal)
      .catch(() => null);
  }

  private syncKind(): LspTextDocumentSyncKind {
    const sync = this.capabilities.textDocumentSync;
    if (typeof sync === "number") return sync;
    return sync?.change ?? 1;
  }

  private async handshake(): Promise<void> {
    const binary = await resolveLanguageServer(this.server.binaries);
    if (!binary) {
      throw new Error(
        `${this.server.name} is not installed. Install it with \`${this.server.installHint}\`.`,
      );
    }
    this.events.onStatus({ state: "starting" });

    const connection = new LspConnection(
      this.serverId,
      (method, params) => this.onNotification(method, params),
      (method, params) => this.onServerRequest(method, params),
    );
    this.connection = connection;

    await startLanguageServer(
      this.serverId,
      { command: binary.path, args: this.server.args },
      this.root,
      {
        onMessage: (message) => connection.push(message),
        onStderr: (line) => this.rememberStderr(line),
        onExit: (code) => {
          connection.close("The language server exited");
          if (this.stopped) return;
          this.fail(`${this.server.name} exited${code === null ? "" : ` with code ${code}`}`);
        },
      },
    );

    const result = await withTimeout(
      connection.request<{ capabilities?: LspServerCapabilities }>(
        "initialize",
        this.initializeParams(),
      ),
      INITIALIZE_TIMEOUT_MS,
      `${this.server.name} did not answer initialize`,
    );
    if (this.stopped) return;

    this.capabilities = result?.capabilities ?? {};
    const encoding = this.capabilities.positionEncoding;
    if (encoding && encoding !== "utf-16") {
      // Positions would be off on every line with a non-ASCII character, and
      // wrong diagnostics are worse than none.
      throw new Error(
        `${this.server.name} answered with the ${encoding} position encoding, which wavex does not speak.`,
      );
    }

    connection.notify("initialized", {});
    this.events.onStatus({ state: "ready" });
  }

  private initializeParams() {
    const rootUri = pathToUri(this.root);
    return {
      processId: null,
      clientInfo: { name: "wavex" },
      rootUri,
      workspaceFolders: rootUri
        ? [{ uri: rootUri, name: this.root.split("/").filter(Boolean).pop() ?? this.root }]
        : null,
      initializationOptions: this.server.initializationOptions ?? null,
      capabilities: {
        general: {
          // Asked for explicitly, and asserted in the result: UTF-16 code units
          // are what a JavaScript string index already is.
          positionEncodings: ["utf-16"],
        },
        workspace: {
          workspaceFolders: true,
          configuration: true,
          didChangeConfiguration: { dynamicRegistration: true },
          symbol: { dynamicRegistration: false },
          applyEdit: false,
        },
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            didSave: true,
            willSave: false,
            willSaveWaitUntil: false,
          },
          publishDiagnostics: { relatedInformation: true, versionSupport: false },
          completion: {
            dynamicRegistration: false,
            contextSupport: true,
            completionItem: {
              snippetSupport: false,
              documentationFormat: ["markdown", "plaintext"],
              resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] },
            },
          },
          signatureHelp: {
            dynamicRegistration: false,
            signatureInformation: {
              documentationFormat: ["markdown", "plaintext"],
              parameterInformation: { labelOffsetSupport: true },
            },
          },
          hover: { dynamicRegistration: false, contentFormat: ["markdown", "plaintext"] },
          definition: { dynamicRegistration: false, linkSupport: true },
          references: { dynamicRegistration: false },
          rename: { dynamicRegistration: false, prepareSupport: false },
          documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
          formatting: { dynamicRegistration: false },
        },
      },
      trace: "off",
    };
  }

  private onNotification(method: string, params: unknown): void {
    if (method !== "textDocument/publishDiagnostics") return;
    const payload = params as LspPublishDiagnostics | undefined;
    if (!payload?.uri) return;
    this.events.onDiagnostics(payload.uri, payload.diagnostics ?? []);
  }

  private onServerRequest(method: string, params: unknown): unknown {
    if (method === "workspace/configuration") {
      // One entry per requested section. wavex configures nothing, so every
      // answer is "use your default" — but the array has to be the right shape.
      const items = (params as { items?: unknown[] } | undefined)?.items ?? [];
      return items.map(() => null);
    }
    // `client/registerCapability`, `window/workDoneProgress/create`, and the
    // rest are acknowledged with a null result. wavex registers nothing
    // dynamically and shows no progress UI for indexing.
    return null;
  }

  /**
   * A child that dies on the first line writes its reason to stderr, and that
   * write races the exit. Whatever arrives after a failure is folded into the
   * message, so "exited" becomes "exited: env: node: no such file".
   */
  private rememberStderr(line: string): void {
    this.stderr.push(line);
    if (this.stderr.length > MAX_STDERR_LINES) this.stderr.shift();
    if (this.failure) this.events.onStatus({ state: "failed", message: this.explain() });
  }

  private fail(message: string): void {
    this.failure = message;
    this.events.onStatus({ state: "failed", message: this.explain() });
  }

  private explain(): string {
    const message = this.failure ?? `${this.server.name} failed to start`;
    const detail = this.stderr.filter(Boolean).slice(-2).join(" ");
    return detail ? `${message} — ${detail}` : message;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}
