import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
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
import { preflightFrame } from "../lib/framePreflight";
import { overlaysOpen, subscribeOverlays } from "../lib/layers";
import {
  CAN_SHOW_NATIVE_PAGE,
  closeFrameView,
  frameBounds,
  hideFrameView,
  reloadFrameView,
  showFrameView,
} from "../lib/frameView";
import { PlaceholderButton, SurfacePlaceholder } from "../chrome/SurfacePlaceholder";

type Props = {
  browser: BrowserHistory;
  /** Whether the panel is showing this surface right now. */
  active: boolean;
  onChange: (browser: BrowserHistory) => void;
};

/**
 * How long the cover stays up when nothing has said whether the page arrived.
 *
 * Only reached when the preflight could not answer — in a browser tab, or when
 * the request failed in a way the frame's own request may not. Past it the page
 * is shown and a blank one speaks for itself, which is the behaviour the panel
 * has without a preflight at all.
 */
const COVER_GRACE_MS = 3000;

/** Ports a dev server is reached on often enough to be worth one click. */
const SUGGESTIONS = ["localhost:3000", "localhost:5173", "localhost:8080"];

/**
 * A page, rendered beside the session that is changing it.
 *
 * A page is shown in a frame wherever it will allow one, because a frame is
 * part of the document and every popover, menu, and dialog the app draws stays
 * above it. A site sending `X-Frame-Options` or `frame-ancestors` allows no
 * frame anywhere, so those — and only those — move to a child webview, which is
 * a top-level browsing context with no framing ancestor to object to. That one
 * is an operating-system view over the window, so it has to be told where the
 * panel is and taken away whenever the document needs to draw on top; the
 * headers say which of the two a page needs before either is shown.
 */
export function DockBrowser({ browser, active, onChange }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // Bumped to re-mount the frame on reload: the frame keeps its own history, so
  // pointing `src` at the address it already holds would do nothing.
  const [reloads, setReloads] = useState(0);
  const [state, setState] = useState<FrameState>("idle");
  const [refusedBy, setRefusedBy] = useState<string | null>(null);
  // Nothing the document draws can appear over a native view, so it steps
  // aside for every menu and dialog rather than swallowing them.
  const overlays = useSyncExternalStore(subscribeOverlays, overlaysOpen, () => false);
  const url = browserHistoryUrl(browser);
  const back = canGoBack(browser);
  const forward = canGoForward(browser);
  // The address being typed is this field's, not the panel's: a keystroke that
  // reached the workspace store would repaint every session in the window.
  const [draft, setDraft] = useState(url ?? "");

  useEffect(() => {
    setDraft(url ?? "");
  }, [url]);

  // The frame cannot report a refusal — no event fires, and its location throws
  // whether it was blocked or loaded — so the headers are read instead, next to
  // the frame's own request. Until an answer arrives the page is covered: a
  // frame that has not committed paints white, and a white sheet in a dark
  // panel reads as a broken app rather than as a page on its way.
  useEffect(() => {
    if (!url) {
      setState("idle");
      return;
    }
    setState("loading");
    let current = true;
    const timer = window.setTimeout(() => current && setState("ready"), COVER_GRACE_MS);
    void preflightFrame(url).then((probe) => {
      if (!current || !probe) return;
      window.clearTimeout(timer);
      setState(
        !probe.reachable
          ? "unreachable"
          : probe.embeddable
            ? "ready"
            : CAN_SHOW_NATIVE_PAGE
              ? "native"
              : "refused",
      );
      setRefusedBy(probe.refusedBy);
    });
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [url, reloads]);

  const openExternally = useCallback(() => {
    if (url) void openUrl(url);
  }, [url]);

  // The native view is placed rather than laid out, so it is told where the
  // panel is on every change that could move it, coalesced to one call a paint.
  const showNative = state === "native" && active && !overlays && !!url;
  useEffect(() => {
    if (!showNative || !url) {
      void hideFrameView();
      return;
    }
    const element = body.current;
    if (!element) return;
    let frameRequest: number | null = null;
    const place = () => {
      frameRequest = null;
      const bounds = frameBounds(element.getBoundingClientRect());
      // A zero-sized panel is one the window has put away — behind Settings,
      // behind the chat surface, or collapsed. The view goes with it.
      if (!bounds) {
        void hideFrameView();
        return;
      }
      void showFrameView(url, bounds).then((shown) => {
        // A platform that cannot give the panel a child webview leaves the card
        // rather than an empty hole, which is what this surface does without one.
        if (!shown) setState("refused");
      });
    };
    const schedule = () => {
      if (frameRequest == null) frameRequest = requestAnimationFrame(place);
    };
    place();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener("resize", schedule);
    return () => {
      if (frameRequest != null) cancelAnimationFrame(frameRequest);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [showNative, url]);

  // The page outlives a surface switch, not the panel itself.
  useEffect(() => () => void closeFrameView(), []);

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
        className="flex h-9 shrink-0 items-center gap-0.5 border-b border-edge px-1"
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
        <IconButton
          label="Reload"
          disabled={!url}
          onClick={() => {
            if (state === "native") void reloadFrameView();
            else setReloads((count) => count + 1);
          }}
        >
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
          className="mx-1 h-6 min-w-0 flex-1 rounded-md bg-content/5 px-2 text-[12.5px] text-content placeholder:text-dim focus:bg-content/8 focus:outline-none focus:ring-1 focus:ring-accent/60"
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
      <div ref={body} className="relative min-h-0 min-w-0 flex-1">
        {state === "native" ? (
          // The page is out here, over the window. What stays in the document
          // is the hole it sits in, which shows while a menu covers it.
          <div className="absolute inset-0 bg-background-base" />
        ) : url ? (
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
            // A page that says it can be framed and then arrives takes the
            // cover down early; one that never arrives is already spoken for.
            onLoad={() => setState((previous) => (previous === "loading" ? "ready" : previous))}
          />
        ) : (
          <EmptyBrowser onPick={(value) => onChange(browserVisit(browser, value))} />
        )}
        {url && state === "loading" ? <Loading url={url} /> : null}
        {state === "refused" || state === "unreachable" ? (
          <NotShown
            url={url ?? ""}
            refusedBy={state === "refused" ? refusedBy : null}
            onOpen={openExternally}
            onRetry={() => setReloads((count) => count + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * `native` is the page that would not be framed and is now a child webview
 * over the window instead; `refused` is the same page where there is no native
 * shell to put it in.
 */
type FrameState = "idle" | "loading" | "ready" | "native" | "refused" | "unreachable";

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
            className="rounded-md bg-content/5 px-2 py-1 text-[11.5px] text-muted transition-colors hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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

function NotShown({
  url,
  refusedBy,
  onOpen,
  onRetry,
}: {
  url: string;
  refusedBy: string | null;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const host = hostOf(url);
  return (
    <div className="absolute inset-0 bg-background-base">
      <SurfacePlaceholder
        icon={Globe}
        title={refusedBy ? `${host} will not be embedded` : `Nothing answered at ${host}`}
        description={
          refusedBy
            ? `Its ${refusedBy} header tells browsers to refuse this, which most large sites do. Development servers and documentation sites almost never do.`
            : "Nothing is listening at that address. Start the server, or check the port."
        }
      >
        <PlaceholderButton onClick={onOpen}>Open in Browser</PlaceholderButton>
        <PlaceholderButton onClick={onRetry}>Try Again</PlaceholderButton>
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
