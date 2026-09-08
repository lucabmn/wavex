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
      data-halo={active ? "on" : undefined}
      className={`halo-row halo-focus relative flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors ${
        active ? "text-content" : "text-content/50 hover:bg-content/6 hover:text-content"
      } disabled:cursor-default disabled:opacity-40`}
    >
      {badge != null ? (
        <span
          aria-hidden
          className="halo-fill absolute left-1 top-1/2 grid min-w-4 -translate-y-1/2 place-items-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
      <Icon
        className={`size-4 shrink-0 ${active ? "opacity-100" : "opacity-65"} ${badge != null ? "ml-4" : ""}`}
        strokeWidth={1.75}
      />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight">{label}</span>
      {dot ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]"
        />
      ) : shortcut ? (
        <span aria-hidden className="shrink-0 font-mono text-[10.5px] text-content/35">
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
      className={`halo-focus relative flex h-8 w-full items-center gap-2 rounded-lg border border-edge px-2 text-left transition-colors ${
        active
          ? "bg-surface-raised text-content shadow-lift"
          : "bg-content/4 text-content/50 hover:bg-content/8 hover:text-content"
      } disabled:cursor-default disabled:opacity-40`}
    >
      <Icon className="size-4 shrink-0 opacity-65" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight">{label}</span>
      {shortcut ? (
        <span aria-hidden className="shrink-0 font-mono text-[10.5px] text-content/35">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}
