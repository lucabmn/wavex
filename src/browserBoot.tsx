import React, { useCallback, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { attachBrowserHost, currentBrowserHost, type BrowserHost } from "./lib/browserHost";
import { BrowserPairing } from "./surfaces/BrowserPairing";

type Phase =
  | { kind: "checking" }
  | { kind: "pairing"; error: string | null }
  | { kind: "connecting"; host: BrowserHost };

/**
 * Boot for a client that has no wavex installed behind it.
 *
 * The desktop app mounts straight into a workspace because its host is the
 * machine it is already running on. A tab has no host until it has a
 * connection, and every project path it will read belongs to that host, so the
 * connection is made first and the app is mounted only once it stands.
 */
function BrowserGate({ onReady }: { onReady: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });

  const attach = useCallback(
    async (host: BrowserHost) => {
      setPhase({ kind: "connecting", host });
      try {
        await attachBrowserHost(host);
        onReady();
      } catch (error) {
        setPhase({
          kind: "pairing",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [onReady],
  );

  useEffect(() => {
    let cancelled = false;
    void currentBrowserHost().then((host) => {
      if (cancelled) return;
      if (host) void attach(host);
      else setPhase({ kind: "pairing", error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [attach]);

  if (phase.kind === "pairing") {
    return (
      <>
        <BrowserPairing onPaired={(host) => void attach(host)} />
        {phase.error ? (
          <div className="pointer-events-none fixed inset-x-0 bottom-6 text-center text-[12.5px] text-danger/90">
            {phase.error}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-base text-[12.5px] text-faint">
      {phase.kind === "connecting" ? `Connecting to ${phase.host.name}…` : ""}
    </div>
  );
}

export function mountBrowserApp() {
  const container = document.getElementById("root") as HTMLElement;
  // The splash covers first paint for the desktop window, which is
  // transparent until the app draws. A tab is opaque already, and leaving it
  // up would hide the one screen the user has to interact with.
  document.getElementById("boot-splash")?.remove();
  const root = ReactDOM.createRoot(container);
  const ready = () => {
    // Unmounting from inside the tree that is unmounting is a React warning,
    // so the gate finishes its own render first.
    queueMicrotask(() => {
      root.unmount();
      void import("./mainApp").then(({ mountMainApp }) => mountMainApp());
    });
  };
  root.render(
    <React.StrictMode>
      <BrowserGate onReady={ready} />
    </React.StrictMode>,
  );
}
