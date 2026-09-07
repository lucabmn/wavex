import { ArrowDownCircle, Loader } from "./icons";
import { useCallback, useEffect, useState } from "react";
import {
  installPendingUpdate,
  probeForUpdate,
  readAppVersion,
  UPDATES_SUPPORTED,
  type UpdaterSnapshot,
} from "../lib/updates/updater";
import type { InstalledUpdate } from "../lib/updates/updateNotice";
import { UpdateRailCard } from "./UpdateRailCard";

export function SidebarUpdateFooter({
  update,
  onOpenWhatsNew,
  onDismissUpdate,
}: {
  update?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 p-2 pb-1">
      {update && onOpenWhatsNew && onDismissUpdate ? (
        <UpdateRailCard update={update} onOpen={onOpenWhatsNew} onDismiss={onDismissUpdate} />
      ) : null}
      {/*
        Updating replaces the wavex on the machine drawing this window. A
        browser tab has none to replace, so the control is absent rather than
        offering a check that would only ever report a version it invented.
      */}
      {UPDATES_SUPPORTED ? <SidebarUpdate /> : null}
    </div>
  );
}

export function SidebarUpdate() {
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot>({
    phase: "idle",
    currentVersion: "…",
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const currentVersion = await readAppVersion();
      if (cancelled) return;
      setSnapshot({ phase: "checking", currentVersion });

      try {
        const update = await probeForUpdate();
        if (cancelled) return;
        if (update) {
          setSnapshot({
            phase: "available",
            currentVersion,
            availableVersion: update.version,
          });
          return;
        }
        setSnapshot({ phase: "current", currentVersion });
      } catch {
        if (cancelled) return;
        setSnapshot({ phase: "idle", currentVersion });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const onClick = useCallback(async () => {
    if (snapshot.phase === "downloading" || snapshot.phase === "checking") {
      return;
    }

    if (snapshot.phase === "available") {
      await installPendingUpdate(setSnapshot);
    }
  }, [snapshot.phase]);

  const isDownloading = snapshot.phase === "downloading";
  const hasUpdate = snapshot.phase === "available" || isDownloading;
  // The sidebar stays quiet unless there is something to install: idle,
  // checking, up-to-date, and error states render nothing.
  if (!hasUpdate) {
    return null;
  }

  const label =
    snapshot.phase === "available" && snapshot.availableVersion
      ? `Update to ${snapshot.availableVersion}`
      : `Downloading${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDownloading}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors bg-accent/15 text-content hover:bg-accent/20 disabled:cursor-default disabled:opacity-70"
    >
      <span className="grid size-4.5 shrink-0 place-items-center">
        {isDownloading ? (
          <Loader className="size-4 animate-spin opacity-70" aria-hidden />
        ) : (
          <ArrowDownCircle className="size-4 text-accent" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1 flex items-center">
        <span className="block truncate text-[12px] font-medium leading-tight">{label}</span>
        <span className="ml-auto block text-[11px] text-content/40">
          v{snapshot.currentVersion}
        </span>
      </span>
    </button>
  );
}
