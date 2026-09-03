import { TAB_GROUP_COLORS } from "../workspace/tabGroups";
import { DEFAULT_PROFILE_ID, isProfileId } from "./profileStorage";

export { DEFAULT_PROFILE_ID };

/**
 * A profile is a separate identity inside one wavex install: its own projects,
 * chats, workspace, and preferences. It is not an account — wavex has none, and
 * provider CLIs keep their own credentials outside any profile.
 */
export type Profile = {
  id: string;
  name: string;
  /** Index into `PROFILE_COLORS`. */
  color: number;
  createdAt: number;
};

/** The same palette tab groups use, minus the neutral first entry. */
export const PROFILE_COLORS = TAB_GROUP_COLORS.slice(1);

export const PROFILE_NAME_MAX = 32;

export function profileColor(profile: Pick<Profile, "color">): string {
  return PROFILE_COLORS[profile.color % PROFILE_COLORS.length];
}

export function defaultProfile(): Profile {
  return { id: DEFAULT_PROFILE_ID, name: "Personal", color: 0, createdAt: 0 };
}

/** First letter of the name, for the switcher's avatar. */
export function profileInitial(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? "?";
}

export function normalizeProfileName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, PROFILE_NAME_MAX);
}

/**
 * The stored list, repaired. The default profile always exists and always comes
 * first, so a corrupt entry can never hide the workspace behind it.
 */
export function normalizeProfiles(raw: unknown): Profile[] {
  const out: Profile[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const record = item as Partial<Profile>;
      if (!isProfileId(record.id) || seen.has(record.id)) continue;
      const name = normalizeProfileName(typeof record.name === "string" ? record.name : "");
      if (!name) continue;
      seen.add(record.id);
      out.push({
        id: record.id,
        name,
        color:
          typeof record.color === "number" && Number.isFinite(record.color)
            ? Math.abs(Math.trunc(record.color)) % PROFILE_COLORS.length
            : 0,
        createdAt:
          typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
            ? record.createdAt
            : 0,
      });
    }
  }
  const fallback = defaultProfile();
  const existing = out.find((profile) => profile.id === DEFAULT_PROFILE_ID);
  const rest = out.filter((profile) => profile.id !== DEFAULT_PROFILE_ID);
  return [existing ?? fallback, ...rest];
}

export function findProfile(profiles: Profile[], id: string): Profile | undefined {
  return profiles.find((profile) => profile.id === id);
}

/** The profile to show for `id`, falling back to the default when it is gone. */
export function resolveProfile(profiles: Profile[], id: string): Profile {
  return findProfile(profiles, id) ?? profiles[0] ?? defaultProfile();
}

/** The least-used color, so a new profile looks different from its neighbours. */
export function nextProfileColor(profiles: Profile[]): number {
  const counts = PROFILE_COLORS.map(() => 0);
  for (const profile of profiles) counts[profile.color % counts.length] += 1;
  let best = 0;
  for (let index = 1; index < counts.length; index++) {
    if (counts[index] < counts[best]) best = index;
  }
  return best;
}

export function newProfileId(profiles: Profile[], now: number = Date.now()): string {
  const taken = new Set(profiles.map((profile) => profile.id));
  const base = now.toString(36);
  let id = `p${base}`;
  let suffix = 0;
  while (taken.has(id)) {
    suffix += 1;
    id = `p${base}-${suffix}`;
  }
  return id;
}

/**
 * A name no other profile is using, so the switcher stays readable. The counter
 * displaces the tail of a name already at the length cap rather than being
 * truncated away, which would never resolve the clash.
 */
export function uniqueProfileName(profiles: Profile[], name: string): string {
  const wanted = normalizeProfileName(name) || "Profile";
  const taken = new Set(profiles.map((profile) => profile.name.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  for (let index = 2; ; index++) {
    const suffix = ` ${index}`;
    const candidate = `${wanted.slice(0, PROFILE_NAME_MAX - suffix.length).trim()}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function addProfile(
  profiles: Profile[],
  name: string,
  options: { color?: number; now?: number } = {},
): Profile[] {
  const now = options.now ?? Date.now();
  return [
    ...profiles,
    {
      id: newProfileId(profiles, now),
      name: uniqueProfileName(profiles, name),
      color: options.color ?? nextProfileColor(profiles),
      createdAt: now,
    },
  ];
}

export function renameProfile(profiles: Profile[], id: string, name: string): Profile[] {
  const clean = normalizeProfileName(name);
  if (!clean) return profiles;
  const others = profiles.filter((profile) => profile.id !== id);
  return profiles.map((profile) =>
    profile.id === id ? { ...profile, name: uniqueProfileName(others, clean) } : profile,
  );
}

export function recolorProfile(profiles: Profile[], id: string, color: number): Profile[] {
  return profiles.map((profile) =>
    profile.id === id
      ? { ...profile, color: Math.abs(Math.trunc(color)) % PROFILE_COLORS.length }
      : profile,
  );
}

/** The default profile is the install itself, so it is renamable but not removable. */
export function canDeleteProfile(id: string): boolean {
  return id !== DEFAULT_PROFILE_ID;
}

export function removeProfile(profiles: Profile[], id: string): Profile[] {
  if (!canDeleteProfile(id)) return profiles;
  return profiles.filter((profile) => profile.id !== id);
}
