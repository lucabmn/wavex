/**
 * The parts of the operating system that belong to the machine drawing this
 * window, behind one seam.
 *
 * These are not host commands and never travel over a connection: a file
 * dialog, a native alert, the Dock, the window itself. The desktop client has
 * all of them; a browser tab has a browser's versions of some and none of the
 * rest. Everything here therefore answers in one of two honest ways — the
 * browser's own equivalent where there is one, or a plain "not here" the
 * caller can render as an absent control rather than a broken one.
 *
 * Nothing in this file may be reached through `invokeOn`. See
 * `src/lib/transport` for the seam that does cross machines.
 */
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_TAURI } from "./clientRuntime";

export type DialogKind = "info" | "warning" | "error";

export type AskOptions = {
  title?: string;
  kind?: DialogKind;
  okLabel?: string;
  cancelLabel?: string;
};

/**
 * A yes/no the user must answer before something destructive happens.
 *
 * `window.confirm` is the browser's version and is deliberately used rather
 * than skipped: these guard discarding work, killing a running terminal, and
 * quitting mid-turn, and a client that silently answered "yes" would lose
 * exactly the work the prompt exists to protect.
 */
export async function ask(message: string, options: AskOptions = {}): Promise<boolean> {
  if (!IS_TAURI) return window.confirm(dialogText(message, options.title));
  const { ask: nativeAsk } = await import("@tauri-apps/plugin-dialog");
  return nativeAsk(message, options);
}

export async function message(text: string, options: AskOptions = {}): Promise<void> {
  if (!IS_TAURI) {
    window.alert(dialogText(text, options.title));
    return;
  }
  const { message: nativeMessage } = await import("@tauri-apps/plugin-dialog");
  await nativeMessage(text, options);
}

function dialogText(body: string, title?: string): string {
  return title ? `${title}\n\n${body}` : body;
}

/**
 * Whether this client can put a file picker in front of the user.
 *
 * A browser can, but only over its own machine's disk — which is not where a
 * host's checkout is. Call sites that pick a path *for the host* check this
 * and leave the control out; call sites that read bytes to upload do not need
 * it, because those come through an `<input type="file">` either way.
 */
export const CAN_PICK_HOST_PATHS = IS_TAURI;

/** Whether this client owns a native window at all. */
export const HAS_NATIVE_WINDOW = IS_TAURI;

export async function openUrl(url: string): Promise<void> {
  if (!IS_TAURI) {
    // `noopener` keeps the opened page from reaching back into this one.
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl: nativeOpen } = await import("@tauri-apps/plugin-opener");
  await nativeOpen(url);
}

type OpenOptions = {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
};

/**
 * The client's own folder picker. It can only see this machine's disk, so a
 * host's checkout is chosen through `HostProjectDialog` instead.
 */
export async function openDialog(options: OpenOptions): Promise<string | string[] | null> {
  if (!IS_TAURI) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open(options);
}

export async function saveDialog(options: {
  title?: string;
  defaultPath?: string;
}): Promise<string | null> {
  if (!IS_TAURI) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save(options);
}

/**
 * A URL the WebView can load a local file through. There is no such scheme in
 * a browser tab, and the file would be on the wrong machine in any case, so
 * the caller renders the fallback it already has for a missing image.
 */
export function assetSrc(path: string): string | null {
  return IS_TAURI ? convertFileSrc(path) : null;
}

/**
 * This client's own window, or null when there is none.
 *
 * Titles, traffic lights, focus, and the close request are all the drawing
 * machine's, never the host's. Callers use `?.` and get nothing in a tab,
 * which is the honest answer: a tab's title bar and lifecycle belong to the
 * browser, not to wavex.
 */
export function nativeWindow(): ReturnType<typeof getCurrentWindow> | null {
  return IS_TAURI ? getCurrentWindow() : null;
}

/**
 * Which window of this client an event is meant for. Events targeted this way
 * never leave the client, and a browser tab is a client with exactly one
 * window, so the name only has to be stable.
 */
export function windowLabel(): string {
  return IS_TAURI ? getCurrentWindow().label : "main";
}

/**
 * The WebView's own drag-and-drop, which reports OS file paths a host command
 * can open. A browser reports `File` objects instead and never a path, so the
 * tab keeps the picker and the clipboard and leaves this out.
 */
export function nativeWebview(): ReturnType<typeof getCurrentWebview> | null {
  return IS_TAURI ? getCurrentWebview() : null;
}
