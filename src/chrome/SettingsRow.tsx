/**
 * The row, heading, and switch every settings page is built from. They live
 * outside `SettingsView` so a page can be its own file without each one
 * inventing its own spacing.
 */
import type { ReactNode } from "react";
import { playCue } from "../lib/sounds";

export function Heading({ title, first = false }: { title: string; first?: boolean }) {
  return (
    <h2 className={`pb-1 text-[15px] font-semibold text-content ${first ? "" : "pt-8"}`}>
      {title}
    </h2>
  );
}

export function Row({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-6 border-b border-content/5 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-content">{label}</div>
        {description ? (
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

export function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      onClick={() => {
        playCue("switch");
        onChange(!on);
      }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
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
