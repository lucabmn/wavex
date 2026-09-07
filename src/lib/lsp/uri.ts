/**
 * The `file://` boundary.
 *
 * Everything above the Tauri boundary speaks wavex paths — forward slashes,
 * `C:/Users/me/app` on Windows. The language server protocol speaks URIs. The
 * conversion happens here and nowhere else, so a path never reaches a server
 * half-encoded and a server URI never reaches a tab as anything but a path.
 */

import { slash } from "../paths";

const FILE_SCHEME = "file://";

/** URI for an absolute path. Relative paths have no URI and return `null`. */
export function pathToUri(path: string): string | null {
  const normalized = slash(path).replace(/\/+$/, "") || slash(path);
  if (!normalized) return null;

  // UNC share: `//server/share/file` is an authority plus a path.
  if (normalized.startsWith("//")) {
    const rest = normalized.slice(2);
    const separator = rest.indexOf("/");
    if (separator <= 0) return null;
    const authority = encodeURIComponent(rest.slice(0, separator));
    return `${FILE_SCHEME}${authority}${encodePath(rest.slice(separator))}`;
  }

  const drive = /^([A-Za-z]):(?:\/|$)/.exec(normalized);
  if (drive) {
    // Servers and editors agree on a lower-case drive letter in a URI, and a
    // server that echoes the URI back has to match the one we sent.
    const withDrive = `/${drive[1].toLowerCase()}:${normalized.slice(2)}`;
    return `${FILE_SCHEME}${encodePath(withDrive)}`;
  }

  if (!normalized.startsWith("/")) return null;
  return `${FILE_SCHEME}${encodePath(normalized)}`;
}

/** Path for a `file://` URI. Any other scheme has no path and returns `null`. */
export function uriToPath(uri: string): string | null {
  if (!uri.toLowerCase().startsWith(FILE_SCHEME)) return null;

  let rest = uri.slice(FILE_SCHEME.length);
  // A fragment or query is not part of the file name. rust-analyzer appends
  // neither, but a URI that round-trips through a server may carry one.
  const marker = rest.search(/[?#]/);
  if (marker !== -1) rest = rest.slice(0, marker);

  const separator = rest.indexOf("/");
  const authority = separator === -1 ? rest : rest.slice(0, separator);
  const path = decodePath(separator === -1 ? "" : rest.slice(separator));

  if (authority) return `//${safeDecode(authority)}${path}`;
  if (!path) return null;

  const drive = /^\/([A-Za-z]):(?:\/|$)/.exec(path);
  // `/c:/Users/me` is a URI path, not a wavex path. Windows writes the drive
  // letter upper-case, and `pathKey` makes the comparison case-insensitive.
  return drive ? `${drive[1].toUpperCase()}:${path.slice(3)}` : path;
}

/**
 * Percent-encode each segment, then put `:` back.
 *
 * `encodeURIComponent` escapes the colon of a Windows drive letter, which no
 * language server expects to see encoded.
 */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ":"))
    .join("/");
}

function decodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => safeDecode(segment))
    .join("/");
}

/** A malformed escape is not worth losing the whole path over. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
