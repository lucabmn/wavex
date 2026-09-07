import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "../chrome/icons";
import { basename, readFilePreview } from "../lib/fs";
import { displayPath, pathKey } from "../lib/paths";
import type { EditorNavigation } from "../lib/search";
import type { CodeLocation } from "../lib/editor/codeNavigation";
import type { ReferencesTabSource } from "../lib/workspace/layout";

type Props = {
  cwd: string;
  references: ReferencesTabSource;
  active: boolean;
  onOpenFile: (path: string, navigation?: EditorNavigation) => void;
};

type Row = { target: CodeLocation; index: number };
type Group = { path: string; rows: Row[] };

/**
 * Reading one line per result is a file read per result. Past this the list is
 * for scanning file names, not for reading code, and the reads cost more than
 * the preview is worth.
 */
const MAX_PREVIEWS = 200;

/**
 * A language server result list, as a pane tab rather than a popover.
 *
 * Results are a place to work from — walk them, open one, come back — so they
 * get a tab a split can hold beside the code. Arrow keys move the selection and
 * Enter opens it, so a whole result set can be worked through from the keyboard.
 */
export function ReferencesView({ cwd, references, active, onOpenFile }: Props) {
  const groups = useMemo(() => groupByFile(references.targets), [references.targets]);
  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const previews = usePreviews(references.targets);
  const [selected, setSelected] = useState(0);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected(0);
    setCollapsed(new Set());
  }, [references]);

  useEffect(() => {
    if (!active || rows.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // A picker or a dialog over this tab owns the arrow keys while it is
      // open; handling them here too would navigate both lists at once.
      if (typingTarget(event.target)) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setSelected((current) => Math.min(Math.max(0, current + delta), rows.length - 1));
        return;
      }
      if (event.key !== "Enter") return;
      const row = rows[selected];
      if (!row) return;
      event.preventDefault();
      onOpenFile(row.target.path, { line: row.target.line, column: row.target.column });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onOpenFile, rows, selected]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (references.targets.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <p className="text-[13px] text-content/70">
          No references to <span className="font-mono">{references.symbol}</span>
        </p>
      </div>
    );
  }

  const open = (target: CodeLocation, index: number) => {
    setSelected(index);
    onOpenFile(target.path, { line: target.line, column: target.column });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-content/10 px-3 text-[11.5px] text-content/55">
        <span className="truncate font-mono text-content">{references.symbol}</span>
        <span className="tabular-nums">
          {plural(references.targets.length, "result")} in {plural(groups.length, "file")}
        </span>
      </header>
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto py-1">
        {groups.map((group) => (
          <section key={group.path}>
            <button
              type="button"
              onClick={() => setCollapsed((current) => toggle(current, group.path))}
              aria-expanded={!collapsed.has(group.path)}
              className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11.5px] hover:bg-content/5"
            >
              {collapsed.has(group.path) ? (
                <ChevronRight className="size-3 shrink-0 text-content/50" strokeWidth={1.75} />
              ) : (
                <ChevronDown className="size-3 shrink-0 text-content/50" strokeWidth={1.75} />
              )}
              <span className="shrink-0 font-medium text-content">{basename(group.path)}</span>
              <span className="min-w-0 flex-1 truncate text-content/40">
                {displayPath(group.path, cwd)}
              </span>
              <span className="shrink-0 tabular-nums text-content/40">{group.rows.length}</span>
            </button>
            {collapsed.has(group.path)
              ? null
              : group.rows.map(({ target, index }) => (
                  <button
                    key={`${target.line}:${target.column}`}
                    type="button"
                    data-selected={index === selected}
                    onClick={() => open(target, index)}
                    className={`flex w-full items-center gap-2 py-0.5 pr-2 pl-7 text-left font-mono text-[11px] hover:bg-content/5 ${
                      index === selected ? "bg-content/10 text-content" : "text-content/60"
                    }`}
                  >
                    <span className="w-9 shrink-0 text-right tabular-nums text-content/35">
                      {target.line}
                    </span>
                    <span className="truncate">{previews.get(previewKey(target)) ?? ""}</span>
                  </button>
                ))}
          </section>
        ))}
      </div>
    </div>
  );
}

/** One line of context per result, so the list reads as code rather than as coordinates. */
function usePreviews(targets: CodeLocation[]): ReadonlyMap<string, string> {
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    setPreviews(new Map());
    const wanted = targets.slice(0, MAX_PREVIEWS);
    void Promise.all(
      wanted.map(async (target) => {
        const lines = await readFilePreview(target.path, 1, target.line).catch(() => []);
        return [previewKey(target), lines[0]?.trim() ?? ""] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setPreviews(new Map(entries.filter(([, text]) => text)));
    });
    return () => {
      cancelled = true;
    };
  }, [targets]);

  return previews;
}

/** Whether another surface — a text field, or an overlay — owns this key. */
function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]');
}

function groupByFile(targets: CodeLocation[]): Group[] {
  // Keyed by `pathKey`: a server may echo a path back in another case, and on
  // Windows that would split one file into two groups in the result list.
  const byPath = new Map<string, { path: string; targets: CodeLocation[] }>();
  for (const target of targets) {
    const key = pathKey(target.path);
    const group = byPath.get(key) ?? { path: target.path, targets: [] };
    group.targets.push(target);
    byPath.set(key, group);
  }
  let index = 0;
  return [...byPath.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((group) => ({
      path: group.path,
      rows: group.targets
        .sort((a, b) => a.line - b.line || a.column - b.column)
        .map((target) => ({ target, index: index++ })),
    }));
}

function previewKey(target: CodeLocation): string {
  return `${pathKey(target.path)}:${target.line}`;
}

function toggle(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
