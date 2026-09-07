/**
 * The local end of the replay protocol. A host retains what it published so a
 * client that was away can ask for everything after the sequence it last saw —
 * the same question `RemoteHostTransport` asks a remote host over its socket,
 * asked here through Tauri IPC.
 *
 * Asking marks the journal as followed: until someone does, a host retains
 * nothing, because PTY bytes and harness lines are too hot to copy for a
 * reader that may never exist.
 */
export type HostEvent = {
  sequence: number;
  event: string;
  payload: unknown;
};

export type HostEventReplay = {
  /** Changes when the host restarts; a new id invalidates every cursor. */
  streamId: string;
  oldestSequence: number;
  latestSequence: number;
  /** The backlog no longer reaches the cursor, so state has to be reloaded. */
  resyncRequired: boolean;
  events: HostEvent[];
};
