import { useSyncExternalStore } from "react";
import { resolveProfile, type Profile } from "../lib/profiles/profile";
import { activeProfileId } from "../lib/profiles/profileStorage";
import { loadProfiles, subscribeProfiles } from "../lib/profiles/profileStore";

/**
 * The profile list and the one in use. The active id only changes across a
 * reload, so it is read directly rather than subscribed to.
 */
export function useProfiles(): { profiles: Profile[]; active: Profile } {
  const profiles = useSyncExternalStore(subscribeProfiles, loadProfiles);
  return { profiles, active: resolveProfile(profiles, activeProfileId()) };
}
