import { useCallback, useRef, useState } from "react";
import { AppWindow, ChevronDown } from "./icons";
import { Popover } from "./Popover";
import {
  groupOpenWithApps,
  listOpenWithApps,
  openPathWith,
  type OpenWithApp,
} from "../lib/project/openWith";
import { canOpenProjectIn } from "../lib/platform";
import { hostIdForProject } from "../lib/transport";

const MENU_WIDTH = 216;

/**
 * "Open project in…": the project folder handed to another application the
 * user already has.
 *
 * The list is asked for when the menu opens rather than at mount, because
 * probing for installed applications touches the disk and most windows never
 * open this. A previous answer stays on screen while the next one loads, so
 * reopening the menu does not blink.
 */
export function OpenWithMenu({ cwd }: { cwd: string }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<OpenWithApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostId = hostIdForProject(cwd);

  const load = useCallback(() => {
    listOpenWithApps(hostId)
      .then((found) => {
        setApps(found);
        setError(null);
      })
      .catch((cause: unknown) => setError(String(cause)));
  }, [hostId]);

  if (!canOpenProjectIn(hostId)) return null;

  const groups = groupOpenWithApps(apps ?? []);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        title="Open project in…"
        aria-label="Open project in…"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tauri-drag-region="false"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) load();
        }}
        className={`flex h-6.5 items-center gap-0.5 rounded-md px-1 ${
          open
            ? "bg-content/10 text-content"
            : "text-content/50 hover:bg-content/10 hover:text-content"
        }`}
      >
        <AppWindow className="size-3.5" strokeWidth={1.75} />
        <ChevronDown className="size-3" strokeWidth={2} />
      </button>
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
            <p role="alert" className="px-2 py-1.5 text-[12px] leading-snug text-red-300">
              {error}
            </p>
          ) : apps == null ? (
            <p className="px-2 py-1.5 text-[12px] text-content/45">Looking for apps…</p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] text-content/45">No apps found</p>
          ) : (
            groups.map((group) => (
              <div key={group.kind}>
                <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-content/40">
                  {group.label}
                </div>
                {group.apps.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    role="menuitem"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      // Closing on success only, so a launch that failed can
                      // say so where the user is still looking.
                      openPathWith(app.id, cwd, hostId).then(
                        () => setOpen(false),
                        (cause: unknown) => setError(String(cause)),
                      );
                    }}
                    className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] leading-none text-content hover:bg-content/5"
                  >
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
