/**
 * Which machine an identity belongs to.
 *
 * A path is only unique on the machine that owns it: `/home/me/app` on a
 * laptop and `/home/me/app` on a dev box are two different checkouts, and a
 * session id minted by one host says nothing about the other. Once a client
 * can talk to more than one host, every project, session, and stored key has
 * to carry the host it came from or the two collapse into one.
 *
 * This device keeps the unqualified form — the bare path, the bare session id,
 * the unprefixed storage key — exactly as the default profile keeps the
 * unprefixed keys in `profileStorage`. An install that has never connected to
 * a remote host therefore needs no migration.
 */
import { normalizeProjectPath, pathKey } from "./paths";

export type HostId = string;

/** The machine wavex itself is installed on. */
export const LOCAL_HOST_ID: HostId = "local";

const REF_SCHEME = "wavex-host://";
/** Safe inside a storage key, a ref, and a websocket subprotocol. */
const HOST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A project is a path on one specific host, never a path on its own. */
export type ProjectRef = {
  hostId: HostId;
  path: string;
};

export function isLocalHostId(hostId: HostId): boolean {
  return hostId === LOCAL_HOST_ID;
}

export function isRemoteHostId(hostId: HostId): boolean {
  return isHostId(hostId) && !isLocalHostId(hostId);
}

export function isHostId(value: unknown): value is HostId {
  return typeof value === "string" && HOST_ID_PATTERN.test(value);
}

/**
 * Read an identity that came from storage, a URL, or a host reply. Anything
 * unusable resolves to this device rather than to a half-parsed remote name.
 */
export function normalizeHostId(value: unknown): HostId {
  if (typeof value !== "string") return LOCAL_HOST_ID;
  const trimmed = value.trim();
  return isHostId(trimmed) ? trimmed : LOCAL_HOST_ID;
}

export function projectRef(hostId: HostId, path: string): ProjectRef {
  return { hostId: normalizeHostId(hostId), path: normalizeProjectPath(path) };
}

export function localProject(path: string): ProjectRef {
  return projectRef(LOCAL_HOST_ID, path);
}

/**
 * Comparison key, not a display value. Local projects keep the plain
 * `pathKey`, so a rail entry, a tab, and a pin written before wavex Link still
 * match; a remote project is namespaced by its host.
 */
export function projectRefKey(ref: ProjectRef): string {
  const key = pathKey(ref.path);
  return isLocalHostId(ref.hostId) ? key : `${ref.hostId}\u0000${key}`;
}

export function sameProjectRef(a: ProjectRef, b: ProjectRef): boolean {
  return projectRefKey(a) === projectRefKey(b);
}

/** Persisted and inter-window form of a project reference. */
export function formatProjectRef(ref: ProjectRef): string {
  const path = normalizeProjectPath(ref.path);
  return isLocalHostId(ref.hostId) ? path : `${REF_SCHEME}${ref.hostId}/${path}`;
}

/**
 * Read a stored reference. A bare path is a project on this device, which is
 * every reference written before wavex Link. A malformed host reference
 * returns `null` instead of falling back to this device: silently resolving a
 * remote path locally would open the wrong checkout.
 */
export function parseProjectRef(value: string): ProjectRef | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith(REF_SCHEME)) return localProject(trimmed);

  const rest = trimmed.slice(REF_SCHEME.length);
  const separator = rest.indexOf("/");
  if (separator <= 0) return null;

  const hostId = rest.slice(0, separator);
  const path = rest.slice(separator + 1);
  if (!isHostId(hostId) || isLocalHostId(hostId) || !path.trim()) return null;
  return projectRef(hostId, path);
}

/**
 * Comparison key for a project reference that is still a plain string — what a
 * rail entry, a stored order slot, or the worktree index holds. A bare path is
 * a project on this device, so nothing an older install wrote changes key.
 */
export function projectKey(value: string): string {
  const ref = parseProjectRef(value);
  return ref ? projectRefKey(ref) : pathKey(value);
}

/**
 * Client-side browser state about one host's machine — recent projects, the
 * worktree index, rail order. The local host keeps the key it already uses.
 */
export function hostScopedStorageKey(key: string, hostId: HostId): string {
  return isLocalHostId(hostId) ? key : `${key}@${hostId}`;
}

/** Session ids are minted per host, so two hosts can hand out the same one. */
export function sessionRefKey(hostId: HostId, sessionId: string): string {
  return isLocalHostId(hostId) ? sessionId : `${hostId}\u0000${sessionId}`;
}
