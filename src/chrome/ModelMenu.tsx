import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Search, Star } from "./icons";
import { filterModels, type AgentModel } from "../lib/models";
import { harnessUnavailableHint, isHarnessAvailable } from "../lib/harness/availability";
import { HARNESS_LABEL, HARNESS_TITLE } from "../lib/session";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { HarnessIcon } from "./HarnessIcon";
import { MOD } from "../lib/platform";

type Props = {
  /** The unfiltered pool; the search field narrows it. */
  models: AgentModel[];
  currentId: string;
  favorites: string[];
  /** Reads the live query, because "no favorites" and "no matches" differ. */
  emptyLabel: (query: string) => string;
  /** Models kept in the list although they are turned off, marked as such. */
  offIds?: string[];
  /**
   * A provider whose CLI is missing cannot be started, so the composer's menu
   * refuses it. Settings is only recording a preference, so it does not.
   */
  requireInstalled?: boolean;
  onPick: (model: AgentModel) => void;
  onToggleFavorite: (id: string) => void;
};

/**
 * The search field and model list both model pickers share: the composer's
 * provider-tabbed popover and the per-provider one in Settings. Keeping the
 * rows in one place is what keeps the two menus reading as the same control.
 */
export function ModelMenu({
  models,
  currentId,
  favorites,
  emptyLabel,
  offIds,
  requireInstalled = true,
  onPick,
  onToggleFavorite,
}: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const search = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => filterModels(models, query), [models, query]);

  useEffect(() => {
    search.current?.focus();
  }, []);

  useEffect(() => {
    const index = visible.findIndex((item) => item.id === currentId);
    setActive(index >= 0 ? index : 0);
    // The highlight follows the current model into a narrowed list, not the
    // list's identity, so it does not jump on every keystroke's re-filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, currentId, models]);

  useEffect(() => {
    setActive((i) => (visible.length === 0 ? 0 : Math.min(i, visible.length - 1)));
  }, [visible.length]);

  const pick = (item: AgentModel) => {
    if (requireInstalled && !isHarnessAvailable(item.harness)) return;
    onPick(item);
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(visible.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = visible[active];
      if (item) pick(item);
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && !e.shiftKey && e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      const item = visible[Number(e.key) - 1];
      if (item) pick(item);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="pb-1.5">
        <label className="flex items-center gap-2 border-b border-content/10 px-2 py-2.5 text-content/50">
          <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
          <input
            ref={search}
            type="text"
            value={query}
            placeholder="Search models..."
            aria-label="Search models"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/40"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
        </label>
      </div>
      <ModelList
        models={visible}
        active={active}
        currentId={currentId}
        favorites={favorites}
        offIds={offIds}
        requireInstalled={requireInstalled}
        emptyLabel={emptyLabel(query)}
        onActive={setActive}
        onPick={pick}
        onToggleFavorite={onToggleFavorite}
      />
    </div>
  );
}

function ModelList({
  models,
  active,
  currentId,
  favorites,
  offIds,
  requireInstalled,
  emptyLabel,
  onActive,
  onPick,
  onToggleFavorite,
}: {
  models: AgentModel[];
  active: number;
  currentId: string;
  favorites: string[];
  offIds?: string[];
  requireInstalled: boolean;
  emptyLabel: string;
  onActive: (index: number) => void;
  onPick: (model: AgentModel) => void;
  onToggleFavorite: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLDivElement>(null);

  const setListRef = (el: HTMLDivElement | null) => {
    listRef.current = el;
    lockOverscroll(el);
  };

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
      if (el.scrollHeight <= el.clientHeight + 1) return;
      el.scrollTop += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [models.length]);

  if (models.length === 0) {
    return <div className="px-3 py-4 text-[12px] text-content/50">{emptyLabel}</div>;
  }

  return (
    <div
      ref={setListRef}
      role="listbox"
      aria-label="Models"
      className="min-h-0 flex-1 overflow-y-auto overscroll-none px-1.5 pb-1.5"
    >
      {models.map((item, index) => {
        const selected = item.id === currentId;
        const highlighted = index === active;
        const favorited = favorites.includes(item.id);
        const disabled = requireInstalled && !isHarnessAvailable(item.harness);
        const off = offIds?.includes(item.id) ?? false;
        const shortcut = index < 9 && !disabled ? `${MOD}${index + 1}` : null;
        return (
          <div
            key={item.id}
            ref={highlighted ? activeRef : undefined}
            onMouseEnter={() => onActive(index)}
            className={`flex w-full items-center gap-1 rounded-lg px-1 ${
              disabled ? "" : highlighted || selected ? "bg-content/10" : "hover:bg-content/5"
            }`}
          >
            <button
              type="button"
              role="option"
              aria-selected={selected}
              aria-disabled={disabled}
              disabled={disabled}
              title={disabled ? harnessUnavailableHint(item.harness) : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (disabled) return;
                onPick(item);
              }}
              className={`flex min-w-0 flex-1 items-center gap-2 px-1.5 py-2 text-left ${
                disabled ? "cursor-not-allowed text-content/35" : "text-content"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span
                    className={`min-w-0 truncate text-[13px] font-medium leading-5 ${
                      off ? "text-content/45" : ""
                    }`}
                  >
                    {item.name}
                  </span>
                  {off ? (
                    <span className="shrink-0 rounded-full bg-content/10 px-1.5 text-[10px] uppercase leading-4 tracking-wide text-content/45">
                      Off
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-[11px] leading-4 text-content/50">
                  <HarnessIcon harness={item.harness} className="size-3 shrink-0 opacity-80" />
                  <span className="truncate">
                    {HARNESS_TITLE[item.harness]} · {HARNESS_LABEL[item.harness]}
                  </span>
                </span>
              </span>
              {shortcut ? (
                <span className="shrink-0 rounded-md bg-content/10 px-1.5 py-0.5 font-mono text-[10px] text-content/50">
                  {shortcut}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              title={favorited ? "Remove from favorites" : "Add to favorites"}
              aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(item.id);
              }}
              className={`grid size-6 shrink-0 place-items-center rounded-md ${
                favorited ? "text-content" : "text-content/30 hover:text-content/70"
              }`}
            >
              <Star
                className="size-3.5"
                strokeWidth={1.75}
                fill={favorited ? "currentColor" : "none"}
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}
