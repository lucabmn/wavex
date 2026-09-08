import { ChevronRight, Connection, Folder, FolderOpen, Loader } from "./icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listDir, type FsEntry } from "../lib/fs";
import { formatProjectRef, type HostId } from "../lib/host";
import {
  connectionLabel,
  getConnectSnapshot,
  refreshConnect,
  subscribeConnect,
} from "../lib/connect";
import { invokeOn } from "../lib/transport";
import { useSyncExternalStore } from "react";
import { looksLikeProject } from "../lib/recents";
import { parentPath } from "../lib/paths";
import { Modal } from "./Modal";

type Props = {
  onCancel: () => void;
  /** A `wavex-host://` reference for the chosen folder. */
  onOpen: (ref: string) => void;
  /** Hand back to this device's own folder dialog. */
  onPickLocal: () => void;
};

/**
 * Opening a project on another machine.
 *
 * The native folder dialog runs on the client and can only see the client's
 * own disk, so a host's checkout is unreachable through it. This browses the
 * host instead, over the same `list_dir` the explorer uses, and answers with a
 * project reference rather than a bare path — a path alone would name a folder
 * on whichever machine happened to read it next.
 */
export function HostProjectDialog({ onCancel, onOpen, onPickLocal }: Props) {
  const connect = useSyncExternalStore(subscribeConnect, getConnectSnapshot);
  const connected = useMemo(
    () => connect.hosts.filter((host) => connect.connections[host.hostId]?.phase === "connected"),
    [connect],
  );
  const [hostId, setHostId] = useState<HostId | null>(null);

  useEffect(() => {
    void refreshConnect();
  }, []);

  useEffect(() => {
    if (hostId || connected.length === 0) return;
    setHostId(connected[0].hostId);
  }, [connected, hostId]);

  if (connected.length === 0) {
    return (
      <Modal
        onClose={onCancel}
        title="Open on another machine"
        description="No connected host"
        size="sm"
      >
        <div className="px-4 pb-4 pt-2 text-[13.5px] leading-relaxed text-content/60">
          Pair a host in Settings → Connections, connect to it, and its projects can be opened here
          alongside the ones on this device.
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      onClose={onCancel}
      title="Open on another machine"
      description="Browsing the host's own filesystem"
      className="h-[min(520px,calc(100vh-96px))]"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap gap-1 px-4 pb-2 pt-1">
          <button
            type="button"
            onClick={onPickLocal}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-content/55 hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <FolderOpen className="size-3.5" strokeWidth={1.75} />
            This device
          </button>
          {connected.map((host) => (
            <button
              key={host.hostId}
              type="button"
              onClick={() => setHostId(host.hostId)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                host.hostId === hostId
                  ? "bg-selected text-content"
                  : "text-content/55 hover:bg-hover hover:text-content"
              }`}
            >
              <Connection className="size-3.5" strokeWidth={1.75} />
              {host.name}
            </button>
          ))}
        </div>
        {hostId ? (
          <HostBrowser
            key={hostId}
            hostId={hostId}
            status={connectionLabel(connect.connections[hostId])}
            onOpen={(path) => onOpen(formatProjectRef({ hostId, path }))}
          />
        ) : null}
      </div>
    </Modal>
  );
}

function HostBrowser({
  hostId,
  status,
  onOpen,
}: {
  hostId: HostId;
  status: string;
  onOpen: (path: string) => void;
}) {
  const [cwd, setCwd] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // `default_cwd` is where the host would open a project itself; home is the
    // fallback when it has no opinion.
    invokeOn<string>(hostId, "default_cwd")
      .then((path) => (path ? path : invokeOn<string>(hostId, "home_dir")))
      .then((path) => {
        if (!cancelled) setCwd(path);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [hostId]);

  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    setEntries(null);
    setError(null);
    listDir(cwd, hostId)
      .then((rows) => {
        if (cancelled) return;
        setEntries(rows.filter((entry) => entry.isDir && !entry.name.startsWith(".")));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, hostId]);

  const goUp = useCallback(() => {
    setCwd((current) => (current ? parentPath(current) : current));
  }, []);

  const canOpen = Boolean(cwd) && looksLikeProject(cwd ?? "");

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-4 pb-2">
        <button
          type="button"
          onClick={goUp}
          disabled={!cwd || parentPath(cwd) === cwd}
          className="rounded-md px-1.5 py-0.5 text-[12.5px] text-content/55 hover:bg-hover hover:text-content disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Up
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-content/70">
          {cwd ?? status}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {error ? (
          <p className="px-2 py-3 text-[12.5px] leading-relaxed text-red-400/90">{error}</p>
        ) : entries == null ? (
          <p className="flex items-center gap-2 px-2 py-3 text-[12.5px] text-content/50">
            <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
            Reading the host…
          </p>
        ) : entries.length === 0 ? (
          <p className="px-2 py-3 text-[12.5px] text-content/50">No folders here.</p>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => setCwd(entry.path)}
              onDoubleClick={() => onOpen(entry.path)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] text-content/80 hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Folder className="size-4 shrink-0 text-content/45" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              <ChevronRight className="size-3.5 shrink-0 text-content/30" strokeWidth={1.75} />
            </button>
          ))
        )}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-4 py-3">
        <button
          type="button"
          disabled={!canOpen}
          onClick={() => cwd && onOpen(cwd)}
          className="ui-fill ui-focus rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium disabled:opacity-40"
        >
          Open this folder
        </button>
      </div>
    </>
  );
}
