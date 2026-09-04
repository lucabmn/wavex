import type { HostTransport, ListenOptions, TransportEvent, UnlistenFn } from "./types";

export function createTauriTransport(): HostTransport {
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
