/**
 * The transport for the machine drawing this window.
 *
 * In the desktop app that is Tauri IPC. In a browser tab there is no native
 * shell at all, so the same seam answers "there is nothing here to ask" —
 * cleanly, as a rejected promise — instead of throwing out of whatever render
 * happened to call it. Events keep working either way: Tauri broadcasts them
 * between this client's windows, and a tab, which has exactly one, delivers
 * them to itself.
 */
import { IS_TAURI, LocalOnlyError } from "../clientRuntime";
import type { ListenOptions, LocalTransport, TransportEvent, UnlistenFn } from "./types";

export function createLocalTransport(): LocalTransport {
  return IS_TAURI ? tauriTransport() : browserTransport();
}

function tauriTransport(): LocalTransport {
  return {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<T>(command, args);
    },

    async listen<T>(
      event: string,
      handler: (event: TransportEvent<T>) => void,
      options?: ListenOptions,
    ): Promise<UnlistenFn> {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<T>(event, handler, options as Parameters<typeof listen>[2]);
    },

    async emit(event: string, payload?: unknown): Promise<void> {
      const { emit } = await import("@tauri-apps/api/event");
      await emit(event, payload);
    },
  };
}

/**
 * A tab is the only window of its client, so `emit` still has to arrive: the
 * resync reload announces itself this way, and dropping it would leave a
 * client showing a transcript that stopped growing with nothing to say why.
 */
function browserTransport(): LocalTransport {
  const listeners = new Map<string, Set<(event: TransportEvent<unknown>) => void>>();
  let nextId = 1;

  return {
    invoke<T>(command: string): Promise<T> {
      return Promise.reject(new LocalOnlyError(`"${command}"`));
    },

    listen<T>(event: string, handler: (event: TransportEvent<T>) => void): Promise<UnlistenFn> {
      const handlers = listeners.get(event) ?? new Set<(event: TransportEvent<unknown>) => void>();
      handlers.add(handler as (event: TransportEvent<unknown>) => void);
      listeners.set(event, handlers);
      return Promise.resolve(() => {
        handlers.delete(handler as (event: TransportEvent<unknown>) => void);
        if (handlers.size === 0) listeners.delete(event);
      });
    },

    emit(event: string, payload?: unknown): Promise<void> {
      const handlers = listeners.get(event);
      if (handlers) {
        const message: TransportEvent<unknown> = { event, id: nextId++, payload };
        for (const handler of handlers) handler(message);
      }
      return Promise.resolve();
    },
  };
}
