/**
 * One slash direction everywhere above the Tauri boundary. Rust normalizes what
 * it hands us, but paths also arrive from the OS file dialog and from agent
 * output, and every helper here splits on `/`.
 */
export function slash(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Comparison key, not a display value. Windows paths are case-insensitive, so
 * `C:/Users/me/app` and `c:/users/me/app` are one project and must not become
 * two rail entries, two tabs, or a pin that never matches.
 */
export function pathKey(path: string): string {
  const normalized = normalizeProjectPath(path);
  return /^[A-Za-z]:(?:\/|$)/.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

/** Display path with home collapsed to `~`. */
export function prettyCwd(cwd: string): string {
  const trimmed = normalizeProjectPath(cwd);
  if (trimmed === "~") return "~";

  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length >= 2 && (parts[0] === "Users" || parts[0] === "home")) {
    const rest = parts.slice(2).join("/");
    return rest ? `~/${rest}` : "~";
  }
  // `C:/Users/me/...`
  if (parts.length >= 3 && /^[A-Za-z]:$/.test(parts[0]) && parts[1] === "Users") {
    const rest = parts.slice(3).join("/");
    return rest ? `~/${rest}` : "~";
  }
  return trimmed;
}

/**
 * Project path without a trailing slash. The rail, the session store and the
 * worktree index all key projects on this, so it has to agree everywhere.
 */
export function normalizeProjectPath(path: string): string {
  return slash(path).replace(/\/+$/, "") || "/";
}

export function parentPath(path: string): string {
  const trimmed = normalizeProjectPath(path);
  // A drive root is its own parent; `C:` alone is not a path.
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}/`;
  const i = trimmed.lastIndexOf("/");
  if (i <= 0) return "/";
  const parent = trimmed.slice(0, i);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
}

export function rebasePath(path: string, from: string, to: string): string {
  const normalized = normalizeProjectPath(path);
  const source = normalizeProjectPath(from);
  const key = pathKey(normalized);
  const sourceKey = pathKey(source);
  if (key === sourceKey) return normalizeProjectPath(to);
  if (key.startsWith(`${sourceKey}/`)) {
    return `${normalizeProjectPath(to)}${normalized.slice(source.length)}`;
  }
  return slash(path);
}

export function isEqualOrInside(path: string, root: string): boolean {
  const key = pathKey(path);
  const baseKey = pathKey(root);
  return key === baseKey || key.startsWith(`${baseKey}/`);
}

export function joinPath(parent: string, relative: string): string {
  const base = normalizeProjectPath(parent);
  const parts = relative.split(/[/\\]/).filter((part) => part && part !== ".");
  let out = base;
  for (const part of parts) {
    if (part === "..") {
      out = parentPath(out);
      continue;
    }
    out = out === "/" ? `/${part}` : `${out}/${part}`;
  }
  return out;
}

/** Absolute path for a workspace file href, or `undefined` if it is not a local file. */
export function resolveWorkspacePath(href: string, cwd?: string): string | undefined {
  let value = href.trim();
  if (!value || /^(https?:|mailto:|tel:)/i.test(value)) return undefined;

  if (value.startsWith("file://")) {
    try {
      value = decodeURIComponent(value.slice("file://".length));
    } catch {
      value = value.slice("file://".length);
    }
  }

  value = slash(value).replace(/(?::\d+(?::\d+)?|#L\d+(?:-L\d+)?)$/, "");
  if (
    !value ||
    value === "." ||
    value.startsWith("#") ||
    value.startsWith("?") ||
    value.includes("://")
  ) {
    return undefined;
  }
  if (!looksLikeFilePath(value)) return undefined;

  if (/^[A-Za-z]:\//.test(value)) return value;
  if (value.startsWith("/")) {
    return /^\/[A-Za-z]:\//.test(value) ? value.slice(1) : value;
  }
  if (!cwd || cwd === "~") return undefined;
  return joinPath(cwd, value);
}

function looksLikeFilePath(value: string): boolean {
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) return true;
  if (value.includes("/")) return true;
  return /\.[A-Za-z][A-Za-z0-9+]{0,11}$/.test(value);
}

export function prettyParent(path: string): string {
  return prettyCwd(parentPath(path));
}

/** Path relative to cwd when it lives under the project, otherwise unchanged. */
export function displayPath(path: string, cwd?: string): string {
  const normalized = normalizeProjectPath(path);
  const base = cwd ? normalizeProjectPath(cwd) : undefined;
  if (base && base !== "~") {
    const key = pathKey(normalized);
    const baseKey = pathKey(base);
    if (key === baseKey) {
      return normalized.split("/").filter(Boolean).pop() || normalized;
    }
    if (key.startsWith(`${baseKey}/`)) {
      return normalized.slice(base.length + 1);
    }
  }
  return normalized;
}

/** Folder name for tab labels — `~` when the cwd is home. */
export function projectName(cwd: string): string {
  if (!cwd || prettyCwd(cwd) === "~") return "~";
  const trimmed = normalizeProjectPath(cwd);
  if (/^[A-Za-z]:$/.test(trimmed)) return trimmed;
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}
