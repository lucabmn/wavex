import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Search } from "./icons";
import { MatchText } from "./MatchText";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import {
  APP_COMMANDS,
  PALETTE_MODES,
  paletteEntries,
  parsePaletteQuery,
  type CommandId,
  type PaletteEntry,
  type PaletteMode,
} from "../lib/commands";
import { LAYER } from "../lib/layers";
import { useDialogFocus } from "../hooks/useDialogFocus";

type Props = {
  open: boolean;
  /** Only these commands are offered; the rest of the catalog is documentation. */
  handlers: Partial<Record<CommandId, () => void>>;
  onClose: () => void;
};

/** Run any app command by name, with the shortcut it also answers to. */
export function CommandPalette({ open, handlers, onClose }: Props) {
  const search = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus<HTMLDivElement>({
    onClose,
    initialFocusRef: search,
    enabled: open,
  });
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  // The handler object is rebuilt every render; only its key set matters here.
  const runnableKey = Object.keys(handlers).sort().join(" ");
  const runnable = useMemo(() => new Set(runnableKey.split(" ") as CommandId[]), [runnableKey]);
  const { mode, rest } = parsePaletteQuery(query);
  const entries = useMemo(() => paletteEntries(APP_COMMANDS, runnable, query), [query, runnable]);
  const meta = PALETTE_MODES[mode];

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
  }, [open]);

  if (!open) return null;

  const run = (entry: PaletteEntry) => {
    const handler = handlers[entry.command.id];
    // Help mode also lists list-only shortcuts for discovery; they have no
    // handler, so activating one leaves the palette open.
    if (!handler) return;
    onClose();
    handler();
  };

  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (entries.length === 0) return;
      setActive((index) => (index + 1) % entries.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (entries.length === 0) return;
      setActive((index) => (index - 1 + entries.length) % entries.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const entry = entries[active];
      if (entry) run(entry);
      return;
    }
    if (event.key === "Tab") event.preventDefault();
  };

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div className="absolute inset-0" onMouseDown={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label="Command Palette"
        data-command-palette
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute top-[12%] left-1/2 flex w-[min(560px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-content/10 bg-content/5 backdrop-blur-xl"
      >
        <div className="pb-1.5">
          <label className="flex items-center gap-2 border-b border-content/10 px-2 py-2.5 text-content/50">
            <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
            <ModeBadge mode={mode} />
            <input
              ref={search}
              type="text"
              value={query}
              placeholder={meta.placeholder}
              aria-label={meta.placeholder}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-content outline-none placeholder:text-content/40"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKey}
            />
          </label>
          <ModeHint active={mode} hasQuery={rest.trim().length > 0} />
        </div>
        {entries.length === 0 ? (
          <p className="px-3 pt-1 pb-3 text-[12px] text-content/50">{meta.empty}</p>
        ) : (
          <CommandList
            entries={entries}
            active={active}
            query={rest}
            handlers={handlers}
            onActive={setActive}
            onRun={run}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

function ModeBadge({ mode }: { mode: PaletteMode }) {
  if (mode === "commands") return null;
  return (
    <span className="shrink-0 rounded border border-content/15 bg-content/10 px-1.5 py-0.5 font-mono text-[11px] text-content/70">
      {PALETTE_MODES[mode].prefix}
    </span>
  );
}

const MODE_ORDER: PaletteMode[] = ["commands", "files", "search", "help"];

function ModeHint({ active, hasQuery }: { active: PaletteMode; hasQuery: boolean }) {
  return (
    <div
      aria-hidden
      className={`flex items-center gap-2.5 overflow-hidden px-3 text-[11px] text-content/35 transition-all ${
        hasQuery ? "max-h-0 py-0 opacity-0" : "max-h-7 py-1.5 opacity-100"
      }`}
    >
      {MODE_ORDER.map((mode) => (
        <span key={mode} className={mode === active ? "font-medium text-content/70" : undefined}>
          <span className="font-mono">{PALETTE_MODES[mode].prefix}</span>{" "}
          {PALETTE_MODES[mode].label}
        </span>
      ))}
    </div>
  );
}

function CommandList({
  entries,
  active,
  query,
  handlers,
  onActive,
  onRun,
}: {
  entries: PaletteEntry[];
  active: number;
  query: string;
  handlers: Partial<Record<CommandId, () => void>>;
  onActive: (index: number) => void;
  onRun: (entry: PaletteEntry) => void;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={(node) => {
        listRef.current = node;
        lockOverscroll(node);
      }}
      role="listbox"
      aria-label="Commands"
      className="max-h-[46vh] overflow-y-auto overscroll-none px-1.5 pb-1.5"
    >
      {entries.map((entry, index) => {
        const [group, ...rest] = entry.command.label.split(": ");
        const name = rest.join(": ") || entry.command.label;
        const offset = entry.command.label.length - name.length;
        const runnable = !!handlers[entry.command.id];
        return (
          <button
            key={entry.command.id}
            type="button"
            role="option"
            aria-selected={index === active}
            aria-disabled={!runnable}
            onMouseMove={() => onActive(index)}
            onClick={() => onRun(entry)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
              index === active ? "bg-content/10" : "hover:bg-content/5"
            } ${runnable ? "" : "opacity-70"}`}
          >
            <span className="shrink-0 text-[12px] text-content/40">{group}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-content">
              <MatchText
                text={name}
                positions={entry.positions
                  .map((position) => position - offset)
                  .filter((position) => position >= 0)}
                active={!!query.trim()}
              />
            </span>
            {entry.command.keys ? (
              <span className="shrink-0 font-mono text-[11px] text-content/40">
                {entry.command.keys}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
