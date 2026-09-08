/**
 * The panel's native browser view, for pages an `<iframe>` will never show.
 *
 * This is a real child webview composited over the window, not part of the
 * document, so two things are the caller's job: telling it where the panel is
 * in window coordinates, and taking it away whenever something the document
 * draws needs to be on top. See `src-tauri/src/frame_view.rs`.
 *
 * It belongs to the machine drawing the panel, so it goes over local IPC and a
 * client without a native shell has none — `CAN_SHOW_NATIVE_PAGE` is false
 * there and the panel keeps to the frame it can draw itself.
 */
import { invokeLocal } from "./transport";
import { IS_TAURI } from "./clientRuntime";
import { loadUiScale } from "./uiScale";

export const CAN_SHOW_NATIVE_PAGE = IS_TAURI;

export type FrameBounds = { x: number; y: number; width: number; height: number };

/** Too small to be a panel: collapsed, on a hidden surface, or in a hidden window. */
const MIN_SIDE = 2;

/**
 * Window coordinates for a rectangle the document measured.
 *
 * App-wide scaling is the webview's own zoom, so a CSS pixel in here is
 * `scale` window pixels out there. A view placed without that correction drifts
 * further from the panel the further the user zooms.
 */
export function frameBounds(rect: DOMRect): FrameBounds | null {
  if (rect.width < MIN_SIDE || rect.height < MIN_SIDE) return null;
  const scale = loadUiScale();
  return {
    x: rect.left * scale,
    y: rect.top * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

async function call(command: string, args?: Record<string, unknown>): Promise<boolean> {
  if (!IS_TAURI) return false;
  try {
    await invokeLocal(command, args);
    return true;
  } catch {
    return false;
  }
}

export async function showFrameView(url: string, bounds: FrameBounds): Promise<boolean> {
  return call("frame_view_show", { url, bounds });
}

export async function moveFrameView(bounds: FrameBounds): Promise<void> {
  await call("frame_view_bounds", { bounds });
}

export async function hideFrameView(): Promise<void> {
  await call("frame_view_hide");
}

export async function closeFrameView(): Promise<void> {
  await call("frame_view_close");
}

export async function reloadFrameView(): Promise<void> {
  await call("frame_view_reload");
}
