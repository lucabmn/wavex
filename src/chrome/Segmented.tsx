import type { IconComponent } from "./icons";

export type SegmentedOption<T> = {
  value: T;
  /** Rendered as text when there is no icon, and as the accessible name otherwise. */
  label: string;
  icon?: IconComponent;
};

/**
 * The small inline switch a surface header uses for a handful of exclusive
 * choices — metric, period, view. One control so Usage and Activity read as
 * the same application rather than two headers that grew apart.
 */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onSelect: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 items-center gap-px rounded-md bg-content/[0.07] p-px"
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={option.value === value}
            aria-label={Icon ? option.label : undefined}
            title={Icon ? option.label : undefined}
            onClick={() => onSelect(option.value)}
            className={`flex items-center justify-center rounded-[5px] text-[11px] leading-none ${
              Icon ? "size-[22px]" : "px-2 py-[3px]"
            } ${
              option.value === value
                ? "bg-[var(--color-background-base)] text-content shadow-sm"
                : "text-content/50 hover:text-content"
            }`}
          >
            {Icon ? <Icon className="size-3.5" strokeWidth={1.75} aria-hidden /> : option.label}
          </button>
        );
      })}
    </div>
  );
}
