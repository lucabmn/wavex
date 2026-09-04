/**
 * JSON-RPC over one language server's stdio.
 *
 * Requests carry a numeric id and can be cancelled, which is what keeps typing
 * responsive: a completion or hover superseded by the next keystroke sends
 * `$/cancelRequest` instead of waiting for an answer nobody will read.
 *
 * Server-to-client requests are answered, not ignored. rust-analyzer blocks its
 * own start-up waiting for `client/registerCapability` and
 * `window/workDoneProgress/create`, so a client that only listens never
 * finishes initializing.
 */

import { sendToLanguageServer } from "./host";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

export type RequestHandler = (method: string, params: unknown) => unknown;
export type NotificationHandler = (method: string, params: unknown) => void;

/** The error a cancelled request rejects with, so callers can ignore it. */
export const LSP_CANCELLED = "lsp-cancelled";

export function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.message === LSP_CANCELLED;
}

export class LspConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed = false;

  constructor(
    private readonly serverId: string,
    private readonly onNotification: NotificationHandler,
    private readonly onRequest: RequestHandler,
  ) {}

  get isClosed(): boolean {
    return this.closed;
  }

  /** One complete frame from the host. */
  push(message: string): void {
    if (this.closed) return;
    let parsed: JsonRpcMessage;
    try {
      parsed = JSON.parse(message) as JsonRpcMessage;
    } catch {
      return;
    }
    this.handle(parsed);
  }

  request<T>(method: string, params?: unknown, signal?: AbortSignal): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Language server is not running"));
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      void this.write({ jsonrpc: "2.0", id, method, params }).catch((error: unknown) => {
        this.settle(id, undefined, error instanceof Error ? error : new Error(String(error)));
      });
    });

    if (signal) {
      if (signal.aborted) this.cancel(id);
      else signal.addEventListener("abort", () => this.cancel(id), { once: true });
    }
    return promise;
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    void this.write({ jsonrpc: "2.0", method, params }).catch(() => undefined);
  }

  /** Reject everything in flight. The child is gone or going. */
  close(reason = "Language server stopped"): void {
    if (this.closed) return;
    this.closed = true;
    const error = new Error(reason);
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
  }

  private cancel(id: number): void {
    if (!this.pending.has(id)) return;
    // The server may already have answered; `$/cancelRequest` is advisory and
    // the local rejection is what actually frees the caller.
    this.notify("$/cancelRequest", { id });
    this.settle(id, undefined, new Error(LSP_CANCELLED));
  }

  private settle(id: number, result?: unknown, error?: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (error) pending.reject(error);
    else pending.resolve(result);
  }

  private handle(message: JsonRpcMessage): void {
    if (message.id !== undefined && message.method === undefined) {
      const id = typeof message.id === "number" ? message.id : Number(message.id);
      if (message.error) {
        this.settle(id, undefined, new Error(message.error.message ?? "Language server error"));
      } else {
        this.settle(id, message.result);
      }
      return;
    }

    if (message.method === undefined) return;

    if (message.id === undefined) {
      this.onNotification(message.method, message.params);
      return;
    }

    // A server request. Answering with an error is still an answer; leaving it
    // unanswered is what deadlocks a start-up.
    let result: unknown = null;
    try {
      result = this.onRequest(message.method, message.params);
    } catch {
      result = null;
    }
    void this.write({ jsonrpc: "2.0", id: message.id, result }).catch(() => undefined);
  }

  private write(message: JsonRpcMessage): Promise<void> {
    return sendToLanguageServer(this.serverId, JSON.stringify(message));
  }
}
