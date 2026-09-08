import { useMemo, useState } from "react";
import { Search } from "../../chrome/icons";
import { EmptyNote, Section } from "../../chrome/SettingsRow";
import { filterKeybindings, KEYBINDINGS } from "../../lib/settings";

export function KeybindingsPage() {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => filterKeybindings(KEYBINDINGS, query), [query]);

  return (
    <Section
      title="Shortcuts"
      description="Bindings come from the app menu and the workspace key handler; they aren’t customizable yet."
      action={
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-[12px] text-content/40 tabular-nums">
            {rows.length} {rows.length === 1 ? "binding" : "bindings"}
          </span>
          <label className="flex h-7 w-52 shrink-0 items-center gap-2 rounded-md border border-edge px-2 text-content/45 focus-within:border-edge-strong">
            <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter"
              aria-label="Filter keybindings"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
            />
          </label>
        </div>
      }
    >
      <div className="flex items-center border-b border-edge bg-content/5 px-4 py-2 ui-label">
        <span className="min-w-0 flex-1">Command</span>
        <span className="w-40 shrink-0">Keybinding</span>
        <span className="w-28 shrink-0">When</span>
      </div>
      {rows.length === 0 ? (
        <EmptyNote>No matching bindings</EmptyNote>
      ) : (
        rows.map((row) => (
          <div
            key={`${row.command}-${row.keys}`}
            className="flex items-center border-b border-edge px-4 py-2 text-[12px] last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate">{row.command}</span>
            <span className="w-40 shrink-0 font-mono text-[12px] text-content/80">{row.keys}</span>
            <span className="w-28 shrink-0 font-mono text-[11px] text-content/40">{row.when}</span>
          </div>
        ))
      )}
    </Section>
  );
}
