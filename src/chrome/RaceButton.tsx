import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import { isLiveHarness, refreshHarnessCatalogs } from "../lib/harness/registry";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { LAYER } from "../lib/layers";
import {
  getModelSnapshot,
  getPickerVisibilitySnapshot,
  isPickerProviderVisible,
  modelsFor,
  preferredModelId,
  subscribeModels,
  subscribePickerVisibility,
} from "../lib/models";
import {
  RACE_MAX_RUNNERS,
  RACE_MIN_RUNNERS,
  raceRunnersError,
  raceTargets,
  type RaceRunnerChoice,
} from "../lib/race/race";
import { HARNESS_TITLE, type HarnessId } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { Check, ChevronRight, Users } from "./icons";
import { Popover } from "./Popover";

type Props = {
  /** "2/3 done" when this session already belongs to a race. */
  progress?: string;
  /** No draft to race, or a turn is already in flight. */
  disabled?: boolean;
  onView?: () => void;
  onStart: (runners: RaceRunnerChoice[]) => void;
  onClose?: () => void;
};

const MENU_WIDTH = 268;
const SUBMENU_WIDTH = 232;
const SUBMENU_MAX_HEIGHT = 288;
/** The flyout tucks under the parent menu's edge rather than floating free. */
const SUBMENU_OVERLAP = -4;
/** Neither menu is inside the other, so a click in one is not a click away. */
const SELF = "[data-race-menu]";

/**
 * Composer control for Race. One button with two jobs, decided by whether this
 * session is already in a race: pick 2–3 agents for the current draft, or
 * reopen the compare view of the race it is in. Racing is a send, so the
 * picker is disabled on exactly what disables the send button.
 */
export function RaceButton({ progress, disabled = false, onView, onStart, onClose }: Props) {
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
  const catalogVersion = useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [modelActive, setModelActive] = useState(0);
  const [inSubmenu, setInSubmenu] = useState(false);
  const [picked, setPicked] = useState<RaceRunnerChoice[]>([]);
  const button = useRef<HTMLButtonElement>(null);
  const activeRow = useRef<HTMLButtonElement>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();

  const probed = hasProbedHarnessAvailability();
  const targets = useMemo(() => {
    void availabilityVersion;
    void visibilityVersion;
    return raceTargets({
      installed: isHarnessAvailable,
      visible: isPickerProviderVisible,
      live: isLiveHarness,
      probed,
    });
  }, [probed, availabilityVersion, visibilityVersion]);

  const activeHarness = targets[active];
  const models = useMemo(() => {
    void catalogVersion;
    return activeHarness ? modelsFor(activeHarness) : [];
  }, [activeHarness, catalogVersion]);

  useEffect(() => {
    if (!open) return;
    void probeHarnessAvailability();
  }, [open]);

  useEffect(() => {
    if (!open || !activeHarness) return;
    void refreshHarnessCatalogs([activeHarness]);
  }, [open, activeHarness]);

  useEffect(() => {
    if (open) return;
    setActive(0);
    setInSubmenu(false);
    setPicked([]);
  }, [open]);

  // The flyout opens on whatever this row would actually race with: the model
  // already picked for it, or the preferred one when it is not picked yet.
  useEffect(() => {
    if (!activeHarness) {
      setModelActive(0);
      return;
    }
    const current =
      picked.find((runner) => runner.harness === activeHarness)?.model ??
      preferredModelId(activeHarness);
    const index = models.findIndex((model) => model.id === current);
    setModelActive(index >= 0 ? index : 0);
  }, [activeHarness, models, picked]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [open]);

  const dismiss = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
    onClose?.();
  };

  const racing = progress != null;
  const tooFew = probed && targets.length < RACE_MIN_RUNNERS;
  const label = racing
    ? `Race · ${progress} — open the compare view`
    : tooFew
      ? `Race needs ${RACE_MIN_RUNNERS} installed agents`
      : `Race this prompt across ${RACE_MIN_RUNNERS}–${RACE_MAX_RUNNERS} agents`;
  const blocked = racing ? false : disabled || tooFew;

  const modelOf = (harness: HarnessId) =>
    picked.find((runner) => runner.harness === harness)?.model;

  const toggle = (harness: HarnessId, model?: string) => {
    setPicked((prev) => {
      const at = prev.findIndex((runner) => runner.harness === harness);
      if (at < 0) {
        if (prev.length >= RACE_MAX_RUNNERS) return prev;
        return [...prev, { harness, model: model ?? preferredModelId(harness) }];
      }
      if (model == null) return prev.filter((runner) => runner.harness !== harness);
      const next = [...prev];
      next[at] = { harness, model };
      return next;
    });
  };

  const error = raceRunnersError(picked);

  const start = () => {
    if (error) return;
    setOpen(false);
    onStart(picked);
  };

  const rowCount = targets.length + 1;
  const onStartRow = active === targets.length;

  const move = (dir: 1 | -1) => {
    if (inSubmenu) {
      if (models.length === 0) return;
      setModelActive((index) => (index + dir + models.length) % models.length);
      return;
    }
    setActive((index) => (index + dir + rowCount) % rowCount);
  };

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (!inSubmenu && activeHarness && models.length > 0) setInSubmenu(true);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setInSubmenu(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (inSubmenu && activeHarness) {
        const model = models[modelActive];
        if (model) toggle(activeHarness, model.id);
        setInSubmenu(false);
        return;
      }
      if (onStartRow) start();
      else if (activeHarness) toggle(activeHarness);
    }
  };

  const showSubmenu = open && activeHarness != null && models.length > 0;

  return (
    <>
      <button
        ref={button}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup={racing ? undefined : "menu"}
        aria-expanded={racing ? undefined : open}
        disabled={blocked}
        className={`flex h-6.5 shrink-0 items-center gap-1 rounded-md disabled:opacity-40 disabled:hover:bg-content/10 disabled:hover:text-content/50 ${
          racing ? "px-1.5" : "w-6.5 justify-center"
        } ${
          open || racing
            ? "bg-content/20 text-content"
            : "bg-content/10 text-content/50 hover:bg-content/15 hover:text-content"
        }`}
        onClick={() => {
          if (racing) {
            onView?.();
            return;
          }
          if (blocked) return;
          setOpen((value) => !value);
        }}
      >
        <Users className="size-3.5 shrink-0" strokeWidth={1.5} />
        {progress ? (
          <span className="font-mono text-[10px] leading-none tabular-nums">
            {progress.replace(" done", "")}
          </span>
        ) : null}
      </button>
      {open ? (
        <>
          <Popover
            anchor={button}
            side="top"
            align="center"
            width={MENU_WIDTH}
            autoFocus
            ignore={SELF}
            onDismiss={(reason) => dismiss(reason === "escape")}
            role="menu"
            tabIndex={-1}
            aria-label={`Race this prompt across ${RACE_MIN_RUNNERS}–${RACE_MAX_RUNNERS} agents`}
            onKeyDown={onMenuKey}
            data-race-menu
            className="p-1 font-sans"
          >
            <div className="px-1.5 pb-2 pt-1.5">
              <p className="text-[11px] leading-3 text-content/50 text-balance">
                Send this prompt to {RACE_MIN_RUNNERS}–{RACE_MAX_RUNNERS} agents at once, then keep
                the changes you like.
              </p>
            </div>
            <div className="mx-1 mb-1 h-px bg-content/10" />
            {targets.length === 0 ? (
              <div className="px-2.5 py-2 text-[12px] leading-4 text-content/50">
                No agent CLI found. Install one and restart wavex.
              </div>
            ) : (
              targets.map((harness, index) => {
                const highlighted = index === active && !inSubmenu;
                const model = modelOf(harness);
                const on = model != null;
                const full = !on && picked.length >= RACE_MAX_RUNNERS;
                return (
                  <button
                    key={harness}
                    ref={index === active ? activeRow : undefined}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    disabled={full}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => {
                      setActive(index);
                      setInSubmenu(false);
                    }}
                    onClick={() => toggle(harness)}
                    className={`flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] leading-none disabled:opacity-40 ${
                      highlighted ? "bg-content/10 text-content" : "text-content hover:bg-content/5"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`grid size-4 shrink-0 place-items-center rounded border ${
                        on ? "border-accent bg-accent text-white" : "border-content/25"
                      }`}
                    >
                      {on ? <Check className="size-2.5" strokeWidth={2.5} /> : null}
                    </span>
                    <HarnessIcon harness={harness} className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{HARNESS_TITLE[harness]}</span>
                    {on && model ? (
                      <span className="max-w-24 shrink-0 truncate text-[11px] text-content/45">
                        {modelsFor(harness).find((entry) => entry.id === model)?.name ?? model}
                      </span>
                    ) : null}
                    {modelsFor(harness).length > 0 ? (
                      <ChevronRight
                        className="size-3.5 shrink-0 text-content/40"
                        strokeWidth={1.75}
                      />
                    ) : null}
                  </button>
                );
              })
            )}
            <div className="mx-1 my-1 h-px bg-content/10" />
            <button
              ref={onStartRow ? activeRow : undefined}
              type="button"
              role="menuitem"
              disabled={!!error}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => {
                setActive(targets.length);
                setInSubmenu(false);
              }}
              onClick={start}
              className={`flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] leading-none disabled:text-content/35 ${
                onStartRow && !error
                  ? "bg-content/10 text-content"
                  : "text-content hover:bg-content/5"
              } ${error ? "hover:bg-transparent" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate">
                {error ?? `Race ${picked.length} agents`}
              </span>
            </button>
          </Popover>
          {showSubmenu ? (
            <Popover
              // Remounting per row re-measures the flyout against that row.
              key={active}
              ref={lockOverscroll}
              anchor={activeRow}
              side="right"
              gap={SUBMENU_OVERLAP}
              width={SUBMENU_WIDTH}
              maxHeight={SUBMENU_MAX_HEIGHT}
              layer={LAYER.submenu}
              role="menu"
              aria-label={`${HARNESS_TITLE[activeHarness]} models`}
              onMouseEnter={() => setInSubmenu(true)}
              data-race-menu
              className="overflow-y-auto overscroll-none p-1"
            >
              {models.map((model, index) => {
                const highlighted = index === modelActive;
                const on = modelOf(activeHarness) === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => {
                      setInSubmenu(true);
                      setModelActive(index);
                    }}
                    onClick={() => {
                      toggle(activeHarness, model.id);
                      setInSubmenu(false);
                    }}
                    className={`flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] leading-none ${
                      highlighted ? "bg-content/10 text-content" : "text-content hover:bg-content/5"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{model.name}</span>
                    {on ? <Check className="size-3 shrink-0 text-accent" strokeWidth={2} /> : null}
                  </button>
                );
              })}
            </Popover>
          ) : null}
        </>
      ) : null}
    </>
  );
}
