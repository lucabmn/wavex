import { profileColor, profileInitial, type Profile } from "../lib/profiles/profile";

const SIZE = {
  sm: "size-5 text-[10px] rounded-[6px]",
  md: "size-7 text-[13px] rounded-lg",
} as const;

/** The colored initial that stands for a profile everywhere in the chrome. */
export function ProfileAvatar({
  profile,
  size = "sm",
}: {
  profile: Profile;
  size?: keyof typeof SIZE;
}) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center font-semibold text-white ${SIZE[size]}`}
      style={{ backgroundColor: profileColor(profile) }}
    >
      {profileInitial(profile.name)}
    </span>
  );
}
