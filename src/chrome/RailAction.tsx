import type { IconComponent } from "./icons";

type Props = {
  label: string;
  icon: IconComponent;
  onClick?: () => void;
  active?: boolean;
  badge?: number;
  dot?: boolean;
  shortcut?: string;
  ariaLabel?: string;
};

export function RailAction({
  label,
  icon: Icon,
  onClick,
  active = false,
  badge,
  dot = false,
  shortcut,
  ariaLabel,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={ariaLabel ?? label}
      data-selected={active ? "true" : undefined}
      className="ui-row ui-focus relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-left disabled:cursor-default disabled:opacity-40"
    >
      {badge != null ? (
        <span
          aria-hidden
          className="ui-fill absolute left-1 top-1/2 grid min-w-4 -translate-y-1/2 place-items-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
      <Icon className={`size-3.5 shrink-0 ${badge != null ? "ml-4" : ""}`} strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-[13.5px] leading-tight">{label}</span>
      {dot ? (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
      ) : shortcut ? (
        <span aria-hidden className="shrink-0 font-mono text-[10.5px] opacity-60">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}

export function RailSearch({
  label,
  icon: Icon,
  onClick,
  active = false,
  shortcut,
  ariaLabel,
}: {
  label: string;
  icon: IconComponent;
  onClick?: () => void;
  active?: boolean;
  shortcut?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={ariaLabel ?? label}
      data-selected={active ? "true" : undefined}
      className="ui-row ui-focus relative flex h-7 w-full items-center gap-2 rounded-md px-2 text-left disabled:cursor-default disabled:opacity-40"
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-[13.5px] leading-tight">{label}</span>
      {shortcut ? (
        <span aria-hidden className="shrink-0 font-mono text-[10.5px] opacity-60">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}
