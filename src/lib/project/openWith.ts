/**
 * The applications on this machine that can open the project folder.
 *
 * The host answers with what it found installed, so the menu never offers a
 * program that is not there. Detection and launching both live in
 * `src-tauri/src/open_with.rs`, and neither is reachable over a connection —
 * see `canOpenProjectIn` for why the control disappears instead.
 */
import { getDefaultHostId, invokeOn } from "../transport";
import type { HostId } from "../host";

export type OpenWithKind = "files" | "editor" | "terminal";

export type OpenWithApp = {
  id: string;
  name: string;
  kind: OpenWithKind;
  /** The application's own icon, or null where the platform hides it. */
  icon: string | null;
};

export type OpenWithGroup = {
  kind: OpenWithKind;
  label: string;
  apps: OpenWithApp[];
};

/** Reveal first, because it is the one entry every platform always has. */
const GROUP_ORDER: { kind: OpenWithKind; label: string }[] = [
  { kind: "files", label: "Files" },
  { kind: "editor", label: "Editors" },
  { kind: "terminal", label: "Terminals" },
];

export function listOpenWithApps(hostId: HostId = getDefaultHostId()): Promise<OpenWithApp[]> {
  return invokeOn<OpenWithApp[]>(hostId, "list_open_with_apps");
}

export function openPathWith(
  app: string,
  path: string,
  hostId: HostId = getDefaultHostId(),
): Promise<void> {
  return invokeOn<void>(hostId, "open_path_with", { app, path });
}

/**
 * Split the flat list into the sections the menu draws, keeping the host's
 * order inside each one and dropping a section nothing was found for.
 */
export function groupOpenWithApps(apps: OpenWithApp[]): OpenWithGroup[] {
  return GROUP_ORDER.map(({ kind, label }) => ({
    kind,
    label,
    apps: apps.filter((app) => app.kind === kind),
  })).filter((group) => group.apps.length > 0);
}

/**
 * Which application the button opens without asking.
 *
 * VS Code first because it is what most checkouts are opened in, then the
 * editors built on it, then whatever else is installed. The file manager is
 * the last resort rather than the first, since a machine with no editor on it
 * is the unusual one.
 */
const DEFAULT_PREFERENCE = [
  "vscode",
  "cursor",
  "windsurf",
  "vscodium",
  "vscode-insiders",
  "zed",
  "sublime",
];

export function defaultOpenWithApp(apps: OpenWithApp[]): OpenWithApp | null {
  for (const id of DEFAULT_PREFERENCE) {
    const preferred = apps.find((app) => app.id === id);
    if (preferred) return preferred;
  }
  return (
    apps.find((app) => app.kind === "editor") ?? apps.find((app) => app.kind === "files") ?? null
  );
}
