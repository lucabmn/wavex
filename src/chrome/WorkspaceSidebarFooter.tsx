import type { InstalledUpdate } from "../lib/updates/updateNotice";
import { MOD } from "../lib/platform";
import { Settings } from "./icons";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { RailAction } from "./RailAction";
import { SidebarUpdateFooter } from "./SidebarUpdate";

type Props = {
  profileMenuOpen?: boolean;
  onProfileMenuOpenChange?: (open: boolean) => void;
  onSwitchProfile?: (profileId: string) => void;
  onManageProfiles?: () => void;
  update?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
  onOpenSettings?: () => void;
};

/** Shared footer for the Coding and Work sidebars. */
export function WorkspaceSidebarFooter({
  profileMenuOpen = false,
  onProfileMenuOpenChange,
  onSwitchProfile,
  onManageProfiles,
  update,
  onOpenWhatsNew,
  onDismissUpdate,
  onOpenSettings,
}: Props) {
  return (
    <>
      <SidebarUpdateFooter
        update={update}
        onOpenWhatsNew={onOpenWhatsNew}
        onDismissUpdate={onDismissUpdate}
      />
      <div className="flex shrink-0 flex-col gap-px p-2 pt-0">
        <ProfileSwitcher
          open={profileMenuOpen}
          onOpenChange={(open) => onProfileMenuOpenChange?.(open)}
          onSwitch={(profileId) => onSwitchProfile?.(profileId)}
          onManage={() => onManageProfiles?.()}
        />
        <RailAction
          label="Settings"
          icon={Settings}
          onClick={onOpenSettings}
          shortcut={`${MOD},`}
          ariaLabel={`Settings (${MOD},)`}
        />
      </div>
    </>
  );
}
