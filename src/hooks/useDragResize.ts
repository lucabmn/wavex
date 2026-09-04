import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { suppressTextSelection } from "../lib/drag";

type Options = {
  min: number;
  max: () => number;
  defaultWidth: number;
  initial: number;
  onCommit?: (width: number) => void;
};

function clampTo(value: number, min: number, max: number) {
  const upper = Math.max(min, max);
  return Math.min(upper, Math.max(min, Math.round(value)));
}

export function resizeWidthForKey({
  current,
  min,
  max,
  defaultWidth,
  key,
  shiftKey = false,
}: {
  current: number;
  min: number;
  max: number;
  defaultWidth: number;
  key: string;
  shiftKey?: boolean;
}): number | null {
  const step = shiftKey ? 24 : 8;
  if (key === "ArrowLeft") return clampTo(current - step, min, max);
  if (key === "ArrowRight") return clampTo(current + step, min, max);
  if (key === "Home") return min;
  if (key === "End") return Math.max(min, max);
  if (key === "Enter") return clampTo(defaultWidth, min, max);
  return null;
}

/** Drag a pane's width by writing the DOM directly so React re-renders can't fight the cursor. */
export function useDragResize({ min, max, defaultWidth, initial, onCommit }: Options) {
  const minRef = useRef(min);
  minRef.current = min;
  const maxRef = useRef(max);
  maxRef.current = max;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const defaultRef = useRef(defaultWidth);
  defaultRef.current = defaultWidth;

  const clamp = useCallback((value: number) => {
    return clampTo(value, minRef.current, maxRef.current());
  }, []);

  const [width, setWidth] = useState(() => clamp(initial));
  const [maxWidth, setMaxWidth] = useState(() => Math.max(min, max()));
  const [dragging, setDragging] = useState(false);
  const paneRef = useRef<HTMLElement | null>(null);
  const widthRef = useRef(width);
  const stopDrag = useRef<(() => void) | null>(null);

  const apply = (next: number) => {
    widthRef.current = next;
    const pane = paneRef.current;
    if (pane) pane.style.width = `${next}px`;
  };

  const setPaneRef = useCallback((el: HTMLElement | null) => {
    paneRef.current = el;
    if (el) el.style.width = `${widthRef.current}px`;
  }, []);

  const commit = (next: number) => {
    const value = clamp(next);
    apply(value);
    setWidth(value);
    onCommitRef.current?.(value);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startW = widthRef.current;
    handle.setPointerCapture(pointerId);
    setDragging(true);
    const restoreSelection = suppressTextSelection();
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    document.documentElement.classList.add("is-resizing");

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      apply(clamp(startW + (ev.clientX - startX)));
    };

    const stop = () => {
      if (stopDrag.current !== stop) return;
      stopDrag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      restoreSelection();
      document.body.style.cursor = previousCursor;
      document.documentElement.classList.remove("is-resizing");
      setDragging(false);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      commit(widthRef.current);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      stop();
    };

    stopDrag.current = stop;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  useEffect(() => () => stopDrag.current?.(), []);

  useEffect(() => {
    const limit = Math.max(minRef.current, maxRef.current());
    setMaxWidth((current) => (current === limit ? current : limit));
    const next = clamp(widthRef.current);
    if (next !== widthRef.current) commit(next);
  }, [clamp, max]);

  useEffect(() => {
    let frame: number | null = null;
    const onResize = () => {
      if (frame != null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const limit = Math.max(minRef.current, maxRef.current());
        setMaxWidth((current) => (current === limit ? current : limit));
        const next = clamp(widthRef.current);
        if (next !== widthRef.current) commit(next);
      });
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame != null) window.cancelAnimationFrame(frame);
    };
  }, [clamp]);

  const onDoubleClick = () => {
    commit(defaultRef.current);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const next = resizeWidthForKey({
      current: widthRef.current,
      min: minRef.current,
      max: maxRef.current(),
      defaultWidth: defaultRef.current,
      key: event.key,
      shiftKey: event.shiftKey,
    });
    if (next == null) return;
    event.preventDefault();
    event.stopPropagation();
    commit(next);
  };

  return {
    width,
    maxWidth,
    dragging,
    setPaneRef,
    onPointerDown,
    onDoubleClick,
    onKeyDown,
  };
}
