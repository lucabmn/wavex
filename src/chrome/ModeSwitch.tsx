import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { MOD, SHIFT } from "../lib/platform";
import { APP_MODE_LABEL, otherAppMode, type AppMode } from "../lib/workspace/appMode";

const ORDER: AppMode[] = ["work", "coding"];

type Props = {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
};

/**
 * Top-level surface switch. A tablist rather than two buttons so arrow keys
 * move between the modes the way a keyboard user expects, and so the current
 * surface is announced.
 */
export function ModeSwitch({ mode, onChange }: Props) {
  const tabs = useRef(new Map<AppMode, HTMLButtonElement | null>());

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = otherAppMode(mode);
    onChange(next);
    tabs.current.get(next)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Surface"
      onKeyDown={onKeyDown}
      className="flex shrink-0 items-center gap-0.5 rounded-md border border-content/10 bg-content/5 p-0.5"
      data-tauri-drag-region="false"
    >
      {ORDER.map((value) => {
        const selected = value === mode;
        return (
          <button
            key={value}
            ref={(el) => {
              tabs.current.set(value, el);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            // Roving tabindex: one stop for the pair, arrows move within it.
            tabIndex={selected ? 0 : -1}
            title={`${APP_MODE_LABEL[value]} (${MOD}${SHIFT}M)`}
            className={`rounded px-2.5 py-0.5 text-[11.5px] font-medium transition-colors ${
              selected
                ? "bg-content/12 text-content"
                : "text-content/45 hover:bg-content/5 hover:text-content/80"
            }`}
            onClick={() => onChange(value)}
          >
            {APP_MODE_LABEL[value]}
          </button>
        );
      })}
    </div>
  );
}
