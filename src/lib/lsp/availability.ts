/**
 * Which language servers are installed.
 *
 * Same posture as the agent CLIs: wavex reports what it found and how to
 * install what it did not. It never downloads a server.
 */

import { resolveLanguageServer } from "./host";
import { LANGUAGE_SERVERS } from "./servers";

export type LanguageServerAvailability = {
  /** The executable that matched, or `null` when none is installed. */
  binary: string | null;
};

const availability = new Map<string, LanguageServerAvailability>();
const listeners = new Set<() => void>();
let version = 0;
let inflight: Promise<void> | null = null;
let probedAt = 0;

/** A probe stats a few dozen paths per server. Installing one mid-session is rare. */
const PROBE_TTL_MS = 30_000;

export function subscribeLanguageServerAvailability(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getLanguageServerAvailabilitySnapshot(): number {
  return version;
}

export function languageServerBinary(serverId: string): string | null {
  return availability.get(serverId)?.binary ?? null;
}

export function probeLanguageServers(options?: { force?: boolean }): Promise<void> {
  if (inflight) return inflight;
  if (!options?.force && probedAt > 0 && Date.now() - probedAt < PROBE_TTL_MS) {
    return Promise.resolve();
  }
  inflight = Promise.all(
    LANGUAGE_SERVERS.map(async (server) => {
      const found = await resolveLanguageServer(server.binaries);
      return [server.id, { binary: found?.name ?? null }] as const;
    }),
  )
    .then((entries) => {
      for (const [id, found] of entries) availability.set(id, found);
      version += 1;
      for (const listener of listeners) listener();
    })
    .finally(() => {
      probedAt = Date.now();
      inflight = null;
    });
  return inflight;
}
