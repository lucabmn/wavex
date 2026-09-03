import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FoldVertical,
  Minus,
  Undo2,
  UnfoldVertical,
} from "../chrome/icons";
import { ask } from "@tauri-apps/plugin-dialog";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useColorScheme } from "../hooks/useColorScheme";
import {
  diffReviewCommand,
  hunkTargets,
  moveCursor,
  type DiffHunkTarget,
  type DiffReviewCursor,
} from "../lib/diffReview";
import { basename } from "../lib/fs";
import { highlightDiffFile, type SyntaxToken } from "../lib/editor/syntaxTokens";
import {
  expandFold,
  type FoldReveal,
  type UnifiedBlock,
  type UnifiedLine,
} from "../lib/unifiedDiff";
import {
  flattenVisibleRows,
  rowsHeight,
  UNIFIED_FOLD_PX,
  UNIFIED_HUNK_PX,
  UNIFIED_LINE_PX,
  UNIFIED_OVERSCAN_PX,
  windowRows,
  type DiffViewRow,
  type RowWindow,
} from "../lib/unifiedDiffWindow";

export type UnifiedDiffFileModel = {
  id: string;
  path: string;
  label: string;
  binary?: boolean;
  tooLarge?: boolean;
  emptyMessage?: string;
  additions: number;
  deletions: number;
  blocks: UnifiedBlock[];
  canStage?: boolean;
  canUnstage?: boolean;
  canDiscard?: boolean;
  canStageHunk?: boolean;
};

type Props = {
  files: UnifiedDiffFileModel[];
  truncated?: boolean;
  focusPath?: string;
  busyId?: string | null;
  totals?: { additions: number; deletions: number };
  /** Fill the parent pane and scroll inside. Off when the parent already scrolls. */
  fill?: boolean;
  onStageFile?: (id: string) => void;
  onUnstageFile?: (id: string) => void;
  onDiscardFile?: (id: string) => void;
  onStageHunk?: (id: string, pos: number) => void;
};

/**
 * The review keys are bare letters on `window`, but several diffs can be
 * mounted at once — one per pane, plus the ones behind a hidden tab.
 */
type ReviewPane = { id: symbol; visible: () => boolean };

const reviewPanes: ReviewPane[] = [];
let claimedReview: symbol | null = null;

function registerReviewPane(pane: ReviewPane): () => void {
  reviewPanes.push(pane);
  return () => {
    const index = reviewPanes.findIndex((entry) => entry.id === pane.id);
    if (index >= 0) reviewPanes.splice(index, 1);
    if (claimedReview === pane.id) claimedReview = null;
  };
}

/**
 * Exactly one diff answers a keystroke. The pointer or focus picks it when
 * several are on screen; otherwise the first visible one wins, so a split that
 * was never hovered still works and two panes never stage the same key twice.
 * A diff behind a hidden tab has no offset parent and never qualifies.
 */
function ownsReviewKeys(id: symbol): boolean {
  const visible = reviewPanes.filter((pane) => pane.visible());
  if (visible.length === 0) return false;
  const claimed = visible.find((pane) => pane.id === claimedReview);
  return (claimed ?? visible[0]).id === id;
}

export function UnifiedDiffView({
  files,
  truncated,
  focusPath,
  busyId,
  totals,
  fill = true,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onStageHunk,
}: Props) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const [open, setOpen] = useState<Set<string>>(() => new Set(files.map((file) => file.id)));
  const [reveals, setReveals] = useState<Record<string, FoldReveal>>({});
  const fileRefs = useRef(new Map<string, HTMLElement>());
  const bodyRefs = useRef(new Map<string, HTMLElement>());
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reviewId = useRef<symbol>(Symbol("diff-review"));
  const [cursor, setCursor] = useState<DiffReviewCursor>({ fileIndex: 0, hunkIndex: 0 });
  const [navToken, setNavToken] = useState(0);
  const fileKey = files.map((file) => file.id).join("\n");

  useEffect(() => {
    setOpen(new Set(files.map((file) => file.id)));
    setReveals({});
    setCursor({ fileIndex: 0, hunkIndex: 0 });
  }, [fileKey]);

  useEffect(() => {
    if (!focusPath) return;
    const node = fileRefs.current.get(focusPath);
    const scroller = scrollerRef.current;
    if (!node || !scroller) return;
    const top = node.offsetTop - 8;
    scroller.scrollTo({ top: Math.max(0, top) });
  }, [focusPath, fileKey]);

  /**
   * Hunk headers per file, in render order. Folds change the offsets, so this
   * tracks `reveals`; a collapsed or unrenderable file contributes none.
   */
  const hunksByFile = useMemo<DiffHunkTarget[][]>(
    () =>
      files.map((file) => {
        if (!open.has(file.id) || file.binary || file.tooLarge || file.blocks.length === 0) {
          return [];
        }
        return hunkTargets(
          flattenVisibleRows(file.blocks, (foldId) => reveals[`${file.id}:${foldId}`]),
        );
      }),
    [files, open, reveals],
  );

  const claimReview = useCallback(() => {
    claimedReview = reviewId.current;
  }, []);

  useEffect(
    () =>
      registerReviewPane({
        id: reviewId.current,
        visible: () => !!rootRef.current && rootRef.current.offsetParent !== null,
      }),
    [],
  );

  const keys = useRef({
    files,
    hunksByFile,
    cursor,
    onStageFile,
    onUnstageFile,
    onDiscardFile,
    onStageHunk,
  });
  keys.current = {
    files,
    hunksByFile,
    cursor,
    onStageFile,
    onUnstageFile,
    onDiscardFile,
    onStageHunk,
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!ownsReviewKeys(reviewId.current)) return;
      const command = diffReviewCommand(event);
      if (!command) return;
      const state = keys.current;
      if (state.files.length === 0) return;
      const counts = state.hunksByFile.map((list) => list.length);
      const fileIndex = Math.min(state.files.length - 1, Math.max(0, state.cursor.fileIndex));
      const file = state.files[fileIndex];
      if (!file) return;

      /**
       * The cursor only moves on the navigation keys, so a user who scrolled
       * with the mouse can be looking at a different file than the one an
       * action would hit. Bring the cursor on screen first and act on the
       * second press, rather than staging or discarding out of sight.
       */
      const cursorOnScreen = () => {
        const scroller = scrollerRef.current;
        const section = fileRefs.current.get(file.path);
        if (!scroller || !section) return true;
        const view = scroller.getBoundingClientRect();
        const box = section.getBoundingClientRect();
        return box.bottom > view.top + 8 && box.top < view.bottom - 8;
      };

      if (
        command === "next-hunk" ||
        command === "prev-hunk" ||
        command === "next-file" ||
        command === "prev-file"
      ) {
        event.preventDefault();
        setCursor(moveCursor(state.cursor, counts, command));
        setNavToken((token) => token + 1);
        return;
      }

      if (!cursorOnScreen()) {
        event.preventDefault();
        setNavToken((token) => token + 1);
        return;
      }

      if (command === "toggle") {
        event.preventDefault();
        setOpen((current) => {
          const next = new Set(current);
          if (next.has(file.id)) next.delete(file.id);
          else next.add(file.id);
          return next;
        });
        return;
      }

      if (command === "stage") {
        const target = state.hunksByFile[fileIndex]?.[state.cursor.hunkIndex];
        if (file.canStageHunk && state.onStageHunk && target?.pos != null) {
          event.preventDefault();
          state.onStageHunk(file.id, target.pos);
          return;
        }
        if (file.canStage && state.onStageFile) {
          event.preventDefault();
          state.onStageFile(file.id);
        }
        return;
      }

      if (command === "stage-file") {
        if (!file.canStage || !state.onStageFile) return;
        event.preventDefault();
        state.onStageFile(file.id);
        return;
      }

      if (command === "unstage") {
        if (!file.canUnstage || !state.onUnstageFile) return;
        event.preventDefault();
        state.onUnstageFile(file.id);
        return;
      }

      // Discard throws away work the user cannot get back, so one keystroke is
      // never enough on its own.
      if (!file.canDiscard || !state.onDiscardFile) return;
      event.preventDefault();
      const discard = state.onDiscardFile;
      void ask(`Discard your changes to ${file.label}? This cannot be undone.`, {
        title: "wavex",
        kind: "warning",
      }).then((confirmed) => {
        if (confirmed) discard(file.id);
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!navToken) return;
    const scroller = scrollerRef.current;
    const file = files[cursor.fileIndex];
    if (!scroller || !file) return;
    // Content coordinates: viewport top of the scroller, minus how far it is
    // already scrolled.
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const target = hunksByFile[cursor.fileIndex]?.[cursor.hunkIndex];
    const body = bodyRefs.current.get(file.id);
    if (target && body) {
      const top = body.getBoundingClientRect().top - base + target.offset - 44;
      scroller.scrollTo({ top: Math.max(0, top) });
      return;
    }
    const section = fileRefs.current.get(file.path);
    if (!section) return;
    scroller.scrollTo({ top: Math.max(0, section.getBoundingClientRect().top - base - 8) });
  }, [navToken]);

  const bindScroller = (el: HTMLDivElement | null) => {
    scrollerRef.current = el;
    lockOverscroll(el);
  };

  if (files.length === 0) {
    return <p className="px-4 py-6 text-[13px] text-content/45">No file changes</p>;
  }

  const fileLabel = files.length === 1 ? "1 file" : `${files.length} files`;
  const additions = totals?.additions ?? files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = totals?.deletions ?? files.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <div
      ref={rootRef}
      data-diff-review
      className={fill ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden" : "flex flex-col"}
    >
      <div
        className={`flex h-8 shrink-0 items-center gap-3 border-b border-content/10 px-3 text-[12px]`}
      >
        <span className="text-content/70">{fileLabel}</span>
        <DiffCounts additions={additions} deletions={deletions} />
        <span className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            title="Expand all files"
            aria-label="Expand all files"
            onClick={() => setOpen(new Set(files.map((file) => file.id)))}
            className="grid size-7 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
          >
            <UnfoldVertical className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title="Collapse all files"
            aria-label="Collapse all files"
            disabled={open.size === 0}
            onClick={() => setOpen(new Set())}
            className="grid size-7 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
          >
            <FoldVertical className="size-3.5" strokeWidth={1.75} />
          </button>
        </span>
      </div>
      <div
        ref={bindScroller}
        className={
          fill ? "unified-diff min-h-0 flex-1 overflow-y-auto overscroll-none" : "unified-diff"
        }
        onPointerEnter={claimReview}
        onPointerDown={claimReview}
        onFocusCapture={claimReview}
      >
        {truncated ? (
          <p className="px-3 py-3 text-[12px] text-content/45">
            Diff is too large to display in full. File list is shown without patches.
          </p>
        ) : null}
        <div className="flex flex-col">
          {files.map((file, index) => (
            <FileSection
              key={file.id}
              file={file}
              expanded={open.has(file.id)}
              focused={focusPath === file.path || focusPath === file.id}
              active={index === cursor.fileIndex}
              activeHunkRow={
                index === cursor.fileIndex
                  ? hunksByFile[index]?.[cursor.hunkIndex]?.rowIndex
                  : undefined
              }
              busy={busyId === file.id}
              reveals={reveals}
              scrollerRef={scrollerRef}
              onToggle={() => {
                setOpen((current) => {
                  const next = new Set(current);
                  if (next.has(file.id)) next.delete(file.id);
                  else next.add(file.id);
                  return next;
                });
              }}
              onReveal={(foldId, direction) => {
                const key = `${file.id}:${foldId}`;
                const block = file.blocks.find(
                  (entry) => entry.kind === "fold" && entry.id === foldId,
                );
                const total = block?.kind === "fold" ? block.lines.length : 0;
                setReveals((current) => ({
                  ...current,
                  [key]: expandFold(current[key], total, direction),
                }));
              }}
              onStageFile={onStageFile}
              onUnstageFile={onUnstageFile}
              onDiscardFile={onDiscardFile}
              onStageHunk={onStageHunk}
              bindRef={(node) => {
                if (node) fileRefs.current.set(file.path, node);
                else fileRefs.current.delete(file.path);
              }}
              bindBody={(node) => {
                if (node) bodyRefs.current.set(file.id, node);
                else bodyRefs.current.delete(file.id);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const FileSection = memo(function FileSection({
  file,
  expanded,
  focused,
  active,
  activeHunkRow,
  busy,
  reveals,
  scrollerRef,
  onToggle,
  onReveal,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onStageHunk,
  bindRef,
  bindBody,
}: {
  file: UnifiedDiffFileModel;
  expanded: boolean;
  focused: boolean;
  active: boolean;
  activeHunkRow?: number;
  busy: boolean;
  reveals: Record<string, FoldReveal>;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onReveal: (foldId: string, direction: "up" | "down" | "all") => void;
  onStageFile?: (id: string) => void;
  onUnstageFile?: (id: string) => void;
  onDiscardFile?: (id: string) => void;
  onStageHunk?: (id: string, pos: number) => void;
  bindRef: (node: HTMLElement | null) => void;
  bindBody: (node: HTMLElement | null) => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const name = basename(file.path);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [near, setNear] = useState(false);
  const [tokens, setTokens] = useState<Map<UnifiedLine, SyntaxToken[]> | null>(null);
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (!expanded || !near) return;
    let cancelled = false;
    void highlightDiffFile(file, colorScheme).then((next) => {
      if (!cancelled) setTokens(next);
    });
    return () => {
      cancelled = true;
    };
  }, [colorScheme, expanded, file, near]);

  const setSection = (node: HTMLElement | null) => {
    sectionRef.current = node;
    bindRef(node);
  };

  useLayoutEffect(() => {
    if (!expanded) return;
    const section = sectionRef.current;
    if (!section) return;
    const root = scrollerRef.current ?? verticalScrollParent(section);
    setNear(isNearViewport(section, root, 800));
  }, [expanded, scrollerRef, file.id]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !expanded) return;
    const root = scrollerRef.current ?? verticalScrollParent(section);
    const observer = new IntersectionObserver(
      ([entry]) => {
        const next = entry.isIntersecting;
        setNear((current) => (current === next ? current : next));
      },
      { root, rootMargin: "800px 0px", threshold: 0 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [expanded, scrollerRef]);

  return (
    <section
      ref={setSection}
      data-diff-file={file.path}
      aria-current={active ? "true" : undefined}
      className={focused ? "bg-content/[0.03]" : undefined}
    >
      <header
        className={`sticky top-0 z-30 flex items-center gap-2 border-b border-content/10 bg-content/2 px-3 py-1.5 backdrop-blur-xl ${
          active ? "shadow-[inset_2px_0_0_0_var(--color-content)]" : ""
        }`}
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Chevron className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} />
          <FileTypeIcon name={name} isDir={false} size={16} />
          <span
            className="min-w-0 flex-1 truncate font-mono text-[12px] text-content/85"
            title={file.label}
          >
            {file.label}
          </span>
          <DiffCounts additions={file.additions} deletions={file.deletions} />
        </button>
        {file.canUnstage && onUnstageFile ? (
          <IconButton title="Unstage file" disabled={busy} onClick={() => onUnstageFile(file.id)}>
            <Minus className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {file.canDiscard && onDiscardFile ? (
          <IconButton title="Discard file" disabled={busy} onClick={() => onDiscardFile(file.id)}>
            <Undo2 className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {file.canStage && onStageFile ? (
          <button
            type="button"
            title="Stage file"
            aria-label="Stage file"
            disabled={busy}
            onClick={() => onStageFile(file.id)}
            className="grid size-4 place-items-center rounded-[3px] bg-content text-background-base hover:opacity-80 disabled:opacity-40"
          >
            <Check className="size-2.5" strokeWidth={2.5} />
          </button>
        ) : null}
      </header>
      {expanded ? (
        <FileBody
          file={file}
          reveals={reveals}
          near={near}
          tokens={tokens}
          activeHunkRow={activeHunkRow}
          scrollerRef={scrollerRef}
          onReveal={onReveal}
          onStageHunk={onStageHunk}
          bindBody={bindBody}
        />
      ) : null}
    </section>
  );
});

function FileBody({
  file,
  reveals,
  near,
  tokens,
  activeHunkRow,
  scrollerRef,
  onReveal,
  onStageHunk,
  bindBody,
}: {
  file: UnifiedDiffFileModel;
  reveals: Record<string, FoldReveal>;
  near: boolean;
  tokens: Map<UnifiedLine, SyntaxToken[]> | null;
  activeHunkRow?: number;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  onReveal: (foldId: string, direction: "up" | "down" | "all") => void;
  onStageHunk?: (id: string, pos: number) => void;
  bindBody: (node: HTMLElement | null) => void;
}) {
  if (file.binary) return <EmptyBody>Binary file changed</EmptyBody>;
  if (file.tooLarge) return <EmptyBody>Diff is too large to display</EmptyBody>;
  if (file.emptyMessage) return <EmptyBody>{file.emptyMessage}</EmptyBody>;
  if (file.blocks.length === 0) return <EmptyBody>No textual diff</EmptyBody>;

  return (
    <VirtualRows
      fileId={file.id}
      blocks={file.blocks}
      reveals={reveals}
      near={near}
      tokens={tokens}
      activeHunkRow={activeHunkRow}
      canStageHunk={file.canStageHunk}
      scrollerRef={scrollerRef}
      onReveal={onReveal}
      onStageHunk={onStageHunk}
      bindBody={bindBody}
    />
  );
}

function VirtualRows({
  fileId,
  blocks,
  reveals,
  near,
  tokens,
  activeHunkRow,
  canStageHunk,
  scrollerRef,
  onReveal,
  onStageHunk,
  bindBody,
}: {
  fileId: string;
  blocks: UnifiedBlock[];
  reveals: Record<string, FoldReveal>;
  near: boolean;
  tokens: Map<UnifiedLine, SyntaxToken[]> | null;
  activeHunkRow?: number;
  canStageHunk?: boolean;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  onReveal: (foldId: string, direction: "up" | "down" | "all") => void;
  onStageHunk?: (id: string, pos: number) => void;
  bindBody: (node: HTMLElement | null) => void;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // The placeholder carries the same total height, so binding it too keeps hunk
  // offsets right for a file that has not been rendered yet.
  const setBody = (node: HTMLDivElement | null) => {
    bodyRef.current = node;
    bindBody(node);
  };
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const mouseYRef = useRef<number | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      flattenVisibleRows(
        blocks,
        (foldId) => reveals[`${fileId}:${foldId}`],
        !!canStageHunk && !!onStageHunk,
      ),
    [blocks, canStageHunk, fileId, onStageHunk, reveals],
  );
  const totalHeight = useMemo(() => rowsHeight(rows), [rows]);
  const minWidthCh = useMemo(() => {
    let max = 40;
    for (const row of rows) {
      if (row.type === "line") {
        max = Math.max(max, row.line.text.length);
      }
    }
    return max + 8;
  }, [rows]);
  const [range, setRange] = useState<RowWindow>(() => ({
    start: 0,
    end: 0,
    padTop: 0,
    padBottom: totalHeight,
  }));

  const updateWindow = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const root = scrollerRef.current ?? verticalScrollParent(body);
    const rootRect = root
      ? root.getBoundingClientRect()
      : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const bodyRect = body.getBoundingClientRect();
    const next = windowRows(
      rows,
      rootRect.top - bodyRect.top,
      rootRect.bottom - bodyRect.top,
      UNIFIED_OVERSCAN_PX,
    );
    setRange((current) =>
      current.start === next.start &&
      current.end === next.end &&
      current.padTop === next.padTop &&
      current.padBottom === next.padBottom
        ? current
        : next,
    );
  }, [rows, scrollerRef]);

  const hoverAtY = useCallback(
    (clientY: number | null) => {
      const body = bodyRef.current;
      if (clientY == null || !body) {
        setHoverKey((current) => (current == null ? current : null));
        return;
      }
      let y = clientY - body.getBoundingClientRect().top - range.padTop;
      if (y < 0) {
        setHoverKey((current) => (current == null ? current : null));
        return;
      }
      for (let index = range.start; index < range.end; index += 1) {
        const row = rows[index];
        if (!row) break;
        if (y < row.height) {
          const key = diffRowKey(row, index);
          setHoverKey((current) => (current === key ? current : key));
          return;
        }
        y -= row.height;
      }
      setHoverKey((current) => (current == null ? current : null));
    },
    [range.end, range.padTop, range.start, rows],
  );

  useLayoutEffect(() => {
    if (!near) return;
    updateWindow();
  }, [near, updateWindow, totalHeight]);

  useLayoutEffect(() => {
    if (!near) return;
    hoverAtY(mouseYRef.current);
  }, [hoverAtY, near]);

  useLayoutEffect(() => {
    if (!near) return;
    const body = bodyRef.current;
    if (!body) return;
    const apply = () => {
      body.style.setProperty("--unified-body-width", `${body.clientWidth}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(body);
    return () => observer.disconnect();
  }, [near, totalHeight]);

  useEffect(() => {
    if (!near) return;
    const body = bodyRef.current;
    const root = scrollerRef.current ?? (body ? verticalScrollParent(body) : null);
    const target: HTMLElement | Window = root ?? window;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateWindow();
        hoverAtY(mouseYRef.current);
      });
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [hoverAtY, near, scrollerRef, updateWindow]);

  if (!near) {
    return <div ref={setBody} style={{ height: totalHeight }} />;
  }

  const visible = rows.slice(range.start, range.end);
  const lanePad = {
    paddingTop: range.padTop,
    paddingBottom: range.padBottom,
  };

  const renderLane = (lane: Lane) =>
    visible.map((row, index) => {
      const key = diffRowKey(row, range.start + index);
      return (
        <DiffLane
          key={`${lane}-${key}`}
          row={row}
          lane={lane}
          hovered={hoverKey === key}
          tokens={row.type === "line" ? tokens?.get(row.line) : undefined}
          onReveal={row.type === "fold" ? (direction) => onReveal(row.id, direction) : undefined}
          active={range.start + index === activeHunkRow}
          onStage={
            row.type === "line" && row.stage && row.line.pos != null
              ? () => onStageHunk?.(fileId, row.line.pos as number)
              : undefined
          }
        />
      );
    });

  return (
    <div
      ref={setBody}
      className="flex"
      onMouseMove={(event) => {
        mouseYRef.current = event.clientY;
        hoverAtY(event.clientY);
      }}
      onMouseLeave={() => {
        mouseYRef.current = null;
        hoverAtY(null);
      }}
    >
      <div className="relative z-10 w-12 shrink-0" style={lanePad}>
        {renderLane("gutter")}
      </div>
      <div
        ref={lockOverscroll}
        className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-none"
      >
        <div style={{ ...lanePad, minWidth: `max(100%, ${minWidthCh}ch)` }}>
          {renderLane("code")}
        </div>
      </div>
    </div>
  );
}

type Lane = "gutter" | "code";

function diffRowKey(row: DiffViewRow, index: number) {
  if (row.type === "fold") return `fold-${row.id}`;
  return `${index}-${row.line.kind}-${row.line.oldNumber ?? "x"}-${row.line.newNumber ?? "x"}`;
}

function DiffLane({
  row,
  lane,
  hovered,
  active,
  tokens,
  onReveal,
  onStage,
}: {
  row: DiffViewRow;
  lane: Lane;
  hovered: boolean;
  active: boolean;
  tokens?: SyntaxToken[];
  onReveal?: (direction: "up" | "down" | "all") => void;
  onStage?: () => void;
}) {
  if (row.type === "fold") {
    if (lane === "gutter") {
      return (
        <div className="relative z-20" style={{ height: UNIFIED_FOLD_PX }}>
          <div
            className="absolute inset-y-0 left-0"
            style={{ width: "var(--unified-body-width, 100%)" }}
          >
            <FoldBar hidden={row.hidden} onReveal={onReveal!} />
          </div>
        </div>
      );
    }
    return <div style={{ height: UNIFIED_FOLD_PX }} />;
  }
  return (
    <DiffLineRow
      line={row.line}
      lane={lane}
      hovered={hovered}
      active={active}
      tokens={tokens}
      onStage={onStage}
    />
  );
}

function FoldBar({
  hidden,
  onReveal,
}: {
  hidden: number;
  onReveal: (direction: "up" | "down" | "all") => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-content/8 px-2" style={{ height: UNIFIED_FOLD_PX }}>
      <button
        type="button"
        title="Expand upward"
        aria-label="Expand unmodified lines upward"
        onClick={() => onReveal("up")}
        className="grid size-5 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
      >
        <ChevronUp className="size-3" strokeWidth={2} />
      </button>
      <button
        type="button"
        title="Expand downward"
        aria-label="Expand unmodified lines downward"
        onClick={() => onReveal("down")}
        className="grid size-5 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
      >
        <ChevronDown className="size-3" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => onReveal("all")}
        className="min-w-0 flex-1 py-1 text-left font-mono text-[11px] text-content/45 hover:text-content/70"
      >
        {hidden} unmodified {hidden === 1 ? "line" : "lines"}
      </button>
    </div>
  );
}

const DiffLineRow = memo(function DiffLineRow({
  line,
  lane,
  hovered,
  active,
  tokens,
  onStage,
}: {
  line: UnifiedLine;
  lane: Lane;
  hovered: boolean;
  active: boolean;
  tokens?: SyntaxToken[];
  onStage?: () => void;
}) {
  if (line.kind === "hunk") {
    return (
      <div
        className={active ? "bg-content/12 ring-1 ring-content/25 ring-inset" : "bg-content/5"}
        style={{ height: UNIFIED_HUNK_PX }}
      >
        {lane === "code" ? (
          <span className="px-3 font-mono text-[11px] leading-5 text-content/40">{line.text}</span>
        ) : null}
      </div>
    );
  }
  const added = line.kind === "add";
  const deleted = line.kind === "del";
  const number = deleted ? line.oldNumber : line.newNumber;
  const row = added ? "bg-emerald-500/15" : deleted ? "bg-rose-500/15" : "";
  const gutterTint = added ? "bg-emerald-500/25" : deleted ? "bg-rose-500/25" : "";
  const gutterText = added ? "text-emerald-300" : deleted ? "text-rose-300" : "text-content/35";

  if (lane === "gutter") {
    return (
      <div className={`relative ${row}`} style={{ height: UNIFIED_LINE_PX }}>
        {gutterTint ? (
          <span className={`pointer-events-none absolute inset-0 ${gutterTint}`} />
        ) : null}
        <span
          className={`relative block pr-2 text-right font-mono text-[11px] tabular-nums ${gutterText}`}
          style={{ lineHeight: `${UNIFIED_LINE_PX}px` }}
        >
          {number ?? ""}
        </span>
        {onStage ? (
          <button
            type="button"
            title="Stage hunk"
            aria-label="Stage hunk"
            onClick={onStage}
            className={`absolute top-0.5 left-full z-10 ml-0.5 grid size-4 place-items-center rounded-[3px] bg-white text-[11px] font-bold text-black ${
              hovered ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            +
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={row} style={{ height: UNIFIED_LINE_PX }}>
      <span
        className={`whitespace-pre px-3 font-mono text-[12px] text-content/80 ${
          line.kind === "context" ? "opacity-70" : ""
        }`}
        style={{ lineHeight: `${UNIFIED_LINE_PX}px` }}
      >
        {renderLineText(line, tokens)}
      </span>
    </div>
  );
});

function renderLineText(line: UnifiedLine, tokens?: SyntaxToken[]) {
  const pieces = tokens && tokens.length > 0 ? tokens : [{ text: line.text }];
  if (pieces.length === 1 && !pieces[0]?.color) {
    return line.text;
  }
  return (
    <>
      {pieces.map((piece, index) => (
        <span key={index} style={piece.color ? { color: piece.color } : undefined}>
          {piece.text}
        </span>
      ))}
    </>
  );
}

function EmptyBody({ children }: { children: string }) {
  return <p className="px-3 py-3 text-[12px] text-content/45">{children}</p>;
}

function DiffCounts({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions <= 0 && deletions <= 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-semibold tabular-nums">
      {additions > 0 ? <span className="text-emerald-400">+{additions}</span> : null}
      {deletions > 0 ? <span className="text-red-400">-{deletions}</span> : null}
    </span>
  );
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function verticalScrollParent(el: HTMLElement): HTMLElement | null {
  let current = el.parentElement;
  while (current) {
    const overflowY = getComputedStyle(current).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight + 1
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function isNearViewport(section: HTMLElement, root: HTMLElement | null, margin: number) {
  const bounds = section.getBoundingClientRect();
  const view = root
    ? root.getBoundingClientRect()
    : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  return bounds.bottom + margin > view.top && bounds.top - margin < view.bottom;
}
