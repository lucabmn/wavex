import { useRef, useState, type ReactNode } from "react";
import { Check, ChevronUp, Plus, Settings } from "./icons";
import { useProfiles } from "../hooks/useProfiles";
import { MOD, SHIFT } from "../lib/platform";
import { createProfile } from "../lib/profiles/profileStore";
import { Popover } from "./Popover";
import { ProfileAvatar } from "./ProfileAvatar";
import { ProfileDialog } from "./ProfileDialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitch: (profileId: string) => void;
  onManage: () => void;
};

const MENU_WIDTH = 232;

/**
 * The profile the workspace belongs to, and the way to leave it. Sits at the
 * foot of the project rail so the active identity is on screen at all times.
 */
export function ProfileSwitcher({ open, onOpenChange, onSwitch, onManage }: Props) {
  const { profiles, active } = useProfiles();
  const [creating, setCreating] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const shortcut = `${MOD}${SHIFT}P`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${active.name} — switch profile (${shortcut})`}
        aria-label={`Profile ${active.name}, switch profile (${shortcut})`}
        onClick={() => onOpenChange(!open)}
        className={`flex w-full items-center gap-2 rounded-md px-2 h-8 text-left ${
          open
            ? "bg-content/10 text-content"
            : "text-content/50 hover:bg-content/10 hover:text-content"
        }`}
      >
        <ProfileAvatar profile={active} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
          {active.name}
        </span>
        <ChevronUp className="size-3.5 shrink-0 opacity-60" strokeWidth={1.75} />
      </button>

      {open ? (
        <Popover
          anchor={triggerRef}
          side="top"
          align="start"
          width={MENU_WIDTH}
          role="menu"
          aria-label="Profiles"
          onDismiss={() => onOpenChange(false)}
          className="p-2"
        >
          <div className="flex flex-col gap-px">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                role="menuitemradio"
                aria-checked={profile.id === active.id}
                onClick={() => {
                  onOpenChange(false);
                  if (profile.id !== active.id) onSwitch(profile.id);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-content/80 hover:bg-content/10 hover:text-content"
              >
                <ProfileAvatar profile={profile} />
                <span className="min-w-0 flex-1 truncate text-[13px]">{profile.name}</span>
                {profile.id === active.id ? (
                  <Check className="size-3.5 shrink-0 text-accent" strokeWidth={2} />
                ) : null}
              </button>
            ))}
          </div>

          <div className="my-1 h-px bg-content/10" />

          <div className="flex flex-col gap-px">
            <MenuAction
              label="New profile…"
              onClick={() => {
                onOpenChange(false);
                setCreating(true);
              }}
            >
              <Plus className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
            </MenuAction>
            <MenuAction
              label="Manage profiles…"
              onClick={() => {
                onOpenChange(false);
                onManage();
              }}
            >
              <Settings className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
            </MenuAction>
          </div>

          <p className="px-2 pb-1 pt-2 text-[11px] leading-snug text-content/40">
            Profiles separate wavex's own state. Agent CLIs keep their own sign-in, which every
            profile shares.
          </p>
        </Popover>
      ) : null}

      {creating ? (
        <ProfileDialog
          title="New profile"
          description="A separate workspace inside this copy of wavex."
          confirmLabel="Create and switch"
          onCancel={() => setCreating(false)}
          onConfirm={(name, color) => {
            setCreating(false);
            onSwitch(createProfile(name, color).id);
          }}
        />
      ) : null}
    </>
  );
}

function MenuAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-content/70 hover:bg-content/10 hover:text-content"
    >
      {children}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
