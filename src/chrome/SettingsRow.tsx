/**
 * The controls every settings page is built from. They live outside
 * `SettingsView` so a page can be its own file without each one inventing its
 * own spacing.
 *
 * A page is a stack of `Section`s; a section is a titled card of `Row`s. The
 * card is what keeps a long page readable — without it, twenty rules separated
 * by hairlines read as one undifferentiated list.
 */
import type { ReactNode } from "react";
import { playCue } from "../lib/sounds";

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="pb-5">
      <h1 className="text-[20px] font-semibold leading-tight text-content">{title}</h1>
      {description ? (
        <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-content/45">{description}</p>
      ) : null}
    </header>
  );
}

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  /** A control that belongs to the group rather than to one rule. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="pb-7 last:pb-2">
      <div className="flex items-end justify-between gap-4 pb-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.07em] text-content/50">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-content/40">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="overflow-hidden rounded-xl border border-content/10 bg-content/[0.025]">
        {children}
      </div>
    </section>
  );
}

/** A section whose body is not a list of rules — a table, a list, a note. */
export function SectionBody({ children }: { children: ReactNode }) {
  return <div className="px-4 py-3.5">{children}</div>;
}

export function Row({
  label,
  description,
  layout = "inline",
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** `stacked` puts a wide control — a swatch grid, a table — under the label. */
  layout?: "inline" | "stacked";
  children?: ReactNode;
}) {
  const text = (
    <div className="min-w-0 flex-1">
      <div className="text-[13px] font-medium text-content">{label}</div>
      {description ? (
        <p className="mt-1 text-[12px] leading-relaxed text-content/45">{description}</p>
      ) : null}
    </div>
  );

  if (layout === "stacked") {
    return (
      <div className="border-b border-content/8 px-4 py-3.5 last:border-b-0">
        {text}
        {children ? <div className="pt-3">{children}</div> : null}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-6 border-b border-content/8 px-4 py-3.5 last:border-b-0">
      {text}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

export function Toggle({
  label,
  on,
  disabled = false,
  onChange,
}: {
  label: string;
  on: boolean;
  /** For a switch whose thing is unavailable — an uninstalled server. */
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      disabled={disabled}
      onClick={() => {
        playCue("switch");
        onChange(!on);
      }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-35 ${
        on ? "bg-accent" : "bg-content/20"
      }`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-white transition-[left] ${
          on ? "left-4.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-0.5 rounded-md border border-content/10 p-0.5 text-[12px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(3.75rem, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-w-0 truncate rounded-[5px] px-1.5 py-1 ${
            value === option.value
              ? "bg-content/10 text-content"
              : "text-content/50 hover:text-content"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex w-56 items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
        className="sidebar-opacity-slider min-w-0 flex-1"
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="w-10 shrink-0 text-right text-[12px] text-content tabular-nums">
        {display}
      </span>
    </div>
  );
}

export function Select({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="max-w-52 rounded-md border border-content/10 bg-content/5 px-2 py-1 text-[12px] text-content outline-none hover:border-content/20 disabled:opacity-40"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function SecondaryButton({
  onClick,
  disabled = false,
  danger = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex shrink-0 items-center gap-1.5 rounded-md border border-content/10 px-2.5 py-1 text-[12px] ${
        danger
          ? "text-red-400 hover:border-red-400/40 hover:bg-red-400/10"
          : "text-content/70 hover:bg-content/10 hover:text-content"
      } disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent`}
    >
      {children}
    </button>
  );
}

/** An empty state inside a section card, where a list would otherwise be. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3.5 text-[12px] text-content/45">{children}</p>;
}
