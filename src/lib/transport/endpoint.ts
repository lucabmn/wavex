export function normalizeRemoteEndpoint(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("Enter a host address");

  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `ws://${value}`);
  } catch {
    throw new Error("Enter a valid host address");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The host address cannot contain credentials, a query, or a fragment");
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Use a ws:// or wss:// host address");
  }

  const loopback =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol === "ws:" && !loopback) {
    throw new Error("Remote hosts require an encrypted wss:// connection or a local tunnel");
  }

  url.pathname = url.pathname === "/" ? "/api/v1/connect" : url.pathname.replace(/\/$/, "");
  return url.toString();
}

export function ticketEndpoint(websocketEndpoint: string): string {
  const url = new URL(websocketEndpoint);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/api/v1/tickets";
  return url.toString();
}
