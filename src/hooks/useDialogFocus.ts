import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type Options = {
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  escapeDisabled?: boolean;
  trapDisabled?: boolean;
  enabled?: boolean;
};

function visibleFocusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * Modal focus contract shared by every centered dialog: focus enters once,
 * remains inside the topmost modal, Escape closes when safe, and focus returns
 * to the control that opened it.
 */
export function useDialogFocus<T extends HTMLElement = HTMLElement>({
  onClose,
  initialFocusRef,
  escapeDisabled = false,
  trapDisabled = false,
  enabled = true,
}: Options) {
  const dialogRef = useRef<T>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const escapeDisabledRef = useRef(escapeDisabled);
  const trapDisabledRef = useRef(trapDisabled);
  onCloseRef.current = onClose;
  escapeDisabledRef.current = escapeDisabled;
  trapDisabledRef.current = trapDisabled;

  useLayoutEffect(() => {
    if (!enabled) return;
    const dialog = dialogRef.current;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog || dialog.contains(document.activeElement)) return;
    const target = initialFocusRef?.current ?? visibleFocusableElements(dialog)[0] ?? dialog;
    target.focus({ preventScroll: true });
  }, [enabled, initialFocusRef]);

  useEffect(() => {
    if (!enabled) return;
    return () => {
      const target = returnFocusRef.current;
      if (!target?.isConnected) return;
      // Let the portal disappear before returning focus to the underlying UI.
      queueMicrotask(() => target.focus({ preventScroll: true }));
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const modals = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
      if (modals[modals.length - 1] !== dialog) return;

      if (event.key === "Escape") {
        if (escapeDisabledRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || trapDisabledRef.current) return;

      const focusable = visibleFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const active = document.activeElement;
      const current = active instanceof HTMLElement ? focusable.indexOf(active) : -1;
      const next = event.shiftKey
        ? current <= 0
          ? focusable.length - 1
          : current - 1
        : current < 0 || current === focusable.length - 1
          ? 0
          : current + 1;
      event.preventDefault();
      focusable[next]?.focus({ preventScroll: true });
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);

  return dialogRef;
}
