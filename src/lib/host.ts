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
import { HOST_REF_SCHEME, normalizeProjectPath, pathKey, stripHostRef } from "./paths";

export type HostId = string;

/** The machine wavex itself is installed on. */
export const LOCAL_HOST_ID: HostId = "local";

const REF_SCHEME = HOST_REF_SCHEME;
/** Safe inside a storage key, a ref, and a websocket subprotocol. */
const HOST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A project is a path on one specific host, never a path on its own. */
export type ProjectRef = {
  hostId: HostId;
  path: string;
};

/**
 * The machine this client means when a name carries no host.
 *
 * The desktop is installed on a machine, so an unqualified path is that
 * machine's and this stays `local` — which is why an install that has never
 * connected to a remote host needs no migration. A browser tab has no machine
 * of its own: everything it can name lives on the host that served it, so the
 * page sets this once during bootstrap and every bare path, session id, and
 * stored key follows.
 */
let unqualifiedHostId: HostId = LOCAL_HOST_ID;

export function unqualifiedHost(): HostId {
  return unqualifiedHostId;
}

export function setUnqualifiedHost(hostId: HostId): void {
  unqualifiedHostId = normalizeHostId(hostId);
}

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
 * rail entry, a stored order slot, or the worktree index holds.
 *
 * A bare path is a project on whichever machine this client leaves unqualified,
 * so on the desktop nothing an older install wrote changes key. In a browser
 * that machine is the host, and resolving here is what keeps one project from
 * appearing twice in the rail: the recents list stores it bare and the rail
 * order stores it as a reference, and both name the same checkout.
 */
export function projectKey(value: string): string {
  const ref = parseProjectRef(value);
  if (!ref) return pathKey(value);
  // A bare path parses as a local project, which is the same substitution
  // `hostPathArgs` makes: local means "not said", and what "not said" resolves
  // to is this client's business.
  return projectRefKey(
    isLocalHostId(ref.hostId) ? { hostId: unqualifiedHostId, path: ref.path } : ref,
  );
}

/**
 * Resolve a project root argument into the host to call and the path to send.
 *
 * A project root reaches a wrapper as the string the rail, a tab, or a session
 * holds, which for a remote project is a `wavex-host://` reference. The host
 * behind that reference has to reach the call, so the resolution order is:
 * an explicitly passed host wins, then the host named in the reference, then
 * this device. The wire always carries the bare path — a host stores and
 * compares paths on itself, and has never heard of the reference scheme.
 *
 * Only a project root travels in this form. A child path — a file, a folder
 * inside the checkout, a worktree's own directory — travels bare next to the
 * host its caller already holds, so nothing coming back from a host needs to
 * be rewritten before it is used again.
 */
export function hostPathArgs(
  value: string,
  hostId: HostId | undefined,
  fallback: HostId,
): { hostId: HostId; path: string } {
  const ref = parseProjectRef(value);
  if (!ref) return { hostId: hostId ?? fallback, path: value };
  if (hostId) return { hostId, path: ref.path };
  return { hostId: isLocalHostId(ref.hostId) ? fallback : ref.hostId, path: ref.path };
}

/**
 * Comparison key for a path on one specific host. A client can hold two hosts
 * with the same checkout path, so a module-global cache keyed on the bare path
 * would serve one host's directory listing to the other.
 */
export function hostPathKey(hostId: HostId, path: string): string {
  // A project root reaches this as a reference and the paths under it as bare
  // host paths. Stripping the scheme puts both in one namespace, so forgetting
  // a root still forgets everything cached beneath it.
  return projectRefKey({ hostId: normalizeHostId(hostId), path: stripHostRef(path) });
}

/** Session ids are minted per host, so two hosts can hand out the same one. */
export function sessionRefKey(hostId: HostId, sessionId: string): string {
  return isLocalHostId(hostId) ? sessionId : `${hostId}\u0000${sessionId}`;
}
