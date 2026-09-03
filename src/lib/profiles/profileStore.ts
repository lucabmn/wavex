import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  addProfile,
  normalizeProfiles,
  recolorProfile,
  removeProfile,
  renameProfile,
  resolveProfile,
  type Profile,
} from "./profile";
import {
  activeProfileId,
  clearProfileStorage,
  readProfilesJson,
  setActiveProfileId,
  writeProfilesJson,
} from "./profileStorage";

/** Fired on `window` when a profile is created, renamed, recolored, or deleted. */
export const PROFILES_CHANGED = "wavex:profiles-changed";

/** One window changed the registry; the others share the storage but not the parse. */
const REGISTRY_EVENT = "wavex://profiles-registry-changed";

/** Rust asks every window to put its workspace on disk before the stores swap. */
const PREPARE_EVENT = "wavex://profile-switch-prepare";
/** Rust has swapped. The workspace on screen belongs to the profile we left. */
const CHANGED_EVENT = "wavex://profile-changed";

let cachedJson: string | null = null;
let cacheValid = false;
let cachedProfiles: Profile[] = [];

/**
 * `useSyncExternalStore` compares by reference, so the parsed list is cached
 * against the raw string it came from.
 */
export function loadProfiles(): Profile[] {
  const json = readProfilesJson();
  if (cacheValid && json === cachedJson) return cachedProfiles;
  let parsed: unknown = null;
  try {
    parsed = json ? JSON.parse(json) : null;
  } catch {
    parsed = null;
  }
  cachedJson = json;
  cacheValid = true;
  cachedProfiles = normalizeProfiles(parsed);
  return cachedProfiles;
}

function saveProfiles(profiles: Profile[]): Profile[] {
  const normalized = normalizeProfiles(profiles);
  writeProfilesJson(JSON.stringify(normalized));
  cachedJson = readProfilesJson();
  cacheValid = true;
  cachedProfiles = normalized;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PROFILES_CHANGED));
  // Storage is shared between windows; the parsed copy in each of them is not.
  void emit(REGISTRY_EVENT).catch(() => undefined);
  return normalized;
}

/** Another window wrote the registry: drop the parsed copy and re-render. */
function announceProfiles() {
  cacheValid = false;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PROFILES_CHANGED));
}

/**
 * Keeps this window's profile list current when another window edits it. Runs
 * once, at boot.
 */
export async function watchProfiles(): Promise<UnlistenFn> {
  return listen(REGISTRY_EVENT, announceProfiles);
}

export function subscribeProfiles(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PROFILES_CHANGED, onChange);
  return () => window.removeEventListener(PROFILES_CHANGED, onChange);
}

export function activeProfile(): Profile {
  return resolveProfile(loadProfiles(), activeProfileId());
}

export function createProfile(name: string, color?: number): Profile {
  const saved = saveProfiles(addProfile(loadProfiles(), name, { color }));
  return saved[saved.length - 1];
}

/** Name and color move together, so an edit is one write and one re-render. */
export function updateProfile(id: string, edit: { name: string; color: number }): Profile[] {
  return saveProfiles(recolorProfile(renameProfile(loadProfiles(), id, edit.name), id, edit.color));
}

/**
 * Forgets a profile: its browser keys and its directory under the app data
 * folder. Repositories, worktrees, and anything else the user keeps on disk are
 * outside that folder and are never touched.
 */
export async function deleteProfile(id: string): Promise<Profile[]> {
  if (id === activeProfileId()) throw new Error("Switch to another profile before deleting it");
  await invoke("profile_delete_data", { profileId: id });
  clearProfileStorage(id);
  return saveProfiles(removeProfile(loadProfiles(), id));
}

/**
 * Reconciles the native stores with the profile this webview is about to
 * render. Runs before the workspace loads, and repairs the rare case where the
 * app was closed between choosing a profile and the swap landing.
 */
export async function bindActiveProfile(): Promise<void> {
  await invoke("profile_bind", { profileId: activeProfileId() }).catch(() => undefined);
}

/**
 * Starts a switch. Every window persists, agents of the profile being left are
 * stopped, the stores swap, and each window reloads onto the new profile.
 */
export async function switchProfile(id: string): Promise<void> {
  if (id === activeProfileId()) return;
  // The stored id moves only when the native stores do, on the change event.
  // Flipping it earlier would file the workspace still on screen under the
  // profile being switched to.
  await invoke("profile_switch", { profileId: id });
}

export async function listenProfileSwitch(handlers: {
  onPrepare: () => Promise<void> | void;
  onChanged: () => void;
}): Promise<UnlistenFn> {
  const unlisten = await Promise.all([
    listen(PREPARE_EVENT, () => {
      void Promise.resolve(handlers.onPrepare()).finally(() => {
        void invoke("profile_switch_ready").catch(() => undefined);
      });
    }),
    // The payload is the profile the native stores actually landed on, which is
    // the old one when the swap failed. Storing it keeps the browser keys and
    // the databases on the same profile either way.
    listen<string>(CHANGED_EVENT, (event) => {
      setActiveProfileId(event.payload);
      handlers.onChanged();
    }),
  ]);
  return () => {
    for (const off of unlisten) off();
  };
}
