import { profileStorage } from "./profiles/profileStorage";

const ONBOARDED_KEY = "wavex.onboarded";

/**
 * Whether the first-run setup was completed or skipped. Profile-scoped like
 * everything else a profile owns, so each profile gets its own welcome.
 */
export function isOnboarded(): boolean {
  return profileStorage.getItem(ONBOARDED_KEY) === "1";
}

export function markOnboarded(): void {
  profileStorage.setItem(ONBOARDED_KEY, "1");
}
