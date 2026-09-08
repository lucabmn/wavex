import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Globe, RefreshCw } from "../chrome/icons";
import { IconButton } from "../chrome/TitleBar";
import {
  browserBack,
  browserForward,
  browserVisit,
  canGoBack,
  canGoForward,
  browserHistoryUrl,
  normalizeBrowserUrl,
  type BrowserHistory,
} from "../lib/workspace/browserHistory";
import { openUrl } from "../lib/native";
import { PlaceholderButton, SurfacePlaceholder } from "../chrome/SurfacePlaceholder";

type Props = {
  browser: BrowserHistory;
  onChange: (browser: BrowserHistory) => void;
};

/**
 * How long a page gets to commit before the frame is read.
 *
 * A refused frame never commits, so this is the whole wait before the panel can
 * say so — long enough that an ordinary page has started, short enough that a
 * refusal is not a silent pause. A page slower than this is called loaded on
 * its own `load` a moment later, which clears the message again.
 */
const COMMIT_GRACE_MS = 3000;

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
  const [state, setState] = useState<FrameState>("idle");
  const url = browserHistoryUrl(browser);
  const back = canGoBack(browser);
  const forward = canGoForward(browser);
  // The address being typed is this field's, not the panel's: a keystroke that
  // reached the workspace store would repaint every session in the window.
  const [draft, setDraft] = useState(url ?? "");

  useEffect(() => {
    setDraft(url ?? "");
  }, [url]);

  // A refused frame fires no event a listener can hear, so the frame is read
  // once the grace period is up rather than waited on. Until then the page is
  // covered: a frame that has not committed paints white, and a white sheet in
  // a dark panel reads as a broken app rather than as a page on its way.
  useEffect(() => {
    if (!url) {
      setState("idle");
      return;
    }
    setState("loading");
    const timer = window.setTimeout(() => setState(settle(frame.current)), COMMIT_GRACE_MS);
    return () => window.clearTimeout(timer);
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
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 h-full w-full border-0 bg-white"
            onLoad={() => setState(settle(frame.current))}
          />
        ) : (
          <EmptyBrowser onPick={(value) => onChange(browserVisit(browser, value))} />
        )}
        {url && state === "loading" ? <Loading url={url} /> : null}
        {state === "blank" ? (
          <NothingLoaded
            url={url ?? ""}
            onOpen={openExternally}
            onRetry={() => setReloads((count) => count + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}

type FrameState = "idle" | "loading" | "ready" | "blank";

/**
 * What the frame has actually got in it.
 *
 * A frame that was blocked, or whose server never answered, is left sitting on
 * `about:blank` — the one document this window may read across the boundary. A
 * page that really loaded throws on the same read, and that throw is the
 * success. What this cannot say is *why* nothing arrived, so the message it
 * leads to names both reasons rather than guessing between them.
 */
function settle(frame: HTMLIFrameElement | null): FrameState {
  if (!frame) return "blank";
  try {
    return frame.contentWindow?.location.href === "about:blank" ? "blank" : "ready";
  } catch {
    return "ready";
  }
}

function EmptyBrowser({ onPick }: { onPick: (url: string) => void }) {
  return (
    <div className="absolute inset-0">
      <SurfacePlaceholder
        icon={Globe}
        description="Open a development server or a page beside this project. Most large sites refuse to be embedded and open in your browser instead."
      >
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
      </SurfacePlaceholder>
    </div>
  );
}

/** Covers the frame until it commits, so a page on its way never paints white. */
function Loading({ url }: { url: string }) {
  return (
    <div className="absolute inset-0 bg-background-base">
      <SurfacePlaceholder icon={Globe} description={`Loading ${hostOf(url)}…`} />
    </div>
  );
}

function NothingLoaded({
  url,
  onOpen,
  onRetry,
}: {
  url: string;
  onOpen: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="absolute inset-0 bg-background-base">
      <SurfacePlaceholder
        icon={Globe}
        title={`Nothing loaded from ${hostOf(url)}`}
        description={`Either nothing is listening there, or ${hostOf(url)} asks browsers not to embed it — which most large sites do. Development servers and documentation sites almost never do.`}
      >
        <PlaceholderButton onClick={onRetry}>Try Again</PlaceholderButton>
        <PlaceholderButton onClick={onOpen}>Open in Browser</PlaceholderButton>
      </SurfacePlaceholder>
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
