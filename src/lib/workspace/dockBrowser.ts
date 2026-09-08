/**
 * What the dock's Browser surface is looking at.
 *
 * The page itself renders in a cross-origin frame, so its own location is
 * unreadable from here: a link the user follows inside the page moves the frame
 * without moving this history. These entries are therefore the addresses wavex
 * navigated to — what the address bar shows and what back and forward walk —
 * and not a mirror of the frame's own session history.
 */
export type DockBrowser = {
  /** Addresses wavex navigated to, oldest first. Always normalized. */
  entries: string[];
  /** Position in `entries`, or -1 when nothing has been visited. */
  index: number;
};

export const EMPTY_DOCK_BROWSER: DockBrowser = { entries: [], index: -1 };

/** Enough history to walk back through an afternoon, and no more. */
const HISTORY_LIMIT = 100;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1", "[::]"]);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function portUrl(port: number): string | null {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `http://localhost:${port}/`;
}

/**
 * The address a typed string means, or null when a frame could not load it.
 *
 * Only `http:` and `https:` survive: `file:`, `data:`, and `javascript:` are
 * refused rather than normalized, because the frame runs them next to the app.
 * A loopback name or an explicit port means a development server, which is
 * served over plain HTTP far more often than not, so those default to `http:`
 * and everything else defaults to `https:`.
 */
export function normalizeBrowserUrl(input: string): string | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;

  if (/^https?:\/\//i.test(text)) return parse(text)?.href ?? null;
  // Any other scheme, with or without an authority, is not ours to load. A
  // bare `host:port` looks like a scheme too, so digits after the colon are
  // read as a port instead.
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/.exec(text);
  if (scheme && !/^\d+$/.test(scheme[2])) return null;

  const bare = /^:?(\d+)$/.exec(text);
  if (bare) return portUrl(Number(bare[1]));

  const https = parse(`https://${text}`);
  if (!https) return null;
  const loopback = LOOPBACK_HOSTS.has(https.hostname.toLowerCase());
  const ported = https.port !== "" || /^\[?[^/?#]*\]?:\d+/.test(text);
  // A single-label host that is neither loopback nor carrying a port is far
  // more likely a typo than a site, and guessing would navigate away from it.
  if (!loopback && !ported && !https.hostname.includes(".")) return null;
  if (!loopback && !ported) return https.href;
  return parse(`http://${text}`)?.href ?? null;
}

export function dockBrowserUrl(browser: DockBrowser): string | null {
  return browser.entries[browser.index] ?? null;
}

export function canGoBack(browser: DockBrowser): boolean {
  return browser.index > 0;
}

export function canGoForward(browser: DockBrowser): boolean {
  return browser.index >= 0 && browser.index < browser.entries.length - 1;
}

/** Navigate, dropping whatever forward trail the user had walked back past. */
export function browserVisit(browser: DockBrowser, input: string): DockBrowser {
  const url = normalizeBrowserUrl(input);
  if (!url) return browser;
  if (url === dockBrowserUrl(browser)) return browser;
  const entries = [...browser.entries.slice(0, browser.index + 1), url];
  const dropped = Math.max(0, entries.length - HISTORY_LIMIT);
  return { entries: entries.slice(dropped), index: entries.length - dropped - 1 };
}

export function browserBack(browser: DockBrowser): DockBrowser {
  return canGoBack(browser) ? { ...browser, index: browser.index - 1 } : browser;
}

export function browserForward(browser: DockBrowser): DockBrowser {
  return canGoForward(browser) ? { ...browser, index: browser.index + 1 } : browser;
}

export function sanitizeDockBrowser(raw: unknown): DockBrowser {
  if (!raw || typeof raw !== "object") return EMPTY_DOCK_BROWSER;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.entries)) return EMPTY_DOCK_BROWSER;
  const entries: string[] = [];
  for (const entry of value.entries) {
    const url = typeof entry === "string" ? normalizeBrowserUrl(entry) : null;
    if (url) entries.push(url);
  }
  if (entries.length === 0) return EMPTY_DOCK_BROWSER;
  const capped = entries.slice(Math.max(0, entries.length - HISTORY_LIMIT));
  const rawIndex = Number(value.index);
  const index = Number.isInteger(rawIndex)
    ? Math.min(Math.max(rawIndex, 0), capped.length - 1)
    : capped.length - 1;
  return { entries: capped, index };
}
