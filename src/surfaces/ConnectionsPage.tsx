/**
 * wavex Link, from both ends: what this machine serves, and the machines this
 * profile has paired with.
 *
 * The page says plainly what a host grants, because the honest description of
 * one is a service that runs commands and writes to a real checkout as the
 * user running it.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Copy, Trash2 } from "../chrome/icons";
import { EmptyNote, Row, Section, Toggle } from "../chrome/SettingsRow";
import { copyText } from "../lib/clipboard";
import {
  addSavedHost,
  connectionLabel,
  connectSavedHost,
  disconnectSavedHost,
  getConnectSnapshot,
  hostPairingCode,
  refreshConnect,
  removeSavedHost,
  renameHost,
  rotateHostToken,
  startHost,
  stopHost,
  subscribeConnect,
} from "../lib/connect";

const PHASE_TONE: Record<string, string> = {
  connected: "text-positive/80",
  connecting: "text-faint",
  reconnecting: "text-warn/80",
  resynchronizing: "text-warn/80",
  offline: "text-dim",
};

export function ConnectionsPage() {
  const { status, hosts, connections } = useSyncExternalStore(
    subscribeConnect,
    getConnectSnapshot,
    getConnectSnapshot,
  );
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refreshConnect();
  }, []);

  useEffect(() => {
    if (status) setName(status.name);
  }, [status?.name]);

  const run = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      await refreshConnect();
    }
  }, []);

  const running = status?.running ?? false;

  return (
    <>
      <Section
        title="This machine"
        description="Loopback only, and every connection has to hold the code below."
      >
        <Row
          label="Serve this machine"
          description="Another wavex can then open this machine's projects, run its agents, and
          use its terminals — everything wavex itself can do here, as you. Only
          a client holding the connection code can, and only over the loopback
          address."
        >
          <Toggle
            label="Serve this machine"
            on={running}
            onChange={(on) => void run(() => (on ? startHost() : stopHost()))}
          />
        </Row>

        {running ? (
          <>
            <Row
              label="Address"
              description="Loopback only. To reach this host from another machine, forward the
              port over SSH or a private network; wavex will not bind a public
              address for you."
            >
              <code className="rounded-md bg-content/8 px-2 py-1 text-[12.5px] text-muted">
                127.0.0.1:{status?.port}
              </code>
            </Row>

            <Row label="Host name" description="How this machine names itself to a client.">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => {
                  if (name.trim() && name !== status?.name) void run(() => renameHost(name));
                }}
                aria-label="Host name"
                className="w-56 rounded-md bg-content/8 px-2.5 py-1.5 text-[12.5px] text-content outline-none focus:bg-content/12"
              />
            </Row>

            <Row
              label="Connection code"
              description="Carries this host's token. Anyone holding it has this machine. Paste
              it into the other wavex and nowhere else."
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(async () => copyText(await hostPairingCode()))}
                className="flex items-center gap-1.5 rounded-md bg-content/10 px-2.5 py-1.5 text-[12.5px] font-medium text-content hover:bg-hover"
              >
                <Copy className="size-3.5" strokeWidth={1.75} />
                Copy connection code
              </button>
            </Row>

            <Row
              label="Replace token"
              description="Every code handed out so far stops working, and the clients connected
              with the old one are dropped."
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(rotateHostToken)}
                className="rounded-md px-2.5 py-1.5 text-[12.5px] text-danger/80 hover:bg-danger/15 hover:text-danger"
              >
                Replace
              </button>
            </Row>

            <Row
              label="Connected clients"
              description="Clients attached right now. Closing one does not stop the agents it
              started."
            >
              <span className="text-[12.5px] text-muted">{status?.clients ?? 0}</span>
            </Row>
          </>
        ) : null}
      </Section>

      <Section title="Paired hosts" description="Machines this wavex can open.">
        {hosts.length === 0 ? (
          <EmptyNote>
            Paste a connection code from another machine&apos;s wavex to add one.
          </EmptyNote>
        ) : null}
        {hosts.map((host) => {
          const state = connections[host.hostId];
          const phase = state?.phase ?? "offline";
          return (
            <Row
              key={host.hostId}
              label={
                <span className="flex items-center gap-2">
                  <span className="min-w-0 truncate">{host.name}</span>
                  <span className={`shrink-0 text-[11.5px] ${PHASE_TONE[phase] ?? "text-dim"}`}>
                    {connectionLabel(state)}
                  </span>
                </span>
              }
              description={host.endpoint}
            >
              {phase === "offline" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => connectSavedHost(host.hostId))}
                  className="rounded-md bg-content/10 px-2.5 py-1.5 text-[12.5px] font-medium text-content hover:bg-hover"
                >
                  Connect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    disconnectSavedHost(host.hostId);
                    void refreshConnect();
                  }}
                  className="rounded-md px-2.5 py-1.5 text-[12.5px] text-muted hover:bg-hover hover:text-content"
                >
                  Disconnect
                </button>
              )}
              <button
                type="button"
                aria-label={`Remove ${host.name}`}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    disconnectSavedHost(host.hostId);
                    await removeSavedHost(host.hostId);
                  })
                }
                className="rounded-md p-1.5 text-danger/80 hover:bg-danger/15 hover:text-danger"
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </button>
            </Row>
          );
        })}

        <Row
          label="Add a host"
          description="The code is a secret: it carries the token that opens that machine."
        >
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="wavex-connect:…"
            aria-label="Connection code"
            className="w-72 rounded-md bg-content/8 px-2.5 py-1.5 font-mono text-[12.5px] text-content outline-none placeholder:text-dim focus:bg-content/12"
          />
          <button
            type="button"
            disabled={busy || !code.trim()}
            onClick={() =>
              void run(async () => {
                await addSavedHost(code.trim());
                setCode("");
              })
            }
            className="rounded-md bg-content/10 px-2.5 py-1.5 text-[12.5px] font-medium text-content hover:bg-hover disabled:cursor-default disabled:text-dim"
          >
            Add
          </button>
        </Row>
      </Section>

      {error ? (
        <p role="alert" className="text-[12.5px] text-danger/80">
          {error}
        </p>
      ) : null}
    </>
  );
}
