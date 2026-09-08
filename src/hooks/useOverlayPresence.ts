import { useEffect } from "react";
import { addOverlay } from "../lib/layers";

/**
 * Marks a floating layer as on screen for as long as this component is
 * mounted, so the panel's native browser view — which no z-index can sit above
 * — knows to step out of the way while a menu or a dialog is open.
 */
export function useOverlayPresence(): void {
  useEffect(() => addOverlay(), []);
}
