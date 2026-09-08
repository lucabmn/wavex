/**
 * One z-index scale for everything that floats over the app chrome. Panels and
 * buttons inside a surface stay below 50; anything that escapes its pane —
 * menus, dialogs, toasts — picks a layer from here so the order is decided in
 * one place instead of by whichever stray `z-50` was written last.
 */
export const LAYER = {
  /** Anchored menus, dropdowns, and pickers. */
  popover: 80,
  /** A flyout hung off an open popover. */
  submenu: 81,
  /** Modal dialogs and the command palette. */
  dialog: 90,
  /** The preview that follows the pointer during a drag. */
  drag: 95,
  /** Toasts, which outrank whatever they interrupt. */
  toast: 100,
} as const;

/**
 * How many floating layers are on screen.
 *
 * The z-index scale above orders everything the document draws, but the panel's
 * native browser view is not drawn by the document: it is an operating-system
 * view composited over the whole window, so no z-index reaches it. Anything
 * that would be covered by it has to say it is there, and the view steps aside.
 */
let overlays = 0;
const listeners = new Set<() => void>();

export function overlaysOpen(): boolean {
  return overlays > 0;
}

export function subscribeOverlays(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called by the overlay primitives themselves; see `useOverlayPresence`. */
export function addOverlay(): () => void {
  overlays += 1;
  for (const listener of listeners) listener();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    overlays -= 1;
    for (const listener of listeners) listener();
  };
}
