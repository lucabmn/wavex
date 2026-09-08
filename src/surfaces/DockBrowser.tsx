import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Globe, RefreshCw } from "../chrome/icons";
import { IconButton } from "../chrome/TitleBar";
import {
  browserBack,
  browserForward,
  browserVisit,
  canGoBack,
  canGoForward,
  dockBrowserUrl,
  normalizeBrowserUrl,
  type DockBrowser as DockBrowserState,
} from "../lib/workspace/dockBrowser";
import { openUrl } from "../lib/native";

type Props = {
  browser: DockBrowserState;
  onChange: (browser: DockBrowserState) => void;
};

/** Ports a dev server is reached on often enough to be worth one click. */
const SUGGESTIONS = ["localhost:3000", "localhost:5173", "localhost:8080"];

/**
 * A page, rendered beside the session that is changing it.
 *
 * The page lives in a frame rather than a second native web view: a native one
 * composites above the document, so it would cover every popover, menu, and
 * dialog the app draws, and it would have to be told its bounds again on every
 * frame of a dock resize. The cost is that a site sending `X-Frame-Options` or
 * `frame-ancestors` refuses to appear at all — a local development server, the
 * reason this surface exists, sends neither — so a refusal is recognised and
 * handed to the real browser instead of leaving a blank rectangle.
 */
export function DockBrowser({ browser, onChange }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // Bumped to re-mount the frame on reload: the frame keeps its own history, so
  // pointing `src` at the address it already holds would do nothing.
  const [reloads, setReloads] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refused, setRefused] = useState(false);
  const url = dockBrowserUrl(browser);
  const back = canGoBack(browser);
  const forward = canGoForward(browser);
  // The address being typed is this field's, not the panel's: a keystroke that
  // reached the workspace store would repaint every session in the window.
  const [draft, setDraft] = useState(url ?? "");

  useEffect(() => {
    setDraft(url ?? "");
  }, [url]);

  useEffect(() => {
    setLoading(!!url);
    setRefused(false);
  }, [url, reloads]);

  const openExternally = useCallback(() => {
    if (url) void openUrl(url);
  }, [url]);

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const next = browserVisit(browser, draft);
      if (next !== browser) {
        onChange(next);
        field.current?.blur();
        return;
      }
      // The same address again, which reads as a reload. Text that is not an
      // address at all stays in the field for the user to correct.
      if (normalizeBrowserUrl(draft)) setReloads((count) => count + 1);
    },
    [browser, draft, onChange],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <form
        className="flex h-9 shrink-0 items-center gap-0.5 border-b border-content/10 px-1"
        onSubmit={submit}
      >
        <IconButton label="Back" disabled={!back} onClick={() => onChange(browserBack(browser))}>
          <ChevronLeft className="size-3.5" strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label="Forward"
          disabled={!forward}
          onClick={() => onChange(browserForward(browser))}
        >
          <ChevronRight className="size-3.5" strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Reload" disabled={!url} onClick={() => setReloads((count) => count + 1)}>
          <RefreshCw className="size-3.5" strokeWidth={1.75} />
        </IconButton>
        <input
          ref={field}
          type="text"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="Address"
          placeholder="localhost:3000 or example.com"
          className="mx-1 h-6 min-w-0 flex-1 rounded-md bg-content/5 px-2 text-[12px] text-content placeholder:text-content/35 focus:bg-content/8 focus:outline-none focus:ring-1 focus:ring-accent/60"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setDraft(url ?? "");
            field.current?.blur();
          }}
          onFocus={(event) => event.currentTarget.select()}
        />
        <IconButton label="Open in Browser" disabled={!url} onClick={openExternally}>
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      </form>
      <div className="relative min-h-0 min-w-0 flex-1">
        {url ? (
          <iframe
            // A new address is a new document, so the frame is replaced rather
            // than navigated: its own back stack must not outlive the page.
            key={`${reloads}:${url}`}
            ref={frame}
            src={url}
            title="Browser"
            // The page is a stranger sitting next to a checkout. It may script
            // itself and keep its own origin's storage; it may not steer the
            // window it is inside, which is what leaving out
            // `allow-top-navigation` buys.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
            referrerPolicy="strict-origin-when-cross-origin"
            allow=""
            className="absolute inset-0 h-full w-full border-0 bg-white"
            onLoad={() => {
              setLoading(false);
              setRefused(frameRefusedToLoad(frame.current));
            }}
          />
        ) : (
          <EmptyBrowser onPick={(value) => onChange(browserVisit(browser, value))} />
        )}
        {url && loading ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-0.5 animate-pulse bg-accent/70"
          />
        ) : null}
        {refused ? <Refused url={url ?? ""} onOpen={openExternally} /> : null}
      </div>
    </div>
  );
}

/**
 * Whether the frame was refused rather than rendered.
 *
 * A frame blocked by `X-Frame-Options` or `frame-ancestors` still fires `load`,
 * so the event alone says nothing. It is left sitting on `about:blank`, which
 * is the one document this window may read across the boundary — a page that
 * really loaded throws instead, and the throw is the success.
 */
function frameRefusedToLoad(frame: HTMLIFrameElement | null): boolean {
  if (!frame) return false;
  try {
    return frame.contentWindow?.location.href === "about:blank";
  } catch {
    return false;
  }
}

function EmptyBrowser({ onPick }: { onPick: (url: string) => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
      <Globe className="size-6 text-content/25" strokeWidth={1.5} />
      <p className="max-w-64 text-[12px] leading-relaxed text-content/50">
        Open a development server or a page beside this project.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-1">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPick(suggestion)}
            className="rounded-md bg-content/5 px-2 py-1 text-[11px] text-content/60 transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function Refused({ url, onOpen }: { url: string; onOpen: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background-base px-6 text-center">
      <p className="text-[12px] font-medium text-content">This site will not open inside an app</p>
      <p className="max-w-72 text-[12px] leading-relaxed text-content/50">
        {hostOf(url)} asks browsers not to embed it. Development servers and most documentation
        sites do not.
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-md bg-content/10 px-2.5 py-1 text-[12px] text-content transition-colors hover:bg-content/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Open in Browser
      </button>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
