import { useEffect, useRef, useState } from "react";
import { Connection, Loader } from "../chrome/icons";
import { pairBrowser, type BrowserHost } from "../lib/browserHost";

type Props = {
  onPaired: (host: BrowserHost) => void;
};

/**
 * The one screen a browser client shows before it has a host.
 *
 * The address is not asked for — this page came from the host, so it already
 * knows where it is. Only the code is missing, and the copy says plainly what
 * pasting it grants, because a connection code is the whole machine.
 */
export function BrowserPairing({ onPaired }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pairing) return;
    setPairing(true);
    setError(null);
    try {
      onPaired(await pairBrowser(code));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setPairing(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-base px-6 py-10">
      <form
        onSubmit={submit}
        className="w-full max-w-[420px] rounded-xl border border-edge bg-content/3 p-5"
      >
        <div className="flex items-center gap-2 text-[13.5px] font-medium text-content">
          <Connection className="size-4 text-faint" />
          Connect to this machine
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          Run <code className="font-mono text-strong">
            wavex --headless --print-pairing-code
          </code>{" "}
          on this machine and paste what it prints. The code grants this browser the machine&apos;s
          files, its processes, and write access to its Git checkouts, as the user running the host.
        </p>
        <textarea
          ref={input}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) void submit(event);
          }}
          spellCheck={false}
          autoComplete="off"
          rows={3}
          placeholder="wavex-connect:…"
          className="mt-4 w-full resize-none rounded-md border border-edge bg-content/5 px-2.5 py-2 font-mono text-[12.5px] text-strong placeholder:text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {error ? <div className="mt-2 text-[12.5px] text-red-400/90">{error}</div> : null}
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-[11.5px] text-dim">
            The code is exchanged for a session this page cannot read.
          </span>
          <button
            type="submit"
            disabled={pairing || !code.trim()}
            className="ui-fill ui-focus flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium disabled:opacity-40"
          >
            {pairing ? <Loader className="size-3.5 animate-spin" /> : null}
            Connect
          </button>
        </div>
      </form>
    </div>
  );
}
