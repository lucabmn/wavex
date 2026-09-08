import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { MOD, SHIFT } from "../lib/platform";
import {
  APP_MODE_DESCRIPTION,
  APP_MODE_LABEL,
  otherAppMode,
  type AppMode,
} from "../lib/workspace/appMode";

const ORDER: AppMode[] = ["work", "coding"];

type Props = {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
  /** Fill the available width, for the rail. Default is a compact chip. */
  stretch?: boolean;
};

/**
 * Top-level surface switch. A tablist rather than two buttons so arrow keys
 * move between the modes the way a keyboard user expects, and so the current
 * surface is announced.
 *
 * Plain pills, not a boxed segmented control: it sits directly above the rail's
 * own tab strip, and every tab row in the app is a raised chip on the bare
 * surface rather than a bordered track.
 */
export function ModeSwitch({ mode, onChange, stretch = false }: Props) {
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
      className={`flex items-center gap-0.5 ${stretch ? "w-full" : "shrink-0"}`}
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
            title={`${APP_MODE_LABEL[value]} — ${APP_MODE_DESCRIPTION[value]} (${MOD}${SHIFT}M)`}
            aria-label={`${APP_MODE_LABEL[value]}: ${APP_MODE_DESCRIPTION[value]}`}
            className={`halo-focus flex h-6.5 items-center justify-center rounded-lg px-2.5 text-[12px] font-medium leading-none transition-colors ${
              stretch ? "flex-1" : ""
            } ${
              selected
                ? "border border-edge bg-surface-raised text-content shadow-lift"
                : "border border-transparent text-content/55 hover:bg-content/6 hover:text-content"
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
