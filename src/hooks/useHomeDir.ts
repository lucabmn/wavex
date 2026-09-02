import { useEffect, useState } from "react";
import { homeDir } from "../lib/fs";

/** The home directory never changes while the app runs, so one lookup is enough. */
let pending: Promise<string> | null = null;
let resolved = "";

function load(): Promise<string> {
  pending ??= homeDir()
    .then((home) => {
      resolved = home;
      return home;
    })
    .catch(() => {
      pending = null;
      return "";
    });
  return pending;
}

/** Home directory, or `""` until the first lookup lands. */
export function useHomeDir(): string {
  const [home, setHome] = useState(resolved);

  useEffect(() => {
    if (home) return;
    let cancelled = false;
    void load().then((value) => {
      if (!cancelled) setHome(value);
    });
    return () => {
      cancelled = true;
    };
  }, [home]);

  return home;
}
