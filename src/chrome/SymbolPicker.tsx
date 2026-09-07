import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Search } from "./icons";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { fuzzyMatch } from "../lib/fuzzy";
import { LAYER } from "../lib/layers";
import { clientForOpenDocument, runningLspClients } from "../lib/lsp/manager";
import { flattenDocumentSymbols, toWorkspaceSymbols, type CodeSymbol } from "../lib/lsp/symbols";
import { displayPath } from "../lib/paths";
import type { EditorNavigation } from "../lib/search";
import { MatchText } from "./MatchText";

type Props = {
  open: boolean;
  cwd: string;
  /** The file the picker starts on. Absent when no editor is focused. */
  path: string | null;
  onOpenFile: (path: string, navigation?: EditorNavigation) => void;
  onClose: () => void;
};

type Ranked = CodeSymbol & { score: number; positions: number[] };

/** A server can answer with every symbol it knows. The list is for picking one. */
const MAX_RESULTS = 200;

/** Long enough that holding a key down does not send a query per keystroke. */
const WORKSPACE_DEBOUNCE_MS = 150;

/**
 * Go to Symbol, over the language server rather than over the text.
 *
 * It opens on the symbols of the current file. A leading `#` — the same
 * convention the rest of the ecosystem uses — switches to asking every running
 * server about the whole project instead.
 */
export function SymbolPicker({ open, cwd, path, onOpenFile, onClose }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [documentSymbols, setDocumentSymbols] = useState<CodeSymbol[]>([]);
  const [workspaceSymbols, setWorkspaceSymbols] = useState<CodeSymbol[]>([]);
  const [loading, setLoading] = useState(false);

  const workspaceMode = query.startsWith("#");
  const term = workspaceMode ? query.slice(1).trim() : query.trim();

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setWorkspaceSymbols([]);
    input.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !path) {
      setDocumentSymbols([]);
      return;
    }
    let cancelled = false;
    const client = clientForOpenDocument(path);
    if (!client) {
      setDocumentSymbols([]);
      return;
    }
    setLoading(true);
    void client
      .documentSymbols(path)
      .then((symbols) => {
        if (cancelled) return;
        setDocumentSymbols(flattenDocumentSymbols(symbols, path));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, path]);

  useEffect(() => {
    if (!open || !workspaceMode) return;
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void Promise.all(runningLspClients().map((client) => client.workspaceSymbols(term)))
        .then((answers) => {
          if (cancelled) return;
          setWorkspaceSymbols(answers.flatMap((answer) => toWorkspaceSymbols(answer)));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, WORKSPACE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, term, workspaceMode]);

  const results = useMemo(() => {
    const source = workspaceMode ? workspaceSymbols : documentSymbols;
    // A workspace query is already filtered by the server; ranking it again
    // locally would fight the server's own idea of what matches.
    const ranked: Ranked[] = [];
    for (const symbol of source) {
      if (!term) {
        ranked.push({ ...symbol, score: 0, positions: [] });
        continue;
      }
      const hit = fuzzyMatch(term, symbol.name);
      if (!hit && !workspaceMode) continue;
      ranked.push({ ...symbol, score: hit?.score ?? 0, positions: hit?.positions ?? [] });
    }
    return ranked.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  }, [documentSymbols, term, workspaceMode, workspaceSymbols]);

  useEffect(() => {
    setActive(0);
  }, [results]);

  if (!open) return null;

  const pick = (symbol: CodeSymbol) => {
    onOpenFile(symbol.path, { line: symbol.line, column: symbol.column });
    onClose();
  };

  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => Math.min(Math.max(0, current + delta), results.length - 1));
      return;
    }
    if (event.key !== "Enter") return;
    const symbol = results[active];
    if (!symbol) return;
    event.preventDefault();
    pick(symbol);
  };

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div className="absolute inset-0" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-label="Go to Symbol"
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute left-1/2 top-[12%] flex w-[min(560px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-content/10 bg-content/5 backdrop-blur-xl"
      >
        <div className="pb-1.5">
          <label className="flex items-center gap-2 border-b border-content/10 px-2 py-2.5 text-content/50">
            <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
            <input
              ref={input}
              type="text"
              value={query}
              placeholder="Go to Symbol — start with # to search the project"
              aria-label="Go to Symbol"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-content outline-none placeholder:text-content/40"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKey}
            />
          </label>
        </div>
        {results.length === 0 ? (
          <p className="px-3 pt-1 pb-3 text-[12px] text-content/50">
            {emptyLabel({ loading, workspaceMode, hasFile: !!path, term })}
          </p>
        ) : (
          <SymbolList
            cwd={cwd}
            symbols={results}
            active={active}
            showPath={workspaceMode}
            onActive={setActive}
            onPick={pick}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

function emptyLabel({
  loading,
  workspaceMode,
  hasFile,
  term,
}: {
  loading: boolean;
  workspaceMode: boolean;
  hasFile: boolean;
  term: string;
}): string {
  if (loading) return "Asking the language server…";
  if (workspaceMode) {
    return term ? "No matching symbols" : "Type to search the project";
  }
  if (!hasFile) return "Open a file to list its symbols";
  return term ? "No matching symbols" : "No symbols in this file";
}

function SymbolList({
  cwd,
  symbols,
  active,
  showPath,
  onActive,
  onPick,
}: {
  cwd: string;
  symbols: Ranked[];
  active: number;
  showPath: boolean;
  onActive: (index: number) => void;
  onPick: (symbol: CodeSymbol) => void;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={lockOverscroll}
      role="listbox"
      aria-label="Symbols"
      className="max-h-[min(380px,50vh)] overflow-y-auto overscroll-none px-1.5 pb-1.5"
    >
      {symbols.map((symbol, index) => {
        const highlighted = index === active;
        return (
          <button
            key={`${symbol.path}:${symbol.line}:${symbol.column}:${symbol.name}`}
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={highlighted}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onActive(index)}
            onClick={() => onPick(symbol)}
            className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm leading-none ${
              highlighted ? "bg-content/10 text-content" : "text-content"
            }`}
          >
            <span className="w-16 shrink-0 truncate font-mono text-[10.5px] text-content/40">
              {symbol.kind}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <MatchText
                text={symbol.name}
                positions={symbol.positions}
                active={symbol.positions.length > 0}
              />
            </span>
            <span className="min-w-0 max-w-[45%] truncate font-mono text-[11px] text-content/40">
              {showPath ? displayPath(symbol.path, cwd) : symbol.container}
            </span>
          </button>
        );
      })}
    </div>
  );
}
