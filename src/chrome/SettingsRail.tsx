import {
  Archive,
  ArrowLeft,
  Bot,
  Connection,
  Code,
  Cube,
  Keyboard,
  Palette,
  SlidersHorizontal,
  Users,
  type IconComponent,
} from "./icons";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { SETTINGS_GROUPS, settingsSectionsInGroup, type SettingsSectionId } from "../lib/settings";

const SECTION_ICONS: Record<SettingsSectionId, IconComponent> = {
  general: SlidersHorizontal,
  profiles: Users,
  appearance: Palette,
  keybindings: Keyboard,
  providers: Bot,
  connections: Connection,
  skills: Cube,
  "language-servers": Code,
  archive: Archive,
};

type Props = {
  section: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
  onClose: () => void;
};

/** Body of the project rail while settings are open. */
export function SettingsNav({ section, onSelect, onClose }: Props) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();

  return (
    <>
      <div
        ref={lockOverscroll}
        aria-label="Settings"
        className="ui-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-none px-2 pb-2"
      >
        {SETTINGS_GROUPS.map((group) => {
          const sections = settingsSectionsInGroup(group.id);
          if (sections.length === 0) return null;
          return (
            <div key={group.id} className="flex flex-col gap-px pt-3 first:pt-0">
              <h2 className="ui-label px-2 pb-1 pt-1.5">{group.label}</h2>
              {sections.map((item) => (
                <NavRow
                  key={item.id}
                  label={item.label}
                  icon={SECTION_ICONS[item.id]}
                  active={item.id === section}
                  onClick={() => onSelect(item.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 flex-col gap-px p-2">
        <NavRow label="Back" icon={ArrowLeft} onClick={onClose} />
      </div>
    </>
  );
}

function NavRow({
  label,
  icon: Icon,
  active = false,
  onClick,
}: {
  label: string;
  icon: IconComponent;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      data-selected={active ? "true" : undefined}
      className="ui-row ui-focus flex h-8 w-full items-center gap-2 rounded-md px-2 text-left"
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-[13.5px] leading-tight">{label}</span>
    </button>
  );
}
