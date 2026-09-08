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
      className="flex shrink-0 items-center gap-0.5 rounded-md border border-edge bg-surface-sunken p-0.5"
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
            data-selected={option.value === value ? "true" : undefined}
            className={`ui-segment ui-focus flex items-center justify-center rounded text-[11px] font-medium leading-none text-content/55 ${
              Icon ? "size-[22px]" : "px-2.5 py-[4px]"
            }`}
          >
            {Icon ? <Icon className="size-3.5" strokeWidth={1.75} aria-hidden /> : option.label}
          </button>
        );
      })}
    </div>
  );
}
