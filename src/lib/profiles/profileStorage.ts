/**
 * Browser-side storage, scoped to the active profile.
 *
 * The registry itself is app-level: both keys below stay unprefixed so every
 * profile sees the same list. Everything else a profile owns — recents, tab
 * groups, filters, preferences — goes through `profileStorage`, which prefixes
 * the key with the active profile.
 *
 * The default profile keeps the raw keys. An install that predates profiles is
 * therefore already a complete default profile: nothing is copied, renamed, or
 * lost on the first launch of a build that has this feature.
 */

const PROFILES_KEY = "wavex.profiles";
const ACTIVE_KEY = "wavex.activeProfile";

export const DEFAULT_PROFILE_ID = "default";

/** Ids are folder names on the Rust side, so keep them to safe characters. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isProfileId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

export function readProfilesJson(): string | null {
  try {
    return localStorage.getItem(PROFILES_KEY);
  } catch {
    return null;
  }
}

export function writeProfilesJson(value: string) {
  try {
    localStorage.setItem(PROFILES_KEY, value);
  } catch {
    // private mode / quota
  }
}

export function activeProfileId(): string {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    return isProfileId(raw) ? raw : DEFAULT_PROFILE_ID;
  } catch {
    return DEFAULT_PROFILE_ID;
  }
}

export function setActiveProfileId(id: string) {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // private mode / quota
  }
}

export function profileKey(key: string, profileId: string = activeProfileId()): string {
  return profileId === DEFAULT_PROFILE_ID ? key : `@${profileId}:${key}`;
}

/** localStorage for the active profile. Same shape as the real thing. */
export const profileStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(profileKey(key));
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(profileKey(key), value);
    } catch {
      // private mode / quota
    }
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(profileKey(key));
    } catch {
      // private mode / quota
    }
  },
};

/**
 * Drops every browser key belonging to `profileId`. The default profile shares
 * its keys with an install that never made a second profile, so it is never
 * cleared here.
 */
export function clearProfileStorage(profileId: string) {
  if (profileId === DEFAULT_PROFILE_ID) return;
  const prefix = `@${profileId}:`;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // private mode / quota
  }
}
