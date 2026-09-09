import { ChevronDown, Star } from "./icons";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  coerceModelPickerTab,
  findModel,
  getModelSnapshot,
  getPickerVisibilitySnapshot,
  loadFavoriteModels,
  loadModelPickerTab,
  enabledModelsFor,
  isModelEnabled,
  resolveModel,
  saveFavoriteModels,
  saveModelPickerTab,
  showProviderInModelPicker,
  stepModelPickerTab,
  subscribeModels,
  subscribePickerVisibility,
  type AgentModel,
  type ModelPickerTab,
} from "../lib/models";
import {
  harnessUnavailableHint,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
  getHarnessAvailabilitySnapshot,
} from "../lib/harness/availability";
import { refreshHarnessCatalogs } from "../lib/harness/registry";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { ModelMenu } from "./ModelMenu";
import { Popover } from "./Popover";
import { LAYER } from "../lib/layers";
import { MOD } from "../lib/platform";

type Props = {
  harness: HarnessId;
  model: string;
  hotkeys?: boolean;
  /**
   * Render as a form field rather than a composer chip: full width and the
   * same height as the inputs beside it. The composer wants the compact one,
   * a dialog row wants this.
   */
  fill?: boolean;
  /**
   * Where the menu sits in the stack. Defaults to the popover layer; a picker
   * opened from inside a dialog has to outrank the dialog it is standing on.
   */
  layer?: number;
  /** Whether the menu is showing, for a host that has to yield its focus trap. */
  onOpenChange?: (open: boolean) => void;
  onChange: (harness: HarnessId, model: string) => void;
  onClose?: () => void;
};

const MENU_WIDTH = 300;
const MENU_MIN_HEIGHT = 180;
const MENU_MAX_HEIGHT = 340;

export function ModelPicker({
  harness,
  model,
  hotkeys = false,
  fill = false,
  layer = LAYER.popover,
  onOpenChange,
  onChange,
  onClose,
}: Props) {
  const catalogVersion = useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  const availabilityVersion = useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const visibilityVersion = useSyncExternalStore(
    subscribePickerVisibility,
    getPickerVisibilitySnapshot,
    getPickerVisibilitySnapshot,
  );
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ModelPickerTab>(() => loadModelPickerTab());
  const [favorites, setFavorites] = useState(loadFavoriteModels);
  const root = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const current = resolveModel(harness, model);
  const tabRef = useRef(tab);
  const openRef = useRef(open);
  const lastHotkey = useRef(0);

  const shownInPicker = (id: HarnessId) =>
    showProviderInModelPicker(id, isHarnessAvailable(id), hasProbedHarnessAvailability());
  const pickerHarnesses = HARNESSES.filter(shownInPicker);
  const visibleTab = coerceModelPickerTab(tab, shownInPicker);
  if (visibleTab !== tab) {
    setTab(visibleTab);
  }
  tabRef.current = visibleTab;
  openRef.current = open;

  const dismiss = (restore: boolean) => {
    setOpen(false);
    onOpenChangeRef.current?.(false);
    if (restore) onCloseRef.current?.();
  };

  const openPicker = () => {
    setOpen(true);
    onOpenChangeRef.current?.(true);
  };

  const togglePicker = () => {
    if (openRef.current) dismiss(true);
    else openPicker();
  };

  const toggleFromHotkey = () => {
    const now = performance.now();
    if (now - lastHotkey.current < 80) return;
    lastHotkey.current = now;
    togglePicker();
  };

  const selectTab = (next: ModelPickerTab) => {
    setTab(next);
    saveModelPickerTab(next);
  };

  useEffect(() => {
    if (!open) return;
    void probeHarnessAvailability();
    setTab(coerceModelPickerTab(loadModelPickerTab(), shownInPicker));
  }, [open]);

  useEffect(() => {
    if (!open || visibleTab === "favorites") return;
    void refreshHarnessCatalogs([visibleTab]);
  }, [open, visibleTab]);

  useEffect(() => {
    const inBlockingUi = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (target.closest(".wavex-terminal")) return true;
      return Boolean(
        target.closest(
          "[data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-access-picker], [data-model-settings]",
        ),
      );
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (hotkeys && mod && !e.altKey && !e.shiftKey && (e.key === "." || e.code === "Period")) {
        if (!openRef.current && inBlockingUi(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        toggleFromHotkey();
        return;
      }
      if (!openRef.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismiss(true);
        return;
      }
      if (mod || e.altKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (inBlockingUi(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      selectTab(stepModelPickerTab(tabRef.current, e.key === "ArrowLeft" ? -1 : 1, shownInPicker));
    };

    const onMenu = () => {
      if (!hotkeys) return;
      if (inBlockingUi(document.activeElement)) return;
      toggleFromHotkey();
    };

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("open_model_picker", onMenu);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("open_model_picker", onMenu);
    };
  }, [hotkeys]);

  const visible = useMemo(() => {
    const pool =
      visibleTab === "favorites"
        ? favorites
            .map((id) => findModel(id))
            .filter(
              (item): item is AgentModel =>
                item != null && shownInPicker(item.harness) && isModelEnabled(item.id),
            )
        : enabledModelsFor(visibleTab);
    return pool;
    // Catalog, install probes, and picker-visibility all feed this list:
    // catalogs land after mount, and hiding a provider must drop its favorites.
  }, [visibleTab, favorites, catalogVersion, availabilityVersion, visibilityVersion]);

  const pick = (item: AgentModel) => {
    if (!isHarnessAvailable(item.harness)) return;
    onChange(item.harness, item.id);
    dismiss(true);
  };

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      saveFavoriteModels(next);
      return next;
    });
  };

  return (
    <div ref={root} className={fill ? "relative w-full" : "relative"}>
      <button
        type="button"
        title={`${HARNESS_TITLE[current.harness]} · ${current.name} (${MOD}.)`}
        aria-label={`${HARNESS_TITLE[current.harness]} ${current.name}`}
        aria-keyshortcuts={`${MOD}.`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) {
            dismiss(true);
            return;
          }
          openPicker();
        }}
        className={`flex items-center rounded-md ${
          fill ? "h-8 w-full gap-2 px-2" : "h-6.5 max-w-52 gap-1 px-1.5"
        } ${open ? "bg-selected text-content" : "bg-content/10 text-content hover:bg-hover"}`}
      >
        <HarnessIcon harness={current.harness} className="size-4 shrink-0" />
        <span className={`min-w-0 truncate ${fill ? "text-[13.5px]" : "text-[11.5px]"}`}>
          {current.name}
        </span>
        <ChevronDown
          className={`size-3 shrink-0 text-faint ${fill ? "ml-auto" : ""} ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      {open ? (
        <Popover
          anchor={root}
          side="top"
          layer={layer}
          width={MENU_WIDTH}
          minHeight={MENU_MIN_HEIGHT}
          maxHeight={MENU_MAX_HEIGHT}
          onDismiss={() => dismiss(false)}
          dismissOnEscape={false}
          role="dialog"
          aria-label="Model picker"
          data-model-picker
          className="flex flex-col overflow-hidden"
        >
          <nav
            role="tablist"
            aria-label="Providers"
            aria-keyshortcuts="ArrowLeft ArrowRight"
            aria-orientation="horizontal"
            className="flex w-full shrink-0 items-stretch border-b border-edge"
          >
            <ProviderTabButton
              title="Favorites"
              selected={visibleTab === "favorites"}
              onSelect={() => selectTab("favorites")}
            >
              <Star
                className="size-4"
                strokeWidth={1.75}
                fill={visibleTab === "favorites" ? "currentColor" : "none"}
              />
            </ProviderTabButton>
            {pickerHarnesses.map((id) => (
              <ProviderTabButton
                key={id}
                title={HARNESS_TITLE[id]}
                selected={visibleTab === id}
                onSelect={() => selectTab(id)}
              >
                <HarnessIcon harness={id} className="size-4" />
              </ProviderTabButton>
            ))}
          </nav>

          <ModelMenu
            models={visible}
            currentId={current.id}
            favorites={favorites}
            emptyLabel={(query) =>
              visibleTab === "favorites" && !query.trim()
                ? "No favorite models"
                : visibleTab !== "favorites" && !isHarnessAvailable(visibleTab)
                  ? harnessUnavailableHint(visibleTab)
                  : visibleTab === "codex" && !query.trim()
                    ? "Loading Codex models…"
                    : "No matching models"
            }
            onPick={pick}
            onToggleFavorite={toggleFavorite}
          />
        </Popover>
      ) : null}
    </div>
  );
}

function ProviderTabButton({
  title,
  selected,
  disabled = false,
  onSelect,
  children,
}: {
  title: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      title={title}
      aria-label={title}
      aria-selected={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (disabled) return;
        onSelect();
      }}
      className={`relative flex min-w-0 flex-1 items-center justify-center gap-1 px-2 py-3 text-[11.5px] leading-4 ${
        disabled
          ? "cursor-not-allowed text-dim"
          : selected
            ? "bg-selected text-content"
            : "text-faint hover:bg-hover hover:text-content"
      }`}
    >
      <span className="shrink-0">{children}</span>
      {selected && !disabled ? (
        <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-content" />
      ) : null}
    </button>
  );
}
