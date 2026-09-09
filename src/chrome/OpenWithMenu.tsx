import { useEffect, useRef, useState } from "react";
import { ChevronDown, Code, FolderOpen, Terminal } from "./icons";
import { Popover } from "./Popover";
import {
  defaultOpenWithApp,
  groupOpenWithApps,
  listOpenWithApps,
  openPathWith,
  type OpenWithApp,
} from "../lib/project/openWith";
import { canOpenProjectIn } from "../lib/platform";
import { assetSrc } from "../lib/native";
import { hostIdForProject } from "../lib/transport";

const MENU_WIDTH = 216;

/**
 * "Open project in…": the project folder handed to another application the
 * user already has.
 *
 * Two controls in one: the left half opens the project in the editor most
 * people mean — VS Code where it is installed — and the chevron is how the
 * rest are reached. Wanting something other than the default is the rarer
 * case, so it costs the extra click rather than the common one.
 */
export function OpenWithMenu({ cwd }: { cwd: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<OpenWithApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostId = hostIdForProject(cwd);
  const enabled = canOpenProjectIn(hostId);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    listOpenWithApps(hostId).then(
      (found) => {
        if (live) setApps(found);
      },
      (cause: unknown) => {
        if (live) setError(String(cause));
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, hostId]);

  if (!enabled) return null;

  const groups = groupOpenWithApps(apps ?? []);
  const primary = defaultOpenWithApp(apps ?? []);

  const launch = (app: OpenWithApp) => {
    // Closing on success only, so a launch that failed can say so where the
    // user is still looking.
    openPathWith(app.id, cwd, hostId).then(
      () => setOpen(false),
      (cause: unknown) => {
        setError(String(cause));
        setOpen(true);
      },
    );
  };

  return (
    <>
      <div
        ref={anchor}
        className={`flex h-6.5 items-center rounded-md ${open ? "bg-content/10" : ""}`}
        data-tauri-drag-region="false"
      >
        {primary ? (
          <button
            type="button"
            title={`Open project in ${primary.name}`}
            aria-label={`Open project in ${primary.name}`}
            onClick={() => launch(primary)}
            className="grid size-6.5 place-items-center rounded-l-md text-faint hover:bg-hover hover:text-content"
          >
            <AppIcon app={primary} />
          </button>
        ) : null}
        <button
          type="button"
          title="Open project in…"
          aria-label="Open project in…"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={`grid h-6.5 place-items-center ${
            primary ? "w-4 rounded-r-md" : "w-6.5 rounded-md"
          } ${open ? "text-content" : "text-faint hover:bg-hover hover:text-content"}`}
        >
          <ChevronDown className="size-3" strokeWidth={2} />
        </button>
      </div>
      {open ? (
        <Popover
          anchor={anchor}
          side="bottom"
          align="end"
          width={MENU_WIDTH}
          maxHeight={420}
          onDismiss={() => setOpen(false)}
          role="menu"
          aria-label="Open project in"
          className="overflow-y-auto overscroll-none p-1"
        >
          {error ? (
            <p role="alert" className="px-2 py-1.5 text-[12.5px] leading-snug text-danger">
              {error}
            </p>
          ) : apps == null ? (
            <p className="px-2 py-1.5 text-[12.5px] text-faint">Looking for apps…</p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-1.5 text-[12.5px] text-faint">No apps found</p>
          ) : (
            groups.map((group) => (
              <div key={group.kind}>
                <div className="px-2 pb-0.5 pt-2 ui-label">{group.label}</div>
                {group.apps.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    role="menuitem"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => launch(app)}
                    className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-[13.5px] leading-none text-content hover:bg-hover"
                  >
                    <AppIcon app={app} />
                    <span className="min-w-0 flex-1 truncate">{app.name}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </Popover>
      ) : null}
    </>
  );
}

/**
 * The application's own icon, or a glyph for what it is. A browser tab has no
 * scheme for a file on disk, so it lands on the glyph too.
 */
function AppIcon({ app }: { app: OpenWithApp }) {
  const src = app.icon ? assetSrc(app.icon) : null;
  if (src) return <img src={src} alt="" className="size-3.5 shrink-0 object-contain" />;
  const Glyph = app.kind === "files" ? FolderOpen : app.kind === "terminal" ? Terminal : Code;
  return <Glyph className="size-3.5 shrink-0" strokeWidth={1.75} />;
}
