/**
 * wavex Link seen from a browser tab.
 *
 * A tab has no Rust behind it, so it cannot hold a host token the way the
 * desktop client does. Instead it spends the connection code once, against the
 * host that served the page, and the host answers with an `HttpOnly` cookie:
 * a grant this page's own scripts cannot read back, cannot copy into storage,
 * and cannot leak through an injected script. The cookie lives in the host's
 * memory only — replacing the token or stopping the host ends it.
 *
 * The client is served by the host it talks to, so the address is never typed:
 * it is wherever this document came from.
 */
import { openHostConnection } from "./connect";
import { normalizeHostId, isRemoteHostId, type HostId } from "./host";
import { setDefaultHost, type HostPlatform } from "./transport";

export type BrowserHost = {
  hostId: HostId;
  name: string;
  platform: HostPlatform;
};

/** The host that served this page, in the form the transport expects. */
export function hostEndpoint(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/v1/connect`;
}

function readHost(value: unknown): BrowserHost {
  const body = (value ?? {}) as Record<string, unknown>;
  const hostId = normalizeHostId(body.hostId);
  if (!isRemoteHostId(hostId)) {
    throw new Error("This host did not identify itself");
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "This host";
  const platform = body.platform;
  return {
    hostId,
    name,
    platform:
      platform === "macos" || platform === "windows" || platform === "linux" ? platform : "unknown",
  };
}

async function sessionRequest(init: RequestInit): Promise<Response> {
  return fetch("/api/v1/session", { ...init, credentials: "same-origin" });
}

/** The host this browser is already paired with, or null if it is not. */
export async function currentBrowserHost(): Promise<BrowserHost | null> {
  try {
    const response = await sessionRequest({ method: "GET" });
    if (!response.ok) return null;
    return readHost(await response.json());
  } catch {
    return null;
  }
}

/** Spends a connection code for this browser's session. */
export async function pairBrowser(code: string): Promise<BrowserHost> {
  const trimmed = code.trim();
  if (!trimmed) throw new Error("Paste the connection code from the host");
  const response = await sessionRequest({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: trimmed }),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `The host refused this code (HTTP ${response.status})`);
  }
  return readHost(await response.json());
}

/** Gives the session back, so the next visit to this address pairs again. */
export async function unpairBrowser(): Promise<void> {
  await sessionRequest({ method: "DELETE" }).catch(() => undefined);
}

/**
 * Connects and makes this host the tab's default.
 *
 * `setDefaultHost` exists for exactly this: on the desktop every project
 * carries the machine it lives on, but a browser client has only one machine
 * it could possibly mean, and a bare path in a tab is a path on the host that
 * served it.
 */
export async function attachBrowserHost(host: BrowserHost): Promise<void> {
  await openHostConnection(host.hostId, {
    endpoint: hostEndpoint(),
    auth: { kind: "cookie" },
    name: host.name,
  });
  setDefaultHost(host.hostId);
}
